import { describe, it, expect, vi } from "vitest";
import { RuntimeSessionAdapter } from "./adapter.js";
import { stubEnricher, stubCostTracker } from "./stubs.js";
import type { RuntimeSession, AgentEvent, SessionState } from "@my-agent/core";

function makeMockSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  const listeners = new Set<(e: AgentEvent) => void>();
  return {
    sessionId: "test-1",
    runtimeType: "pi",
    executionModel: "in-process" as const,
    async prompt() {},
    async setModel() {},
    setThinking() {},
    async compact() { return { tokensBefore: 0, tokensAfter: 0, strategy: "none" as const }; },
    getState() { return { model: "test", thinking: "medium", status: "idle" as const, tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200000, costUsd: 0, startedAt: 0, lastActivity: 0 }; },
    isIdle: () => true,
    async dispose() {},
    onEvent: (handler: (e: AgentEvent) => void) => { listeners.add(handler); return () => listeners.delete(handler); },
    _emit: (e: AgentEvent) => { for (const l of listeners) l(e); },
    ...overrides,
  } as any;
}

describe("[unit] RuntimeSessionAdapter", () => {
  it("prompt calls enricher.enrich before session.prompt", async () => {
    const session = makeMockSession();
    const enricher = { ...stubEnricher, enrich: vi.fn(async (p: string) => p.toUpperCase()) };
    const adapter = new RuntimeSessionAdapter(session, enricher, stubCostTracker);
    await adapter.prompt("hello");
    expect(enricher.enrich).toHaveBeenCalledWith("hello", expect.objectContaining({ sessionId: "test-1" }));
  });

  it("prompt calls session.prompt with enriched text", async () => {
    const session = makeMockSession({ prompt: vi.fn(async () => {}) });
    const enricher = { ...stubEnricher, enrich: vi.fn(async (p: string) => `[enriched] ${p}`) };
    const adapter = new RuntimeSessionAdapter(session, enricher, stubCostTracker);
    await adapter.prompt("hello");
    expect(session.prompt).toHaveBeenCalledWith("[enriched] hello", undefined);
  });

  it("busy toggles via onBusyChange", async () => {
    const busyStates: boolean[] = [];
    const session = makeMockSession();
    const adapter = new RuntimeSessionAdapter(session, stubEnricher, stubCostTracker, (busy) => busyStates.push(busy));
    await adapter.prompt("test");
    expect(busyStates).toEqual([true, false]);
  });

  it("messageCount increments via onMessage", async () => {
    let count = 0;
    const session = makeMockSession();
    const adapter = new RuntimeSessionAdapter(session, stubEnricher, stubCostTracker, undefined, () => count++);
    await adapter.prompt("test");
    expect(count).toBe(1);
  });

  it("enrich error falls back to raw prompt", async () => {
    const session = makeMockSession({ prompt: vi.fn(async () => {}) });
    const enricher = { ...stubEnricher, enrich: vi.fn(async () => { throw new Error("enrich failed"); }) };
    const adapter = new RuntimeSessionAdapter(session, enricher, stubCostTracker);
    await adapter.prompt("raw text");
    expect(session.prompt).toHaveBeenCalledWith("raw text", undefined);
  });

  it("text events accumulate in textBuffer", async () => {
    const session = makeMockSession({
      prompt: vi.fn(async () => {
        (session as any)._emit({ type: "text", delta: "hello " });
        (session as any)._emit({ type: "text", delta: "world" });
      }),
    });
    const adapter = new RuntimeSessionAdapter(session, stubEnricher, stubCostTracker);
    await adapter.prompt("test");
    expect(adapter.getTextBuffer()).toBe("hello world");
  });

  it("abort calls session.dispose", async () => {
    const session = makeMockSession({ dispose: vi.fn(async () => {}) });
    const adapter = new RuntimeSessionAdapter(session, stubEnricher, stubCostTracker);
    adapter.abort();
    await new Promise(r => setTimeout(r, 10));
    expect(session.dispose).toHaveBeenCalled();
  });

  it("subscribe receives events", () => {
    const session = makeMockSession();
    const adapter = new RuntimeSessionAdapter(session, stubEnricher, stubCostTracker);
    const events: unknown[] = [];
    adapter.subscribe(e => events.push(e));
    (session as any)._emit({ type: "text", delta: "test" });
    expect(events).toHaveLength(1);
  });

  it("turnLock serializes concurrent prompts", async () => {
    const order: string[] = [];
    const session = makeMockSession({
      prompt: vi.fn(async (text: string) => {
        order.push(`start:${text}`);
        await new Promise(r => setTimeout(r, 50));
        order.push(`end:${text}`);
      }),
    });
    const adapter = new RuntimeSessionAdapter(session, stubEnricher, stubCostTracker);
    const p1 = adapter.prompt("first");
    const p2 = adapter.prompt("second");
    await Promise.all([p1, p2]);
    expect(order.indexOf("end:first")).toBeLessThan(order.indexOf("start:second"));
  });

  it("capture called after prompt when textBuffer non-empty", async () => {
    const session = makeMockSession({
      prompt: vi.fn(async () => {
        (session as any)._emit({ type: "text", delta: "response text" });
      }),
    });
    const captureFn = vi.fn(async () => {});
    const enricher = { enrich: stubEnricher.enrich, capture: captureFn };
    const adapter = new RuntimeSessionAdapter(session, enricher as any, stubCostTracker);
    await adapter.prompt("test");
    expect(captureFn).toHaveBeenCalledWith("response text", expect.objectContaining({ sessionId: "test-1" }));
  });
});
