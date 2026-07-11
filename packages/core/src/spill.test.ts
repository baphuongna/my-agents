import { describe, it, expect, beforeEach } from "vitest";
import { maybeSpill, resolveRef, sweepRefs } from "@my-agent/core";
import type { LargeValueRef } from "@my-agent/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";

beforeEach(() => {
  process.env.MY_AGENT_REFS_DIR = mkdtempSync(join(tmpdir(), "refs-"));
});

describe("§13 maybeSpill — return contract", () => {
  it("small value passes through unchanged", () => {
    expect(maybeSpill("small", { threshold: 1024 })).toBe("small");
    expect(maybeSpill({ small: 1 }, { threshold: 1024 })).toEqual({ small: 1 });
  });

  it("large string spills to a LargeValueRef (review CRITICAL-2 fix: no require)", () => {
    const big = "x".repeat(10_000);
    const out = maybeSpill(big, { threshold: 1024 });
    if (typeof out !== "string" && "spilled" in out) {
      expect(out.spilled).toBe(true);
      expect(out.bytes).toBe(10_000);
      expect(typeof out.sha).toBe("string");
      expect(out.sha).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof out.refPath).toBe("string");
      expect(out.refPath.endsWith(out.sha)).toBe(true);
    } else { throw new Error("expected a LargeValueRef"); }
  });

  it("HIGH-2: preview-like `hint` is a SAFE length/hash, NOT the raw head", () => {
    const big = JSON.stringify({ apiKey: "sk-supersecret-123", password: "hunter2", ssn: "123-45-6789", token: "ghp_xxxx" }).repeat(20);
    const out = maybeSpill(big, { threshold: 1024 }) as unknown as { hint: string };
    // the hint must NOT contain the secrets (review: preview leaked apiKey/password/ssn)
    expect(out.hint).not.toContain("sk-supersecret");
    expect(out.hint).not.toContain("hunter2");
    expect(out.hint).not.toContain("ghp_");
    expect(out.hint).not.toContain("123-45-6789");
  });

  it("identical values share one ref (content-addressed)", () => {
    const big = "y".repeat(5000);
    const a = maybeSpill(big, { threshold: 1024 }) as { refPath: string };
    const b = maybeSpill(big, { threshold: 1024 }) as { refPath: string };
    expect(a.refPath).toBe(b.refPath);
  });

  it("non-serializable (circular) returns the value inline (spill would crash)", () => {
    const obj: Record<string, unknown> = { x: 1 };
    obj["self"] = obj;
    const out = maybeSpill(obj, { threshold: 1 });
    // doesn't crash; returns the value (safeSerialize returns null → no spill)
    expect(out).toBe(obj);
  });

  it("HIGH-3: above MAX_SPILL_BYTES returns a truncated marker, not an OOM crash", () => {
    const huge = "x".repeat(10 * 1024 * 1024); // 10 MiB
    const out = maybeSpill(huge, { threshold: 1024, max: 1024 * 1024 /* 1 MiB */ });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("TRUNCATED");
    expect((out as string).length).toBeLessThan(100);
  });
});

describe("§13 maybeSpill — persistence (HIGH-1: TTL sidecar actually written)", () => {
  it("resolves a spilled ref back to the original content + verifies sha (HIGH-4 integrity)", () => {
    const big = "hello ".repeat(3000);
    const ref = maybeSpill(big, { threshold: 1024, ttlS: 60 }) as unknown as LargeValueRef;
    expect(resolveRef(ref)).toBe(big);
  });

  it("CRITICAL-1 (review): a forged refPath pointing outside refsRoot is REJECTED", () => {
    const ref = {
      spilled: true as const,
      hint: "x",
      mimetype: "text/plain",
      refPath: "/etc/passwd",
      expiresAt: Date.now() + 60_000,
      bytes: 0,
      sha: "0".repeat(64),
    } satisfies import("@my-agent/core").LargeValueRef;
    expect(() => resolveRef(ref)).toThrow();
  });

  it("CRITICAL-1 (review): tampering (the file's bytes don't match the sha) is rejected", () => {
    const big = "tamper me ".repeat(500);
    const ref = maybeSpill(big, { threshold: 1024 }) as unknown as LargeValueRef;
    // overwrite the file with different bytes
    const { writeFileSync } = require("node:fs");
    writeFileSync(ref.refPath, "TAMPERED");
    expect(() => resolveRef(ref)).toThrow(/integrity/);
  });

  it("HIGH-1 (review): TTL sidecar (.ttl) is written + sweepRefs honors it", () => {
    const big = "ttl test ".repeat(500);
    const ref = maybeSpill(big, { threshold: 1024, ttlS: 1 }) as { refPath: string; expiresAt: number };
    // the sidecar exists
    expect(require("node:fs").existsSync(`${ref.refPath}.ttl`)).toBe(true);
    // before expiry → sweepRefs(now) deletes NOTHING
    expect(sweepRefs(ref.expiresAt - 100)).toBe(0);
    // after expiry → sweepRefs(now) deletes BOTH the data + sidecar
    const n = sweepRefs(ref.expiresAt + 100);
    expect(n).toBe(1);
    expect(require("node:fs").existsSync(ref.refPath)).toBe(false);
    expect(require("node:fs").existsSync(`${ref.refPath}.ttl`)).toBe(false);
  });
});
