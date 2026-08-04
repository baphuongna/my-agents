import { describe, it, expect, vi } from "vitest";
import { defaultRecoveryRecipes, runRecovery, type RecoveryRecipe, type FailureScenario } from "./recovery.js";
import type { LifecycleError } from "@my-agent/core";

function makeErr(phase: string, reason: string): LifecycleError {
  return { phase: phase as LifecycleError["phase"], recoverable: true, retries: 0, context: { reason } };
}

describe("[unit] audit recovery FSM", () => {
  const recipes = defaultRecoveryRecipes(async () => {});

  it("NetworkError detected + classified", () => {
    const err = makeErr("provider", "ECONNRESET: network down");
    const recipe = recipes.find(r => r.detect(err));
    expect(recipe?.scenario).toBe("NetworkError");
    const { steps, bound } = recipe!.classify(err);
    expect(steps.length).toBeGreaterThan(0);
    expect(bound).toBeGreaterThan(0);
  });

  it("Provider5xx detected", () => {
    const err = makeErr("provider", "503 server overloaded");
    expect(recipes.find(r => r.detect(err))?.scenario).toBe("Provider5xx");
  });

  it("ToolTimeout detected", () => {
    const err = makeErr("tool", "command timed out after 30s");
    expect(recipes.find(r => r.detect(err))?.scenario).toBe("ToolTimeout");
  });

  it("InvalidOutput detected (validation phase)", () => {
    const err = makeErr("validation", "output doesn't match schema");
    expect(recipes.find(r => r.detect(err))?.scenario).toBe("InvalidOutput");
  });

  it("PermissionDenied detected", () => {
    const err = makeErr("tool", "permission denied");
    expect(recipes.find(r => r.detect(err))?.scenario).toBe("PermissionDenied");
  });

  it("unknown error → Unknown scenario", async () => {
    const err = makeErr("stream", "weird unknown thing");
    const attempt = await runRecovery(err, recipes);
    expect(attempt.scenario).toBe("Unknown");
    expect(attempt.exhausted).toBe(true);
  });

  it("runRecovery applies steps up to escalateAfter", async () => {
    const applyFn = vi.fn(async () => {});
    const customRecipes = defaultRecoveryRecipes(applyFn);
    const err = makeErr("provider", "network timeout");
    const attempt = await runRecovery(err, customRecipes);
    expect(attempt.scenario).toBe("NetworkError");
    expect(attempt.stepsTaken).toBeGreaterThan(0);
    expect(applyFn).toHaveBeenCalled();
  });

  it("runRecovery: apply throws → aborted=true", async () => {
    const applyFn = vi.fn(async () => { throw new Error("apply failed"); });
    const customRecipes = defaultRecoveryRecipes(applyFn);
    const err = makeErr("provider", "network error");
    const attempt = await runRecovery(err, customRecipes);
    expect(attempt.aborted).toBe(true);
  });

  it("PermissionDenied: 0 steps → immediately exhausted", async () => {
    const applyFn = vi.fn(async () => {});
    const customRecipes = defaultRecoveryRecipes(applyFn);
    const err = makeErr("tool", "permission denied by gate");
    const attempt = await runRecovery(err, customRecipes);
    expect(attempt.exhausted).toBe(true);
    expect(attempt.stepsTaken).toBe(0);
    expect(attempt.policy).toBe("surface");
  });

  it("ApprovalExpired: escalate step + fail-open-read-only policy", async () => {
    const applyFn = vi.fn(async () => {});
    const customRecipes = defaultRecoveryRecipes(applyFn);
    const err = makeErr("tool", "approval token expired");
    const attempt = await runRecovery(err, customRecipes);
    expect(attempt.policy).toBe("fail-open-read-only");
  });
});
