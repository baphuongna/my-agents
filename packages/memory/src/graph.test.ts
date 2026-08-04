import { describe, it, expect } from "vitest";
import { TypedGraph, type KGEntity, type KGRelation } from "./graph.js";

describe("[unit] memory TypedGraph", () => {
  it("addEntity + allEntities", () => {
    const g = new TypedGraph();
    g.addEntity({ id: "alice", type: "person", aliases: ["Alice", "AL"] });
    const ents = g.allEntities();
    expect(ents).toHaveLength(1);
    expect(ents[0]!.id).toBe("alice");
    expect(ents[0]!.aliases).toEqual(["Alice", "AL"]);
  });

  it("addEntity dedupes aliases (union)", () => {
    const g = new TypedGraph();
    g.addEntity({ id: "x", aliases: ["a", "b"] });
    g.addEntity({ id: "x", aliases: ["b", "c"] });
    expect(g.allEntities()[0]!.aliases.sort()).toEqual(["a", "b", "c"]);
  });

  it("addRelation auto-declares endpoints", () => {
    const g = new TypedGraph();
    g.addRelation({ from: "a", to: "b", kind: "link", source: "f1" });
    const ids = g.allEntities().map(e => e.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("addRelation dedup identical edges", () => {
    const g = new TypedGraph();
    g.addRelation({ from: "a", to: "b", kind: "link", source: "f1" });
    g.addRelation({ from: "a", to: "b", kind: "link", source: "f1" });
    expect(g.out("a")).toHaveLength(1);
  });

  it("addRelation allows different kind/source", () => {
    const g = new TypedGraph();
    g.addRelation({ from: "a", to: "b", kind: "link", source: "f1" });
    g.addRelation({ from: "a", to: "b", kind: "wikilink", source: "f2" });
    expect(g.out("a")).toHaveLength(2);
  });

  it("out() returns [] for unknown entity", () => {
    expect(new TypedGraph().out("nope")).toEqual([]);
  });

  it("query: unknown seed → [] (H1 fix)", () => {
    const g = new TypedGraph();
    g.addEntity({ id: "a", aliases: [] });
    expect(g.query("unknown")).toEqual([]);
  });

  it("query: BFS hop-distance", () => {
    const g = new TypedGraph();
    g.addRelation({ from: "a", to: "b", kind: "link", source: "s" });
    g.addRelation({ from: "b", to: "c", kind: "link", source: "s" });
    const results = g.query("a", 2);
    const ids = results.map(r => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    const bNode = results.find(r => r.id === "b");
    expect(bNode?.dist).toBe(1);
    const cNode = results.find(r => r.id === "c");
    expect(cNode?.dist).toBe(2);
  });

  it("query: maxDepth limits reachable nodes", () => {
    const g = new TypedGraph();
    g.addRelation({ from: "a", to: "b", kind: "link", source: "s" });
    g.addRelation({ from: "b", to: "c", kind: "link", source: "s" });
    const results = g.query("a", 1); // depth 1 → a, b only
    const ids = results.map(r => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });

  it("query: seed at distance 0", () => {
    const g = new TypedGraph();
    g.addEntity({ id: "root", aliases: [] });
    const results = g.query("root");
    expect(results.find(r => r.id === "root")?.dist).toBe(0);
  });

  it("ingestBacklinks seeds entity→entity graph (CRITICAL-1)", () => {
    const g = new TypedGraph();
    g.ingestBacklinks([
      { from: "Alice", to: "Bob", kind: "link", fromFactId: "fact-1" },
      { from: "Alice", to: "Charlie", kind: "wikilink" },
    ]);
    expect(g.allEntities().map(e => e.id).sort()).toEqual(["Alice", "Bob", "Charlie"]);
    expect(g.out("Alice")).toHaveLength(2);
  });

  it("knowledgeGraphSpec returns entities + relations", () => {
    const g = new TypedGraph();
    g.addEntity({ id: "x", type: "person", aliases: [] });
    g.addRelation({ from: "x", to: "y", kind: "link", source: "s1" });
    const spec = g.knowledgeGraphSpec();
    expect(spec.entities).toHaveLength(2);
    expect(spec.relations).toHaveLength(1);
    expect(spec.relations[0]).toMatchObject({ from: "x", to: "y", kind: "link", link_source: "s1" });
  });
});
