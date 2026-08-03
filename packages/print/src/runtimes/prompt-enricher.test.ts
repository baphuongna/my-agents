import { describe, it, expect } from "vitest";
import { MemoryEnricher } from "./enricher.js";

function mockMemory(hits: any[]) {
  return { recall: (_q: string, _o?: any) => [{ domain: "test", hits }] };
}
function mockBrain() {
  const facts: any[] = [];
  return { recordFact: async (f: any) => { facts.push(f); }, _facts: facts };
}
function makeCtx() {
  return { sessionId: "s1", runtimeType: "pi", executionModel: "in-process" as const };
}

describe("[unit] MemoryEnricher", () => {
  it("returns raw prompt when no memory", async () => {
    const e = new MemoryEnricher();
    expect(await e.enrich("hello", makeCtx())).toBe("hello");
  });

  it("injects memory context above prompt", async () => {
    const e = new MemoryEnricher(mockMemory([{ id: "h1", content: "User prefers TS", score: 0.9 }]) as any, mockBrain() as any);
    const result = await e.enrich("write code", makeCtx());
    expect(result).toContain("<memory>");
    expect(result).toContain("User prefers TS");
    expect(result.endsWith("write code")).toBe(true);
  });

  it("filters hits below minScore", async () => {
    const e = new MemoryEnricher(mockMemory([{ id: "h1", content: "low", score: 0.1 }]) as any);
    expect(await e.enrich("test", makeCtx())).toBe("test");
  });

  it("limits hits to maxInjectionHits", async () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, content: `fact ${i}`, score: 0.8 }));
    const e = new MemoryEnricher(mockMemory(hits) as any);
    const result = await e.enrich("test", makeCtx());
    const lines = result.split("\n").filter(l => /^\d+\./.test(l));
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("enrich error returns raw prompt", async () => {
    const badMemory = { recall: () => { throw new Error("fail"); } };
    const e = new MemoryEnricher(badMemory as any);
    expect(await e.enrich("test", makeCtx())).toBe("test");
  });

  it("capture calls brain.recordFact", async () => {
    const brain = mockBrain();
    const e = new MemoryEnricher(undefined, brain as any);
    await e.capture("some output text", makeCtx());
    expect(brain._facts).toHaveLength(1);
  });

  it("capture with empty output does nothing", async () => {
    const brain = mockBrain();
    const e = new MemoryEnricher(undefined, brain as any);
    await e.capture("", makeCtx());
    expect(brain._facts).toHaveLength(0);
  });
});
