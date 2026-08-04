import { describe, it, expect } from "vitest";
import { DriftGrader, identityCompressor, type DriftGrade } from "./drift.js";
import type { Compressor, LlmTrace } from "@my-agent/core";

function makeGolden(response: string, messages: unknown[] = [{ role: "user", content: "hi" }]): { trace: LlmTrace; expectedResponse: string } {
  return { trace: { messages, responses: [response] }, expectedResponse: response };
}

describe("[unit] prompts drift", () => {
  it("identityCompressor: compress = identity (same array length)", () => {
    const msgs = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }];
    expect(identityCompressor.compress(msgs)).toBe(msgs); // returns same ref
    expect(identityCompressor.ratio()).toBe(1.0);
  });

  it("DriftGrader: empty golden → passRate 1, delta 0", () => {
    const g = new DriftGrader().grade([]);
    expect(g.passRate).toBe(1);
    expect(g.maxScoreDelta).toBe(0);
  });

  it("DriftGrader: identity compressor → no drift (passRate 1)", () => {
    const grader = new DriftGrader(identityCompressor);
    const result = grader.grade([makeGolden("hello"), makeGolden("world")]);
    expect(result.passRate).toBe(1);
    expect(result.maxScoreDelta).toBe(0);
  });

  it("DriftGrader: mismatched response → drift detected", () => {
    const golden = [{ trace: { messages: [{ role: "user", content: "x" }], responses: ["wrong"] }, expectedResponse: "right" }];
    const result = new DriftGrader(identityCompressor).grade(golden);
    expect(result.passRate).toBe(0);
    expect(result.maxScoreDelta).toBe(1);
  });

  it("DriftGrader: partial pass (some drift)", () => {
    const golden = [makeGolden("ok"), makeGolden("also-ok"), {
      trace: { messages: [{ role: "user", content: "x" }], responses: ["bad"] },
      expectedResponse: "good",
    }];
    const result = new DriftGrader(identityCompressor).grade(golden);
    expect(result.passRate).toBeCloseTo(2 / 3);
  });

  it("DriftGrader: compressor that changes length → drift", () => {
    const shrinkingCompressor: Compressor = {
      compress: (h) => h.slice(0, 1), // drops entries
      ratio: () => 0.5,
    };
    const golden = [makeGolden("ok", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }])];
    const result = new DriftGrader(shrinkingCompressor).grade(golden);
    expect(result.passRate).toBe(0); // length changed → drift
  });
});
