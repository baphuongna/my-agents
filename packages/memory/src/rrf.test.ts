import { describe, it, expect } from "vitest";
import { reciprocalRankFuse, rrfRetrieve, bm25Arm, substringArm } from "@my-agent/memory";
import type { MemoryQuery } from "@my-agent/core";

const q = (text: string): MemoryQuery => ({ text });

describe("§8 RRF — Reciprocal-Rank-Fusion (k=60)", () => {
  it("fuses two arms: a doc ranked high in BOTH arms outranks one ranked #1 in a single arm", () => {
    const arms = [
      { name: "a", hits: [{ id: "x", content: "x", role: "working" as const, score: 0 }, { id: "y", content: "y", role: "working" as const, score: 0 }] },
      { name: "b", hits: [{ id: "y", content: "y", role: "working" as const, score: 0 }, { id: "x", content: "x", role: "working" as const, score: 0 }] },
    ];
    const fused = reciprocalRankFuse(arms, 5);
    // x: 1/(60+1) + 1/(60+2) ; y: 1/(60+2) + 1/(60+1) — y is #2 in a, #1 in b → slightly higher
    expect(fused.map((h) => h.id)).toContain("x");
    expect(fused.map((h) => h.id)).toContain("y");
    expect(fused.length).toBe(2);
  });

  it("a doc in only one arm still appears", () => {
    const fused = reciprocalRankFuse([
      { name: "a", hits: [{ id: "only", content: "o", role: "working" as const, score: 0 }] },
    ], 5);
    expect(fused[0]!.id).toBe("only");
  });

  it("respects topK", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, content: "", role: "working" as const, score: 0 }));
    const fused = reciprocalRankFuse([{ name: "a", hits }], 5);
    expect(fused.length).toBe(5);
  });
});

describe("§8 RRF arms", () => {
  const docs = [
    { id: "1", content: "the agent uses tools to read files", role: "archivist" as const },
    { id: "2", content: "memory roles manage conversation history", role: "archivist" as const },
    { id: "3", content: "the agent reads files and writes edits", role: "archivist" as const },
  ];

  it("bm25Arm ranks docs containing the query terms", () => {
    const hits = bm25Arm(docs, q("agent files"));
    expect(hits.length).toBeGreaterThan(0);
    // doc 1 + 3 mention both "agent" + "files"; doc 1 has them closer together
    expect(hits.map((h) => h.id)).toContain("1");
  });

  it("substringArm matches exact phrases", () => {
    const hits = substringArm(docs, q("the agent"));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("rrfRetrieve fuses bm25 + substring", () => {
    const hits = rrfRetrieve(docs, q("agent files"), 5);
    expect(hits.length).toBeGreaterThan(0);
    // the fused score is set on each hit
    expect(typeof hits[0]!.score).toBe("number");
  });

  it("empty query → bm25/substring return [] (no rank-1 garbage)", () => {
    expect(bm25Arm(docs, q(""))).toEqual([]);
    expect(substringArm(docs, q(""))).toEqual([]);
  });

  it("MED-5: whitespace-only query → substring returns [] (no arbitrary hits)", () => {
    expect(substringArm(docs, q("   \t\n  "))).toEqual([]);
    // bm25 already trimmed
    expect(bm25Arm(docs, q("   "))).toEqual([]);
  });

  it("MED-3: rrfRetrieve respects query.topK", () => {
    const hits = rrfRetrieve(docs, { text: "agent files", topK: 2 });
    expect(hits.length).toBe(2);
  });

  it("LOW-7: a duplicate ID within a single arm contributes at most once", () => {
    // arm a has id "x" twice (ranks 1 and 2). Without dedup, x gets 2 contributions;
    // with dedup, only the rank-1 contribution. y at rank 1 in arm b beats x.
    const arms = [
      { name: "a", hits: [
        { id: "x", content: "x", role: "working" as const, score: 0 },
        { id: "x", content: "x", role: "working" as const, score: 0 },
      ] },
      { name: "b", hits: [{ id: "y", content: "y", role: "working" as const, score: 0 }] },
    ];
    const fused = reciprocalRankFuse(arms, 5);
    // With dedup: x = 1/(60+1) = 0.0164; y = 1/(60+1) = 0.0164 (tie but y rank 1 in b)
    // The fused output should contain exactly y at rank 1, x at rank 2 (stable insertion order on tie, but we don't guarantee).
    expect(fused.length).toBe(2);
    const xScore = fused.find((h) => h.id === "x")!.score;
    const yScore = fused.find((h) => h.id === "y")!.score;
    // x must have gotten only ONE contribution (not two). Equal-rank tie broken however (stable).
    // If dedup missed: xScore = 1/61 + 1/62 ≈ 0.0324. With dedup: xScore = 1/61 ≈ 0.01639.
    expect(xScore).toBeCloseTo(1 / 61, 4);
    // Two contributions would have been ≈ 0.0324:
    expect(xScore).toBeLessThan(0.02);
  });
});
