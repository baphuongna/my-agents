import { describe, it, expect } from "vitest";
import { computeCost } from "@my-agent/core";

describe("computeCost — real per-model pricing (§4/§6)", () => {
  it("gpt-4o: $2.5/1M in, $10/1M out", () => {
    const c = computeCost({ input: 1_000_000, output: 500_000 }, "gpt-4o");
    // 2.5 + (0.5M/1M * 10) = 2.5 + 5 = 7.5
    expect(c.usd).toBeCloseTo(7.5, 6);
  });

  it("gpt-4o-mini substring-matches gpt-4o-mini-2024-07-18", () => {
    const a = computeCost({ input: 1_000_000, output: 0 }, "gpt-4o-mini-2024-07-18");
    const b = computeCost({ input: 1_000_000, output: 0 }, "gpt-4o-mini");
    expect(a.usd).toBe(b.usd);
    expect(a.usd).toBeCloseTo(0.15, 6);
  });

  it("longest-key wins: gpt-4o-mini beats gpt-4o", () => {
    const mini = computeCost({ input: 1_000_000, output: 0 }, "gpt-4o-mini");
    const full = computeCost({ input: 1_000_000, output: 0 }, "gpt-4o");
    expect(mini.usd).toBeLessThan(full.usd); // 0.15 < 2.5
  });

  it("MiniMax-M3 pricing", () => {
    const c = computeCost({ input: 1_000_000, output: 1_000_000 }, "MiniMax-M3");
    expect(c.usd).toBeCloseTo(2.0, 6);
  });

  it("unknown model falls back to a non-zero default (keeps the budget gate real)", () => {
    const c = computeCost({ input: 1_000_000, output: 1_000_000 }, "totally-unknown-model");
    expect(c.usd).toBeGreaterThan(0);
  });

  it("cacheRead billed at 50% of input", () => {
    const c = computeCost({ input: 0, output: 0, cacheRead: 1_000_000 }, "gpt-4o");
    expect(c.usd).toBeCloseTo(1.25, 6); // 2.5 * 0.5
  });

  it("never returns NaN/Infinity", () => {
    const c = computeCost({ input: 0, output: 0 });
    expect(Number.isFinite(c.usd)).toBe(true);
  });
});
