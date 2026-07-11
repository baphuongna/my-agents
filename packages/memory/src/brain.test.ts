import { describe, it, expect } from "vitest";
import { Brain } from "@my-agent/memory";
import { nowWallclock } from "@my-agent/core";

describe("Brain — DoS caps (F7)", () => {
  it("truncates oversized fact content", () => {
    const brain = new Brain();
    const big = "x".repeat(10_000);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: big, visibility: "private", notability: 1, source: "s" });
    expect(f.content.length).toBeLessThan(10_000);
    expect(f.content).toContain("[truncated]");
  });

  it("rejects beyond the total-fact cap", () => {
    const brain = new Brain();
    // poke the cap constant via reflection (maxFactsTotal)
    const max = (brain as unknown as { maxFactsTotal: number }).maxFactsTotal;
    for (let i = 0; i < max; i++) brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" });
    expect(() => brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" })).toThrow(/cap/);
  });
});

describe("§8 Phase 8 — dream-cycle phases (backlinks + purge)", () => {
  it("backlinks extracts zero-LLM typed edges from fact content", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "see [Bob](/people/bob) and [[Charlie]] for context", visibility: "private", notability: 1, source: "s" });
    const edges = brain.backlinks();
    const k = edges.map((e) => e.kind + ":" + e.to).sort();
    expect(k).toContain("link:/people/bob");
    expect(k).toContain("wikilink:Charlie");
  });
  it("purge removes only facts past validUntil", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "old", visibility: "private", notability: 1, source: "s", validUntil: 1000 });
    brain.recordFact({ kind: "fact", entity: "e", content: "current", visibility: "private", notability: 1, source: "s", validUntil: nowWallclock() + 100_000 });
    const n = brain.purge(2000);
    expect(n).toBe(1);
    expect(brain.backlinks().length).toBe(0);
  });
});
