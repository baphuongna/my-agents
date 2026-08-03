import { describe, it, expect } from "vitest";
import { CostTrackerImpl } from "./cost-tracker.js";
import type { AgentEvent } from "@my-agent/core";

describe("[unit] CostTrackerImpl", () => {
  it("record accumulates tokens from turn_end", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "pi");
    const e: AgentEvent = { type: "turn_end", tokensIn: 1000, tokensOut: 500 };
    ct.record("s1", e);
    ct.record("s1", e);
    const cost = ct.getSessionCost("s1")!;
    expect(cost.turns).toBe(2);
    expect(cost.totalUsd).toBeGreaterThan(0);
  });

  it("costUsd from event takes precedence", () => {
    const ct = new CostTrackerImpl();
    const e: AgentEvent = { type: "turn_end", tokensIn: 0, tokensOut: 0, costUsd: 0.05 };
    ct.record("s1", e);
    expect(ct.getSessionCost("s1")!.totalUsd).toBe(0.05);
  });

  it("mya-native uses cheaper rates", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "mya-native");
    ct.record("s1", { type: "turn_end", tokensIn: 1_000_000, tokensOut: 0 });
    const cost = ct.getSessionCost("s1")!;
    expect(cost.totalUsd).toBeCloseTo(0.15, 2);
  });

  it("forget removes session", () => {
    const ct = new CostTrackerImpl();
    ct.record("s1", { type: "turn_end", tokensIn: 100, tokensOut: 50 });
    ct.forget("s1");
    expect(ct.getSessionCost("s1")).toBeUndefined();
  });

  it("getAggregateCost sums across sessions", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "pi");
    ct.setRuntimeType("s2", "pi");
    ct.record("s1", { type: "turn_end", tokensIn: 1000, tokensOut: 500 });
    ct.record("s2", { type: "turn_end", tokensIn: 2000, tokensOut: 1000 });
    const agg = ct.getAggregateCost();
    expect(agg.sessions).toBe(2);
    expect(agg.totalTurns).toBe(2);
    expect(agg.totalUsd).toBeGreaterThan(0);
  });
});

describe("[unit] CostTrackerImpl — additional coverage", () => {
  it("unknown runtime type falls back to pi rates", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "unknown-runtime");
    ct.record("s1", { type: "turn_end", tokensIn: 1_000_000, tokensOut: 0 });
    const cost = ct.getSessionCost("s1")!;
    // Should use pi rates ($3/M input) since "unknown-runtime" not in COST_RATES
    expect(cost.totalUsd).toBeCloseTo(3, 1);
  });

  it("getFullCost returns detailed record", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "pi");
    ct.record("s1", { type: "turn_end", tokensIn: 500, tokensOut: 200 });
    const full = ct.getFullCost("s1")!;
    expect(full.tokensIn).toBe(500);
    expect(full.tokensOut).toBe(200);
    expect(full.events).toBe(1);
    expect(full.turns).toBe(1);
  });

  it("claude runtime uses claude rates", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "claude");
    ct.record("s1", { type: "turn_end", tokensIn: 1_000_000, tokensOut: 0 });
    expect(ct.getSessionCost("s1")!.totalUsd).toBeCloseTo(3, 1);
  });
});

describe("[unit] CostTrackerImpl — copy independence", () => {
  it("getFullCost returns independent copy", () => {
    const ct = new CostTrackerImpl();
    ct.setRuntimeType("s1", "pi");
    ct.record("s1", { type: "turn_end", tokensIn: 100, tokensOut: 50 });
    const full = ct.getFullCost("s1")!;
    full.totalUsd = 999;
    full.tokensIn = 999;
    expect(ct.getSessionCost("s1")!.totalUsd).not.toBe(999);
    expect(ct.getFullCost("s1")!.tokensIn).toBe(100);
  });
});
