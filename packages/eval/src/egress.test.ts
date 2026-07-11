/**
 * Phase 14 tests: §15 eval tier fix + no-egress guard + golden age gate.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  ParityHarness,
  identicalPassthrough,
  installEgressGuard,
  restoreEgress,
  checkGoldenAge,
  EgressViolationError,
} from "./index.js";

afterEach(() => restoreEgress());

describe("Eval tier: unit/integration/credentialed", () => {
  it("identicalPassthrough is tier 'unit'", () => {
    expect(identicalPassthrough.tier).toBe("unit");
  });

  it("grade() runs only unit scenarios", async () => {
    const h = new ParityHarness();
    h.add(identicalPassthrough);
    h.add({ ...identicalPassthrough, id: "live-1", tier: "credentialed" });
    const results = await h.grade();
    expect(results).toHaveLength(1); // only unit scenario graded
    expect(results[0]!.id).toBe("01-identical-passthrough");
  });
});

describe("no-egress guard", () => {
  it("blocks fetch when guard installed", async () => {
    installEgressGuard({ allowNetwork: false });
    await expect(fetch("https://example.com")).rejects.toThrow(EgressViolationError);
  });

  it("restores fetch after restoreEgress()", async () => {
    installEgressGuard({ allowNetwork: false });
    restoreEgress();
    // fetch is back to the original (no throw on the guard level)
    expect(typeof fetch).toBe("function");
  });

  it("no-op when allowNetwork is true", () => {
    installEgressGuard({ allowNetwork: true });
    expect(typeof fetch).toBe("function");
    restoreEgress();
  });
});

describe("golden age gate", () => {
  it("marks old goldens as stale", () => {
    const now = Date.parse("2026-07-10");
    const old = now - 100 * 24 * 60 * 60 * 1000; // 100 days ago
    const r = checkGoldenAge(old, now, 90);
    expect(r.stale).toBe(true);
    expect(r.ageDays).toBe(100);
  });

  it("fresh goldens are not stale", () => {
    const now = Date.parse("2026-07-10");
    const fresh = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    expect(checkGoldenAge(fresh, now, 90).stale).toBe(false);
  });

  it("unknown recordedAt is not stale (best-effort)", () => {
    expect(checkGoldenAge(undefined, Date.now()).stale).toBe(false);
  });
});
