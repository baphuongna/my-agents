import { describe, it, expect } from "vitest";
import { TypedGraph, KnowledgeSource, RagfsRouter, makeRagfsScanner, allowAllScanner, type KGRelation } from "@my-agent/memory";

describe("§8 Phase 9 — TypedGraph (R35 knowledge graph)", () => {
  it("addEntity + addRelation builds a directed adjacency", () => {
    const g = new TypedGraph();
    g.addEntity({ id: "Alice", aliases: ["ali"] });
    g.addEntity({ id: "Project", aliases: [] });
    g.addRelation({ from: "Alice", to: "Project", kind: "link", source: "f1" });
    expect(g.out("Alice").length).toBe(1);
    expect(g.out("Alice")[0]!.to).toBe("Project");
  });

  it("query BFS hop-distance (with cycle protection)", () => {
    const g = new TypedGraph();
    g.addRelation({ from: "A", to: "B", kind: "wikilink", source: "f" });
    g.addRelation({ from: "B", to: "C", kind: "wikilink", source: "f" });
    g.addRelation({ from: "C", to: "A", kind: "wikilink", source: "f" }); // cycle
    const q = g.query("A", 2);
    expect(q.find((n) => n.id === "A")?.dist).toBe(0);
    expect(q.find((n) => n.id === "B")?.dist).toBe(1);
    expect(q.find((n) => n.id === "C")?.dist).toBe(2);
    // A → B → C cycle must not re-emit A at dist 2 (seen-set blocks the cycle).
  });

  it("ingestBacklinks seeds edges + knowledgeGraphSpec returns the R36 shape", () => {
    const g = new TypedGraph();
    g.ingestBacklinks([
      { from: "Note", fromFactId: "f1", to: "Alice", kind: "link" },
      { from: "Doc", fromFactId: "f2", to: "Alice", kind: "wikilink" },
    ]);
    const spec = g.knowledgeGraphSpec();
    expect(spec.relations.length).toBe(2);
    expect(spec.entities.some((e) => e.id === "Alice")).toBe(true);
  });
});

describe("§8 Phase 9 — KnowledgeSource (ragfs knowledge://)", () => {
  it("read a knowledge:// uri returns the entity card", async () => {
    const g = new TypedGraph();
    const src = new KnowledgeSource(g);
    g.addEntity({ id: "Alice", aliases: ["Al"] });
    src.registerCard("Alice", "Alice — Person. Likes tea.");
    const r = new RagfsRouter();
    r.setScanner(allowAllScanner);
    r.register(src);
    expect(await r.read("knowledge://Alice")).toBe("Alice — Person. Likes tea.");
  });

  it("grep matches id + aliases", async () => {
    const g = new TypedGraph();
    const src = new KnowledgeSource(g);
    g.addEntity({ id: "Alice", aliases: ["Al", "Ally"] });
    const r = new RagfsRouter();
    r.setScanner(allowAllScanner);
    r.register(src);
    const hits = await r.grep("Al");
    expect(hits.length).toBe(1); // single entity (Alice) matched by id OR alias
  });

  it("list respects query.text filtering", async () => {
    const g = new TypedGraph();
    const src = new KnowledgeSource(g);
    g.addEntity({ id: "Alice", aliases: [] });
    g.addEntity({ id: "Bob",   aliases: [] });
    src.registerCard("Alice", "alice card"); src.registerCard("Bob", "bob card");
    const r = new RagfsRouter(); r.setScanner(allowAllScanner); r.register(src);
    expect((await r.list({ text: "Alice" })).map((h) => h.id)).toEqual(["Alice"]);
  });
});

describe("§8 Phase 9 — ragfs-bridge (production scanner wiring)", () => {
  it("makeRagfsScanner adapts a (content,scope)=>ScanVerdict fn", () => {
    const scanner = makeRagfsScanner((_content, scope) =>
      scope === "context" ? { allowed: true } : { allowed: false, reason: "wire-only policy" },
    );
    expect(scanner.scan("anything", "context").allowed).toBe(true);
    expect(scanner.scan("anything", "wire").allowed).toBe(false);
  });

  it("denyAllScanner blocks everything", async () => {
    const { denyAllScanner } = await import("@my-agent/memory");
    expect(denyAllScanner!.scan("safe content").allowed).toBe(false);
  });
});
