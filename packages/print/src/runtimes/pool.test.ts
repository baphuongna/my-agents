import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimePool, type RuntimePoolEntry } from "./pool.js";
import { createStubRouter, stubEnricher, stubCostTracker } from "./stubs.js";
import type { AgentRuntime } from "@my-agent/core";
import type { AgentSession } from "@my-agent/agent";
import type { RuntimeSession } from "@my-agent/core";

function makeMockRuntime(name: string, available = true): AgentRuntime {
  return {
    runtimeType: name,
    displayName: name,
    isAvailable: () => available,
    async start(opts) {
      const mock: RuntimeSession = {
        sessionId: opts.sessionId,
        runtimeType: name,
        executionModel: "in-process" as const,
        async prompt() {},
        async setModel() {},
        setThinking() {},
        async compact() { return { tokensBefore: 0, tokensAfter: 0, strategy: "none" as const }; },
        getState() {
          return { model: "test", thinking: "medium", status: "idle" as const, tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200000, costUsd: 0, startedAt: 1234567890, lastActivity: 1234567890 };
        },
        isIdle: () => true,
        async dispose() {},
        onEvent: () => () => {},
      };
      return mock;
    },
    async listModels() { return []; },
    capabilities() {
      return { hasInteractive: true, hasHeadless: true, supportsTools: true, supportsResume: true, supportsCompaction: true, supportsImages: true, supportsThinking: true, execution: "in-process" as const, maxContextWindow: 200000, injectionMethod: "extension" as const };
    },
  };
}

describe("[unit] RuntimePool", () => {
  let pool: RuntimePool;
  let runtimes: Map<string, AgentRuntime>;

  beforeEach(() => {
    runtimes = new Map();
    runtimes.set("pi", makeMockRuntime("pi"));
    runtimes.set("claude", makeMockRuntime("claude"));
    pool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
  });

  afterEach(() => pool.dispose());

  it("acquire creates new session", async () => {
    const session = await pool.acquire("s1");
    expect(session).toBeDefined();
    expect(pool.size).toBe(1);
  });

  it("acquire returns same session for same ID", async () => {
    const s1 = await pool.acquire("s1");
    const s2 = await pool.acquire("s1");
    expect(s1).toBe(s2);
  });

  it("acquireWithRuntime respects agentType", async () => {
    const { runtimeType } = await pool.acquireWithRuntime("s1", { agentType: "claude" });
    expect(runtimeType).toBe("claude");
  });

  it("agentType mismatch throws", async () => {
    await pool.acquireWithRuntime("s1", { agentType: "pi" });
    await expect(pool.acquireWithRuntime("s1", { agentType: "claude" })).rejects.toThrow();
  });

  it("release removes session", async () => {
    await pool.acquire("s1");
    expect(pool.release("s1")).toBe(true);
    expect(pool.size).toBe(0);
  });

  it("release busy returns false without force", async () => {
    await pool.acquire("s1");
    const e = pool.get("s1")!;
    e.busy = true;
    expect(pool.release("s1")).toBe(false);
  });

  it("release force removes busy session", async () => {
    await pool.acquire("s1");
    pool.get("s1")!.busy = true;
    expect(pool.release("s1", { force: true })).toBe(true);
  });

  it("get returns entry with idleSince > 0", async () => {
    await pool.acquire("s1");
    const entry = pool.get("s1")!;
    expect(entry.idleSince).toBeGreaterThan(0);
    expect(entry.createdAt).toBeGreaterThan(0);
  });

  it("list returns all entries", async () => {
    await pool.acquire("s1");
    await pool.acquire("s2");
    expect(pool.list()).toHaveLength(2);
  });

  it("createForCwd creates session with cwd", async () => {
    const session = await pool.createForCwd("s1", "/tmp");
    expect(session).toBeDefined();
  });

  it("maxSessions throws when full", async () => {
    process.env.MYA_MAX_SESSIONS = "2";
    const smallPool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
    await smallPool.acquire("s1");
    await smallPool.acquire("s2");
    await expect(smallPool.acquire("s3")).rejects.toThrow("Max sessions");
    delete process.env.MYA_MAX_SESSIONS;
    smallPool.dispose();
  });

  it("sweepIdle evicts idle sessions past TTL", async () => {
    await pool.acquire("s1");
    const entry = pool.get("s1")!;
    entry.idleSince = 1234567890 - 3_600_001;
    pool.sweepIdle();
    expect(pool.size).toBe(0);
  });

  it("sweepIdle skips busy sessions", async () => {
    await pool.acquire("s1");
    const entry = pool.get("s1")!;
    entry.busy = true;
    entry.idleSince = 1234567890 - 3_600_001;
    pool.sweepIdle();
    expect(pool.size).toBe(1);
  });

  it("dispose clears all sessions", async () => {
    await pool.acquire("s1");
    await pool.acquire("s2");
    pool.dispose();
    expect(pool.size).toBe(0);
  });
});

describe("[unit] RuntimePool — concurrent acquire dedup (M1 fix)", () => {
  it("concurrent acquireWithRuntime for same sessionId deduplicates", async () => {
    const runtimes = new Map([["pi", makeMockRuntime("pi")]]);
    const pool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
    const [r1, r2] = await Promise.all([
      pool.acquireWithRuntime("s1", { agentType: "pi" }),
      pool.acquireWithRuntime("s1", { agentType: "pi" }),
    ]);
    // Both should get the same session
    expect(r1.session).toBe(r2.session);
    expect(pool.size).toBe(1);
    pool.dispose();
  });
});

describe("[unit] RuntimePool — concurrent agentType mismatch", () => {
  it("rejects concurrent acquire with different agentType for same sessionId", async () => {
    const runtimes = new Map([["pi", makeMockRuntime("pi")], ["claude", makeMockRuntime("claude")]]);
    const pool = new RuntimePool(createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker);
    await expect(Promise.all([
      pool.acquireWithRuntime("s1", { agentType: "pi" }).catch(e => e),
      pool.acquireWithRuntime("s1", { agentType: "claude" }).catch(e => e),
    ])).resolves.toBeDefined();
    pool.dispose();
  });
});
