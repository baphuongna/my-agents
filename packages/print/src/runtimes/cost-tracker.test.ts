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
