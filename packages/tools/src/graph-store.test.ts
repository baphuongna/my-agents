import { describe, it, expect } from "vitest";
import { GraphStore, type GraphSnapshot } from "./graph-store.js";
import type { Symbol } from "./symbol-extractor.js";
import type { Reference } from "./reference-graph.js";

function makeSymbol(id: string, name: string, file = "a.ts"): Symbol {
  return { id, name, kind: "function", file, range: { start: { line: 1, col: 0 }, end: { line: 2, col: 0 } } } as Symbol;
}
function makeRef(symbolId: string, fromFile = "b.ts", line = 5): Reference {
  return { symbolId, fromFile, fromRange: { start: { line, col: 0 }, end: { line, col: 5 } }, kind: "call" } as Reference;
}

describe("[unit] GraphStore", () => {
  it("addSymbol + get", () => {
    const gs = new GraphStore();
    const s = makeSymbol("id1", "foo");
    gs.addSymbol(s);
    expect(gs.get("id1")).toBe(s);
    expect(gs.size).toBe(1);
  });

  it("addSymbol dedup (same id = no-op)", () => {
    const gs = new GraphStore();
    gs.addSymbol(makeSymbol("id1", "foo"));
    gs.addSymbol(makeSymbol("id1", "foo"));
    expect(gs.size).toBe(1);
  });

  it("idsByName is case-insensitive", () => {
    const gs = new GraphStore();
    gs.addSymbol(makeSymbol("a", "Foo"));
    gs.addSymbol(makeSymbol("b", "foo"));
    expect(gs.idsByName("FOO").sort()).toEqual(["a", "b"]);
    expect(gs.idsByName("foo").sort()).toEqual(["a", "b"]);
  });

  it("idsByFile", () => {
    const gs = new GraphStore();
    gs.addSymbol(makeSymbol("a", "x", "one.ts"));
    gs.addSymbol(makeSymbol("b", "y", "one.ts"));
    gs.addSymbol(makeSymbol("c", "z", "two.ts"));
    expect(gs.idsByFile("one.ts").sort()).toEqual(["a", "b"]);
    expect(gs.idsByFile("two.ts")).toEqual(["c"]);
    expect(gs.idsByFile("missing.ts")).toEqual([]);
  });

  it("addReference appends to list", () => {
    const gs = new GraphStore();
    gs.addReference(makeRef("sym1", "b.ts", 1));
    gs.addReference(makeRef("sym1", "c.ts", 2));
    expect(gs.refs.get("sym1")).toHaveLength(2);
  });

  it("toJSON serializes + sorts by id", () => {
    const gs = new GraphStore();
    gs.addSymbol(makeSymbol("z-id", "z"));
    gs.addSymbol(makeSymbol("a-id", "a"));
    const snap = gs.toJSON();
    expect(snap.version).toBe(1);
    expect(snap.symbols.map(s => s.id)).toEqual(["a-id", "z-id"]);
  });

  it("toJSON includes refs sorted", () => {
    const gs = new GraphStore();
    gs.addReference(makeRef("sym-b", "x.ts", 10));
    gs.addReference(makeRef("sym-a", "y.ts", 5));
    const snap = gs.toJSON();
    expect(snap.refs[0]!.symbolId).toBe("sym-a");
    expect(snap.refs[1]!.symbolId).toBe("sym-b");
  });

  it("fromJSON round-trip restores all data", () => {
    const gs1 = new GraphStore();
    gs1.addSymbol(makeSymbol("id1", "foo"));
    gs1.addSymbol(makeSymbol("id2", "bar", "other.ts"));
    gs1.addReference(makeRef("id1", "caller.ts", 3));
    const snap = gs1.toJSON();

    const gs2 = GraphStore.fromJSON(snap);
    expect(gs2.size).toBe(2);
    expect(gs2.get("id1")?.name).toBe("foo");
    expect(gs2.idsByName("bar")).toEqual(["id2"]);
    expect(gs2.refs.get("id1")).toHaveLength(1);
  });

  it("fromJSON rejects unknown version", () => {
    expect(() => GraphStore.fromJSON({ version: 99, symbols: [], refs: [] } as unknown as GraphSnapshot)).toThrow(/unsupported version/);
  });

  it("empty store toJSON/fromJSON", () => {
    const gs = new GraphStore();
    const snap = gs.toJSON();
    expect(snap.symbols).toEqual([]);
    expect(snap.refs).toEqual([]);
    const restored = GraphStore.fromJSON(snap);
    expect(restored.size).toBe(0);
  });
});
