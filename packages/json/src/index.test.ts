import { describe, it, expect } from "vitest";
import { canonicalJson, canonicalEqual } from "@my-agent/json";

describe("Byte-faithful canonical JSON (§18 invariant: deterministic key order)", () => {
  it("produces identical bytes regardless of insertion order", () => {
    const a = canonicalJson({ b: 2, a: 1, c: { z: 9, y: 8 } });
    const b = canonicalJson({ c: { y: 8, z: 9 }, a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("sorts keys recursively + deeply", () => {
    expect(canonicalJson({ z: 1, a: { m: 1, b: 2 } })).toBe(
      canonicalJson({ a: { b: 2, m: 1 }, z: 1 }),
    );
  });

  it("canonicalEqual ignores key order", () => {
    expect(canonicalEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(canonicalEqual({ x: 1 }, { x: 2 })).toBe(false);
  });

  it("is stable across runs (no Date/random leakage)", () => {
    const o = { n: 3, list: [3, 1, 2], nested: { k: "v" } };
    expect(canonicalJson(o)).toBe(canonicalJson(o));
  });
});
