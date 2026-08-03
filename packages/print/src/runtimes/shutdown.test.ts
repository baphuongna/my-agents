import { describe, it, expect, vi } from "vitest";
import { gracefulShutdown } from "./shutdown.js";
import { RuntimePool } from "./pool.js";
import { CostTrackerImpl } from "./cost-tracker.js";
import { createStubRouter, stubEnricher, stubCostTracker } from "./stubs.js";
import type { AgentRuntime, RuntimeSession } from "@my-agent/core";
import type { AgentSession } from "@my-agent/agent";

function makeMockRuntime(): AgentRuntime {
  return {
    runtimeType: "pi", displayName: "test",
    isAvailable: () => true,
    async start(opts) {
      return {
        sessionId: opts.sessionId, runtimeType: "pi", executionModel: "in-process" as const,
        async prompt() {}, async setModel() {}, setThinking() {},
        async compact() { return { tokensBefore: 0, tokensAfter: 0, strategy: "none" as const }; },
        getState() { return { model: "test", thinking: "off", status: "idle" as const, tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200000, costUsd: 0, startedAt: 0, lastActivity: 0 }; },
        isIdle: () => true, async dispose() {}, onEvent: () => () => {},
      } as RuntimeSession;
    },
    async listModels() { return []; },
    capabilities() { return {} as any; },
  };
}

describe("[unit] gracefulShutdown", () => {
  it("evicts idle sessions immediately", async () => {
    const runtimes = new Map([["pi", makeMockRuntime()]]);
    const pool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
    const ct = new CostTrackerImpl();
    await pool.acquire("s1");
    await pool.acquire("s2");
    expect(pool.size).toBe(2);

    const result = await gracefulShutdown(pool, ct, { drainTimeoutMs: 1000 });
    expect(result.evicted).toBe(2);
    expect(pool.size).toBe(0);
  });

  it("returns zeros for empty pool", async () => {
    const runtimes = new Map([["pi", makeMockRuntime()]]);
    const pool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
    const ct = new CostTrackerImpl();
    const result = await gracefulShutdown(pool, ct);
    expect(result.drained).toBe(0);
    expect(result.forced).toBe(0);
    expect(result.evicted).toBe(0);
  });

  it("disposes pool after shutdown", async () => {
    const runtimes = new Map([["pi", makeMockRuntime()]]);
    const pool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
    const ct = new CostTrackerImpl();
    await pool.acquire("s1");
    await gracefulShutdown(pool, ct);
    expect(pool.size).toBe(0);
  });
});
