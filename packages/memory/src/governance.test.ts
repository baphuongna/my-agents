import { describe, it, expect } from "vitest";
import { recallWeight, TRUST_HELPFUL_DELTA, TRUST_UNHELPFUL_DELTA, TRUST_DEFAULT } from "./governance.js";

describe("[unit] memory governance", () => {
  it("constants: trust deltas + default", () => {
    expect(TRUST_HELPFUL_DELTA).toBe(0.05);
    expect(TRUST_UNHELPFUL_DELTA).toBe(-0.10);
    expect(TRUST_DEFAULT).toBe(0.5);
  });

  it("recallWeight = baseScore × trust", () => {
    expect(recallWeight(1.0, 0.5)).toBe(0.5);
    expect(recallWeight(0.8, 0.9)).toBeCloseTo(0.72);
    expect(recallWeight(1.0, 0)).toBe(0);
    expect(recallWeight(0, 1)).toBe(0);
  });

  it("recallWeight: low-trust memories rank lower", () => {
    const highTrust = recallWeight(0.5, 1.0);
    const lowTrust = recallWeight(0.5, 0.1);
    expect(lowTrust).toBeLessThan(highTrust);
  });

  it("recallWeight: trust is a multiplier (not additive)", () => {
    // trust=1 → weight = base; trust=0.5 → weight = base/2
    expect(recallWeight(2.0, 1.0)).toBe(2.0);
    expect(recallWeight(2.0, 0.5)).toBe(1.0);
  });
});
