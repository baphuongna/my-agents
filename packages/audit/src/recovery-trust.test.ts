import { describe, it, expect, beforeEach } from "vitest";
import { defaultRecoveryRecipes, runRecovery, loadTrust, promoteTrust, safeContextOnly, canAutoApprove } from "./index.js";
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

  it("MEDIUM-1: an unknown error is 'Unknown' (not mislabeled PermissionDenied)", async () => {
    const recipes = defaultRecoveryRecipes(async () => {});
    const r = await runRecovery(err("memory", "weird unknown"), recipes);
    expect(r.scenario).toBe("Unknown");
    expect(r.exhausted).toBe(true);
  });

  it("an apply failure sets aborted=true (distinct from clean exhaustion)", async () => {
    let calls = 0;
    const recipes = defaultRecoveryRecipes(async () => { calls++; throw new Error("apply broke"); });
    const r = await runRecovery(err("provider", "fetch timeout"), recipes);
    expect(calls).toBe(1); // stopped after the first apply failure
    expect(r.stepsTaken).toBe(0);
    expect(r.aborted).toBe(true); // MEDIUM-2: the host can tell it gave up via apply-failure
  });
});

describe("§14.3 ProjectTrust — per-root trust gate + USER-OWNED persistence", () => {
  beforeEach(() => {
    // isolate the user-owned trust store to a temp dir (review: never pollute ~)
    process.env.MY_AGENT_TRUST_DIR = mkdtempSync(join(tmpdir(), "trust-store-"));
  });

  it("loadTrust defaults to untrusted when no user-owned record exists", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    const t = loadTrust(root);
    expect(t.level).toBe("untrusted");
    expect(t.source).toBe("default");
    expect(safeContextOnly(t)).toBe(true);
    expect(canAutoApprove(t)).toBe(false);
  });

  it("CRITICAL-1 fix: a project committing {level:privileged} does NOT self-elevate", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(join(root, ".my-agent"), { recursive: true });
    writeFileSync(join(root, ".my-agent", "trust.json"), '{"level":"privileged","trustedAt":0}');
    const t = loadTrust(root); // MUST ignore the in-project file
    expect(t.level).toBe("untrusted");
    expect(canAutoApprove(t)).toBe(false);
  });

  it("promoteTrust writes the USER-OWNED store (not the project) + loadTrust reads it", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    promoteTrust(root, "trusted");
    expect(existsSync(join(root, ".my-agent", "trust.json"))).toBe(false); // NOT in project
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

  it("a corrupt user-owned record fails-safe to untrusted", () => {
    const root = mkdtempSync(join(tmpdir(), "trust-"));
    promoteTrust(root, "trusted");
    const { writeFileSync } = require("node:fs");
    const canon = loadTrust(root).root;
    const key = require("node:crypto").createHash("sha256").update(canon).digest("hex").slice(0, 32);
    writeFileSync(join(process.env.MY_AGENT_TRUST_DIR!, `${key}.json`), "{ not valid json");
    const t = loadTrust(root);
    expect(t.level).toBe("untrusted"); // fail-safe
  });
});
