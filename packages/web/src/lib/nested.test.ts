/**
 * Nested object access unit tests — pure logic, no DOM.
 *
 * Covers: get/set, missing intermediates, immutability (structuredClone), and
 * edge cases.
 */
import { describe, it, expect } from "vitest";
import { getNestedValue, setNestedValue } from "@/lib/nested";

describe("[unit] getNestedValue", () => {
  it("reads a deeply nested value", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getNestedValue(obj, "a.b.c")).toBe(42);
  });

  it("returns the value at a single-segment path", () => {
    const obj = { x: "hi" };
    expect(getNestedValue(obj, "x")).toBe("hi");
  });

  it("returns undefined when an intermediate is missing", () => {
    const obj = { a: { b: {} } };
    expect(getNestedValue(obj, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when the root is missing the first key", () => {
    expect(getNestedValue({}, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when traversing into a primitive", () => {
    const obj = { a: 5 };
    expect(getNestedValue(obj, "a.b")).toBeUndefined();
  });

  it("returns undefined for a null intermediate", () => {
    const obj = { a: null };
    expect(getNestedValue(obj, "a.b")).toBeUndefined();
  });
});

describe("[unit] setNestedValue", () => {
  it("writes a deeply nested value and returns the updated clone", () => {
    const obj = { a: { b: { c: 1 } } };
    const next = setNestedValue(obj, "a.b.c", 99);
    expect(getNestedValue(next, "a.b.c")).toBe(99);
  });

  it("does not mutate the original object (immutability)", () => {
    const obj = { a: { b: { c: 1 } } };
    setNestedValue(obj, "a.b.c", 99);
    expect(getNestedValue(obj, "a.b.c")).toBe(1);
    // original reference identity preserved
    expect(obj.a.b).toBe(obj.a.b);
  });

  it("creates intermediate objects for a missing path", () => {
    const obj: Record<string, unknown> = {};
    const next = setNestedValue(obj, "x.y.z", "deep");
    expect(getNestedValue(next, "x.y.z")).toBe("deep");
    // original still empty
    expect(obj).toEqual({});
  });

  it("overwrites a non-object intermediate with an object", () => {
    const obj = { a: { b: "not-an-object" } };
    const next = setNestedValue(obj, "a.b.c", "value");
    expect(getNestedValue(next, "a.b.c")).toBe("value");
  });

  it("preserves sibling keys not on the path", () => {
    const obj = { a: { b: 1, keep: true } };
    const next = setNestedValue(obj, "a.b", 2);
    expect(getNestedValue(next, "a.keep")).toBe(true);
    expect(getNestedValue(next, "a.b")).toBe(2);
  });

  it("handles a single-segment path", () => {
    const obj = { a: 1 };
    const next = setNestedValue(obj, "a", 2);
    expect(next.a).toBe(2);
    expect(obj.a).toBe(1); // original untouched
  });

  it("deeply clones nested arrays/objects (no shared references)", () => {
    const obj = { list: [{ v: 1 }] };
    const next = setNestedValue(obj, "list.0.v", 2);
    expect(getNestedValue(next, "list.0.v")).toBe(2);
    // mutating the clone's array must not affect the original
    expect((obj.list[0] as { v: number }).v).toBe(1);
  });
});
