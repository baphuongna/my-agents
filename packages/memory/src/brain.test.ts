import { describe, it, expect } from "vitest";
import { Brain } from "@my-agent/memory";

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
