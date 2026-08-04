import { describe, it, expect } from "vitest";
import { canonicalJson, sortKeys, stableStringify, canonicalEqual } from "./canonical-json.js";

describe("[unit] canonical-json", () => {
  it("canonicalJson sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("canonicalJson produces no whitespace", () => {
    expect(canonicalJson({ a: { c: 3, b: 2 } })).not.toMatch(/\s/);
  });

  it("identical logical content → identical bytes (order-independent)", () => {
    const a = { z: 1, a: { y: 2, x: 3 } };
    const b = { a: { x: 3, y: 2 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("sortKeys preserves array order", () => {
    expect(sortKeys([3, 1, 2])).toEqual([3, 1, 2]);
    expect(sortKeys([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });

  it("stableStringify supports indent", () => {
    const out = stableStringify({ b: 1, a: 2 }, 2);
    expect(out).toContain('\n  "a"');
    expect(out).toContain('\n  "b"');
  });

  it("canonicalEqual — order-independent deep equality", () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(canonicalEqual([1, 2], [2, 1])).toBe(false); // arrays order-sensitive
  });

  it("handles primitives (string/number/bool/null)", () => {
    expect(canonicalJson("hi")).toBe('"hi"');
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(null)).toBe("null");
  });

  it("NFC normalization (canonical form)", () => {
    // é decomposed (e + combining accent) → composed (é) after NFC
    expect(canonicalJson("e\u0301")).toBe(canonicalJson("\u00e9"));
  });
});
