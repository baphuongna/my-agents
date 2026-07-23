/**
 * §22 P0 Spec Compliance — critical invariants from AGENTS.md / AGENT-SPEC.
 *
 * These are non-negotiable, repo-wide correctness guarantees. Each describe
 * block pins one invariant with a focused unit test.
 *
 *   1. Invariant #10 — single time helper (core.time); no bare Date.now() in core.
 *   2. Byte-faithful JSON — canonical-json determinism (no packages/json exists;
 *      the canonical impl lives in packages/core/src/canonical-json.ts).
 *   3. NativeResult pattern — natives never throw on bad input → empty arrays.
 *   4. Single source of time — nowWallclock/nowMonotonic exported only from time.ts.
 *   5. Discriminated unions — ToolResult.ok discriminates success/error.
 *   6. TS strict mode — exported types are real shapes, not `any`.
 *
 * Source:
 *   - packages/core/src/time.ts
 *   - packages/core/src/canonical-json.ts
 *   - packages/natives/src/index.ts
 *   - packages/core/src/types.ts
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  nowWallclock,
  nowMonotonic,
  setTimeProvider,
  today,
} from "../../../packages/core/src/time.ts";
import {
  canonicalJson,
  canonicalEqual,
  stableStringify,
} from "../../../packages/core/src/canonical-json.ts";
import { nativeHash, nativeGlob, nativeGrep } from "../../../packages/natives/src/index.ts";
import type { ToolResult } from "../../../packages/core/src/types.ts";

const CORE_SRC = join(process.cwd(), "packages", "core", "src");

/** Strip // line comments and /* block comments so prose doesn't trip invariant scans. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

// ───────────────────────────────────────────────────────────────────────────
// Invariant #10 — single time helper (core.time)
// ───────────────────────────────────────────────────────────────────────────
describe("[§22.1] core.time — single time helper (invariant #10)", () => {
  it("nowWallclock() returns a finite number", () => {
    const t = nowWallclock();
    expect(typeof t).toBe("number");
    expect(Number.isFinite(t)).toBe(true);
  });

  it("nowMonotonic() returns a finite number and is non-decreasing", () => {
    const a = nowMonotonic();
    const b = nowMonotonic();
    const c = nowMonotonic();
    expect(Number.isFinite(a)).toBe(true);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });

  it("nowWallclock() tracks epoch milliseconds (bounded by Date.now() bracket)", () => {
    // NB: the invariant forbids bare Date.now() in *production* source — the test
    // itself may use it purely as an oracle for the wallclock value.
    const before = Date.now();
    const t = nowWallclock();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("setTimeProvider() injects a fake clock (test hook) and is observable", () => {
    const fixed = 1_700_000_000_000;
    setTimeProvider({ nowWallclock: () => fixed, nowMonotonic: () => 4242 });
    try {
      expect(nowWallclock()).toBe(fixed);
      expect(nowMonotonic()).toBe(4242);
      expect(today()).toBe(Math.floor(fixed / 86_400_000));
    } finally {
      // restore the real provider so other tests are unaffected
      setTimeProvider({
        nowWallclock: () => Date.now(),
        nowMonotonic: () =>
          typeof performance !== "undefined" ? performance.now() * 1000 : Date.now(),
      });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant #10 (scope) — Date.now() / time exports live only in time.ts
// ───────────────────────────────────────────────────────────────────────────
describe("[§22.2] single source of time — only time.ts in packages/core/src", () => {
  it("Date.now() appears ONLY in time.ts within core/src (non-test files)", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(CORE_SRC)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      if (file === "time.ts") continue; // the single sanctioned home of Date.now()
      const src = stripComments(readFileSync(join(CORE_SRC, file), "utf8"));
      if (src.includes("Date.now(")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("nowWallclock / nowMonotonic are declared ONLY in time.ts within core/src", () => {
    const exporters: string[] = [];
    for (const file of readdirSync(CORE_SRC)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "time.ts") continue;
      const src = stripComments(readFileSync(join(CORE_SRC, file), "utf8"));
      if (/export\s+(async\s+)?function\s+now(Wallclock|Monotonic)\b/.test(src)) {
        exporters.push(file);
      }
    }
    expect(exporters).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Byte-faithful JSON (canonical-json)
// ───────────────────────────────────────────────────────────────────────────
describe("[§22.3] byte-faithful JSON — canonical-json determinism", () => {
  it("canonicalJson is deterministic: identical logical content → identical bytes", () => {
    const a = { b: 2, a: 1, c: { z: 26, y: 25 } };
    const b = { c: { y: 25, z: 26 }, a: 1, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("canonicalJson sorts keys recursively and emits no insignificant whitespace", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
    expect(canonicalJson({ a: [1, 2], b: "c" })).not.toMatch(/\s/);
  });

  it("round-trip preserves logical content: JSON.parse(canonicalJson(x)) deep-equals x", () => {
    const obj = { name: "agent", nested: { list: [3, 2, 1], flag: true }, n: null };
    expect(JSON.parse(canonicalJson(obj))).toEqual(obj);
  });

  it("canonicalEqual is order-independent deep equality (and stableStringify honours indent)", () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1 }, { a: 2 })).toBe(false);
    const pretty = stableStringify({ b: 1, a: 2 }, 2);
    expect(pretty.indexOf('"a"')).toBeLessThan(pretty.indexOf('"b"'));
    expect(JSON.parse(pretty)).toEqual({ b: 1, a: 2 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NativeResult pattern — natives never throw on bad input
// ───────────────────────────────────────────────────────────────────────────
describe("[§22.4] NativeResult pattern — natives return values, never throw", () => {
  it("nativeHash returns a 64-hex string, is deterministic, and never throws (even empty)", () => {
    const h = nativeHash("");
    expect(typeof h).toBe("string");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(nativeHash("payload")).toBe(nativeHash("payload"));
  });

  it("nativeGlob returns [] (never throws) for a nonexistent root", () => {
    const out = nativeGlob("**/*.ts", join(CORE_SRC, "__definitely_missing__"));
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });

  it("nativeGrep returns [] (never throws) for an invalid regex", () => {
    const out = nativeGrep("(unclosed", CORE_SRC, {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Discriminated unions + TS strict mode
// ───────────────────────────────────────────────────────────────────────────
describe("[§22.5] discriminated unions + strict types — ToolResult.ok", () => {
  it("ToolResult.ok is the sole discriminator of success (output) vs failure (error)", () => {
    const success: ToolResult = { callId: "c1", ok: true, output: { answer: 42 } };
    const failure: ToolResult = {
      callId: "c2",
      ok: false,
      output: null,
      error: "boom",
      degraded: true,
    };
    // success variant: ok === true, carries output, no error
    expect(success.ok).toBe(true);
    expect(success.output).toEqual({ answer: 42 });
    expect(success.error).toBeUndefined();
    // failure variant: ok === false, carries a string error
    expect(failure.ok).toBe(false);
    expect(typeof failure.error).toBe("string");
    expect(failure.degraded).toBe(true);

    // strict-mode mirror: known fields are strongly-typed primitives, not `any`
    const callId: string = success.callId;
    const ok: boolean = success.ok;
    expect(typeof callId).toBe("string");
    expect(typeof ok).toBe("boolean");
  });
});
