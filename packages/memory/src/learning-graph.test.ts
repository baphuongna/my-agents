/**
 * Tests for the learning-graph module (D2: concept→concept derivation).
 *
 * Covers: deriveLearningGraph, graphToDot.
 *
 * `deriveLearningGraph` consumes a `Brain` via two zero-LLM surfaces:
 *   - extractFacts() → structured atoms {kind:"date"|"url"|"email"|"commit"|"version", value}
 *   - backlinks()    → typed edges from markdown links/wikilinks in fact content
 * So fixtures use fact content containing extractable atoms (dates, versions, urls)
 * and markdown links to deterministically drive node/edge creation.
 */
import { describe, it, expect } from "vitest";
import { Brain } from "@my-agent/memory";
import { deriveLearningGraph, graphToDot, type LearningGraph } from "./learning-graph.js";

/** Convenience to record a fact with sane defaults. */
function fact(brain: Brain, entity: string, content: string): void {
  brain.recordFact({
    kind: "fact",
    entity,
    content,
    visibility: "private",
    notability: 1,
    source: "s",
  });
}

describe("deriveLearningGraph", () => {
  it("returns an empty graph for a brain with no extractable atoms", () => {
    const brain = new Brain();
    fact(brain, "Plain", "just some prose with no dates or versions");
    const g = deriveLearningGraph(brain);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("creates one node per extracted atom (label/type derived)", () => {
    const brain = new Brain();
    fact(brain, "Project", "shipped on 2024-01-15");
    const g = deriveLearningGraph(brain);
    expect(g.nodes).toHaveLength(1);
    const n = g.nodes[0]!;
    expect(n.id).toBe("2024-01-15");
    expect(n.label).toBe("2024-01-15");
    expect(n.type).toBe("date");
    expect(n.weight).toBe(1);
  });

  it("increments weight when the same atom value repeats", () => {
    const brain = new Brain();
    fact(brain, "A", "event on 2024-01-15");
    fact(brain, "B", "another event on 2024-01-15");
    const g = deriveLearningGraph(brain);
    const node = g.nodes.find((n) => n.id === "2024-01-15");
    expect(node).toBeDefined();
    expect(node!.weight).toBe(2);
  });

  it("creates a 'learned-from' edge between distinct same-kind atoms", () => {
    const brain = new Brain();
    fact(brain, "X", "upgraded to v1.0.0 then v2.0.0");
    const g = deriveLearningGraph(brain);
    const lf = g.edges.filter((e) => e.kind === "learned-from");
    expect(lf).toHaveLength(1);
    expect(lf[0]!.from).toBe("1.0.0");
    expect(lf[0]!.to).toBe("2.0.0");
  });

  it("creates a 'related-to' edge from a markdown link to an extracted url node", () => {
    const brain = new Brain();
    fact(brain, "Project", "docs at [here](https://example.com/y) shipped v3.0.0");
    const g = deriveLearningGraph(brain);
    // url atom → node "https://example.com/y"; the link backlink (kind "link",
    // not "bare") with `to` matching that node becomes a related-to edge.
    const rel = g.edges.find((e) => e.kind === "related-to");
    expect(rel).toBeDefined();
    expect(rel!.from).toBe("project"); // entity lowercased + dash-collapsed
    expect(rel!.to).toBe("https://example.com/y");
  });

  it("filters nodes by topic (case-insensitive substring on atom value)", () => {
    const brain = new Brain();
    fact(brain, "A", "v1.0.0 on 2024-01-15");
    fact(brain, "B", "v2.0.0 on 2024-02-20");
    // Without topic → all 4 atoms become nodes.
    expect(deriveLearningGraph(brain).nodes).toHaveLength(4);
    // With topic "2024-01" → only the 2024-01-15 date atom survives.
    const g = deriveLearningGraph(brain, "2024-01");
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]!.id).toBe("2024-01-15");
  });
});

describe("graphToDot", () => {
  it("emits a minimal valid digraph for an empty graph", () => {
    const dot = graphToDot({ nodes: [], edges: [] });
    expect(dot).toBe("digraph learning {\n}");
    expect(dot.startsWith("digraph learning {")).toBe(true);
    expect(dot.endsWith("}")).toBe(true);
  });

  it("renders each node with a label and weight attribute", () => {
    const g: LearningGraph = {
      nodes: [{ id: "alpha", label: "Alpha One", type: "fact", weight: 3 }],
      edges: [],
    };
    const dot = graphToDot(g);
    expect(dot).toContain('"alpha" [label="Alpha One", weight=3];');
  });

  it("renders each edge with a -> arrow and kind label", () => {
    const g: LearningGraph = {
      nodes: [
        { id: "a", label: "A", type: "fact", weight: 1 },
        { id: "b", label: "B", type: "fact", weight: 1 },
      ],
      edges: [{ from: "a", to: "b", kind: "learned-from" }],
    };
    const dot = graphToDot(g);
    expect(dot).toContain('"a" -> "b" [label="learned-from"];');
  });

  it("round-trips the output of deriveLearningGraph", () => {
    const brain = new Brain();
    fact(brain, "X", "v1.0.0 then v2.0.0");
    const g = deriveLearningGraph(brain);
    const dot = graphToDot(g);
    expect(dot.startsWith("digraph learning {")).toBe(true);
    expect(dot.endsWith("}")).toBe(true);
    // every node id appears quoted, every edge arrow appears.
    for (const n of g.nodes) expect(dot).toContain(`"${n.id}"`);
    for (const e of g.edges) expect(dot).toContain(`"${e.from}" -> "${e.to}"`);
  });
});
