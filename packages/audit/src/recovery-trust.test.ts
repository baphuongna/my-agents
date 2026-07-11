import { describe, it, expect } from "vitest";
import { defaultRecoveryRecipes, runRecovery, loadTrust, promoteTrust, safeContextOnly, canAutoApprove } from "@my-agent/audit";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LifecycleError } from "@my-agent/core";

const err = (phase: LifecycleError["phase"], reason: string): LifecycleError => ({ phase, recoverable: true, retries: 0, context: { reason } });

describe("§14.3 RecoveryRecipe FSM — detect → classify → bounded apply → escalate", () => {
  it("classifies a NetworkError + applies bounded retries", async () => {
    const applied: string[] = [];
    const recipes = defaultRecoveryRecipes(async (step) => { applied.push(step.kind); });
    const r = await runRecovery(err("provider", "fetch ECONNRESET"), recipes);
    expect(r.scenario).toBe("NetworkError");
    expect(r.stepsTaken).toBeGreaterThan(0);
    expect(r.stepsTaken).toBeLessThanOrEqual(3); // bounded
    expect(applied[0]).toBe("retry");
  });

  it("classifies Provider5xx", async () => {
    const recipes = defaultRecoveryRecipes(async () => {});
    const r = await runRecovery(err("provider", "503 overloaded"), recipes);
    expect(r.scenario).toBe("Provider5xx");
  });

  it("PermissionDenied has zero steps (never retry a denial)", async () => {
    const recipes = defaultRecoveryRecipes(async () => {});
    const r = await runRecovery(err("tool", "denied by permission gate"), recipes);
    expect(r.scenario).toBe("PermissionDenied");
    expect(r.stepsTaken).toBe(0);
    expect(r.exhausted).toBe(true);
  });

  it("an unknown error → exhausted surface (no infinite retry)", async () => {
    const recipes = defaultRecoveryRecipes(async () => {});
    const r = await runRecovery(err("memory", "weird unknown"), recipes);
    expect(r.exhausted).toBe(true);
  });

  it("an apply failure stops the recipe (no infinite loop)", async () => {
    let calls = 0;
    const recipes = defaultRecoveryRecipes(async () => { calls++; throw new Error("apply broke"); });
    const r = await runRecovery(err("provider", "fetch timeout"), recipes);
    expect(calls).toBe(1); // stopped after the first apply failure
    expect(r.stepsTaken).toBe(0);
  });
});

describe("§14.3 ProjectTrust — per-root trust gate + persistence", () => {
  it("loadTrust defaults to untrusted when no trust.json", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    const t = loadTrust(root);
    expect(t.level).toBe("untrusted");
    expect(t.source).toBe("default");
    expect(safeContextOnly(t)).toBe(true); // before trust: safe context only
    expect(canAutoApprove(t)).toBe(false); // no auto-approve when untrusted
  });

  it("promoteTrust persists trust.json + elevates level", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    promoteTrust(root, "trusted");
    const file = join(root, ".my-agent/trust.json");
    expect(existsSync(file)).toBe(true);
    const t2 = loadTrust(root);
    expect(t2.level).toBe("trusted");
    expect(t2.source).toBe("persisted");
    expect(safeContextOnly(t2)).toBe(false);
  });

  it("privileged → canAutoApprove true", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    const t = promoteTrust(root, "privileged");
    expect(canAutoApprove(t)).toBe(true);
  });

  it("a corrupt trust.json fails-safe to untrusted", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(join(root, ".my-agent"), { recursive: true });
    writeFileSync(join(root, ".my-agent/trust.json"), "{ not valid json");
    const t = loadTrust(root);
    expect(t.level).toBe("untrusted"); // fail-safe
  });
});
