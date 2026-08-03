import { describe, it, expect, vi, beforeEach } from "vitest";
import { PiInProcessSession } from "./pi-in-process.js";
import type { StartOpts, AgentEvent } from "@my-agent/core";

function makeOpts(overrides: Partial<StartOpts> = {}): StartOpts {
  return { cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "test-1", env: {}, ...overrides };
}

function makeMockPiSession(overrides: Record<string, any> = {}) {
  const listeners = new Set<(e: unknown) => void>();
  return {
    model: { id: "claude-sonnet-4" },
    thinkingLevel: "medium",
    isIdle: true,
    subscribe: vi.fn((fn: (e: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }),
    prompt: vi.fn(async () => {
      // Simulate agent_settled after prompt
      for (const l of listeners) l({ type: "agent_settled" });
    }),
    setModel: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(() => {}),
    compact: vi.fn(async () => ({ tokensBefore: 1000, estimatedTokensAfter: 500 })),
    getContextUsage: vi.fn(() => ({ percent: 42, contextWindow: 200000 })),
    dispose: vi.fn(() => {}),
    _emit: (event: unknown) => { for (const l of listeners) l(event); },
    ...overrides,
  };
}

describe("[smoke] PiInProcessSession", () => {
  it("sessionId and runtimeType getters", () => {
    const session = new PiInProcessSession(makeMockPiSession() as any, makeOpts());
    expect(session.sessionId).toBe("test-1");
    expect(session.runtimeType).toBe("pi");
    expect(session.executionModel).toBe("in-process");
  });

  it("prompt emits turn_start then turn_end", async () => {
    const mock = makeMockPiSession();
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await session.prompt("hello");

    expect(events.some(e => e.type === "turn_start")).toBe(true);
    expect(events.some(e => e.type === "turn_end")).toBe(true);
    const startIdx = events.findIndex(e => e.type === "turn_start");
    const endIdx = events.findIndex(e => e.type === "turn_end");
    expect(startIdx).toBeLessThan(endIdx);
  });

  it("turn_start has correct model and sessionId", async () => {
    const mock = makeMockPiSession();
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await session.prompt("test");
    const start = events.find(e => e.type === "turn_start") as any;
    expect(start.model).toBe("claude-sonnet-4");
    expect(start.sessionId).toBe("test-1");
  });

  it("agent_settled without turnActive emits synthetic turn_start (BC fix)", () => {
    const mock = makeMockPiSession();
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    // Simulate broker injection (agent_settled without prompt)
    mock._emit({ type: "agent_settled" });

    const start = events.find(e => e.type === "turn_start");
    expect(start).toBeDefined();
  });

  it("safety net: turn_end emitted when agent_settled doesn't fire", async () => {
    const mock = makeMockPiSession({ prompt: vi.fn(async () => { /* no agent_settled */ }) });
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await session.prompt("test");
    expect(events.some(e => e.type === "turn_end")).toBe(true);
  });

  it("prompt failure emits error + turn_end (R8-4 catch guard)", async () => {
    const mock = makeMockPiSession({ prompt: vi.fn(async () => { throw new Error("LLM failed"); }) });
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await expect(session.prompt("test")).rejects.toThrow("LLM failed");
    expect(events.some(e => e.type === "error")).toBe(true);
    expect(events.some(e => e.type === "turn_end")).toBe(true);
  });

  it("M1: late agent_settled after error does NOT duplicate turn_end", async () => {
    const mock = makeMockPiSession({
      prompt: vi.fn(async () => { throw new Error("LLM failed"); }),
    });
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await expect(session.prompt("test")).rejects.toThrow("LLM failed");
    // Late agent_settled arrives AFTER the catch already closed the turn
    mock._emit({ type: "agent_settled" });

    const turnEnds = events.filter(e => e.type === "turn_end");
    expect(turnEnds).toHaveLength(1);
  });

  it("M2: message_end after agent_settled does not accumulate stale usage", async () => {
    const mock = makeMockPiSession({
      prompt: vi.fn(async () => {
        // Unusual order: agent_settled BEFORE message_end
        mock._emit({ type: "agent_settled" });
        mock._emit({
          type: "message_end",
          message: { role: "assistant", usage: { input: 50, output: 25, cost: { total: 0.01 } } },
        });
      }),
    });
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await session.prompt("test");
    const turnEnd = events.find(e => e.type === "turn_end") as any;
    expect(turnEnd).toBeDefined();
    // Usage from late message_end must NOT leak into the closed turn
    expect(turnEnd.tokensIn).toBe(0);
    expect(turnEnd.tokensOut).toBe(0);
    expect(turnEnd.costUsd).toBeUndefined();
  });

  it("setModel emits model_changed", async () => {
    const mock = makeMockPiSession();
    const session = new PiInProcessSession(mock as any, makeOpts());
    const events: AgentEvent[] = [];
    session.onEvent(e => events.push(e));

    await session.setModel({ id: "gpt-4o" } as any);
    expect(events.some(e => e.type === "model_changed")).toBe(true);
  });

  it("compact returns CompactionResult with ?? 0", async () => {
    const mock = makeMockPiSession({ compact: vi.fn(async () => ({ tokensBefore: undefined, estimatedTokensAfter: undefined })) });
    const session = new PiInProcessSession(mock as any, makeOpts());
    const result = await session.compact();
    expect(result.tokensBefore).toBe(0);
    expect(result.tokensAfter).toBe(0);
    expect(result.strategy).toBe("native");
  });

  it("getState returns correct state", () => {
    const mock = makeMockPiSession();
    const session = new PiInProcessSession(mock as any, makeOpts());
    const state = session.getState();
    expect(state.model).toBe("claude-sonnet-4");
    expect(state.status).toBe("idle");
    expect(state.contextPct).toBe(42);
  });

  it("text events accumulate in textBuffer", async () => {
    const mock = makeMockPiSession({
      prompt: vi.fn(async () => {
        mock._emit({ type: "message_update", assistantMessageEvent: { delta: "hello ", type: "text" } });
        mock._emit({ type: "message_update", assistantMessageEvent: { delta: "world", type: "text" } });
        mock._emit({ type: "agent_settled" });
      }),
    });
    const session = new PiInProcessSession(mock as any, makeOpts());
    await session.prompt("test");
    expect(session.getTextBuffer()).toBe("hello world");
  });

  it("dispose calls piSession.dispose", async () => {
    const mock = makeMockPiSession();
    const session = new PiInProcessSession(mock as any, makeOpts());
    await session.dispose();
    expect(mock.dispose).toHaveBeenCalled();
  });
});
