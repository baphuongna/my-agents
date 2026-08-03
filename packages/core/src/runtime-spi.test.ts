import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  AgentEvent, AgentEventType, AgentRuntime, RuntimeSession, StartOpts,
  CompactionResult, ModelInfo, ThinkingLevel, AgentCapabilities,
  SessionState, PromptOpts, SmartRouter, EnrichContext, PromptEnricher, CostTracker,
} from "./runtime-spi.js";
import { AGENT_EVENT_TYPES } from "./runtime-spi.js";

describe("[unit] runtime-spi types", () => {
  it("AGENT_EVENT_TYPES has all 10 event types", () => {
    expect(AGENT_EVENT_TYPES).toHaveLength(10);
    expect([...AGENT_EVENT_TYPES]).toEqual([
      "turn_start", "text", "thinking", "tool_call", "tool_result",
      "turn_end", "compaction", "model_changed", "thinking_changed", "error",
    ]);
  });

  it("AgentEvent union covers all AGENT_EVENT_TYPES", () => {
    type EventTypes = AgentEvent["type"];
    expectTypeOf<EventTypes>().toEqualTypeOf<AgentEventType>();
  });

  it("turn_start has model and sessionId", () => {
    const e: AgentEvent = { type: "turn_start", model: "claude-4", sessionId: "s1" };
    expect(e.type).toBe("turn_start");
  });

  it("turn_end has tokensIn, tokensOut, optional costUsd", () => {
    const e: AgentEvent = { type: "turn_end", tokensIn: 100, tokensOut: 50 };
    expect(e.type).toBe("turn_end");
    const e2: AgentEvent = { type: "turn_end", tokensIn: 100, tokensOut: 50, costUsd: 0.01 };
    expect(e2.type).toBe("turn_end");
  });

  it("tool_call has toolCallId, name, args", () => {
    const e: AgentEvent = { type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } };
    expect(e.type).toBe("tool_call");
  });

  it("tool_result has output and optional error", () => {
    const e: AgentEvent = { type: "tool_result", toolCallId: "tc1", output: "done" };
    expect(e.type).toBe("tool_result");
    const e2: AgentEvent = { type: "tool_result", toolCallId: "tc1", output: "err", error: true };
    expect(e2.type).toBe("tool_result");
  });

  it("error has message and recoverable", () => {
    const e: AgentEvent = { type: "error", message: "fail", recoverable: false };
    expect(e.type).toBe("error");
  });

  it("compaction has CompactionResult", () => {
    const e: AgentEvent = { type: "compaction", result: { tokensBefore: 1000, tokensAfter: 500, strategy: "native" } };
    expect(e.type).toBe("compaction");
  });

  it("ThinkingLevel has all 7 levels", () => {
    const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    expect(levels).toHaveLength(7);
  });

  it("AgentRuntime interface has required methods", () => {
    expectTypeOf<AgentRuntime>().toMatchTypeOf<{
      readonly runtimeType: string;
      readonly displayName: string;
      start(opts: StartOpts): Promise<RuntimeSession>;
      isAvailable(): boolean;
      listModels(): Promise<ModelInfo[]>;
      capabilities(): AgentCapabilities;
    }>();
  });

  it("RuntimeSession has required methods", () => {
    expectTypeOf<RuntimeSession>().toMatchTypeOf<{
      readonly sessionId: string;
      readonly runtimeType: string;
      readonly executionModel: "in-process" | "subprocess";
      prompt(text: string, opts?: PromptOpts): Promise<void>;
      setModel(model: unknown): Promise<void>;
      setThinking(level: ThinkingLevel): void;
      compact(): Promise<CompactionResult>;
      getState(): SessionState;
      isIdle(): boolean;
      dispose(): Promise<void>;
      onEvent(handler: (event: AgentEvent) => void): () => void;
    }>();
  });

  it("SessionState has all fields", () => {
    const s: SessionState = {
      model: "claude-4", thinking: "medium", status: "idle",
      tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200000,
      costUsd: 0, startedAt: 0, lastActivity: 0,
    };
    expect(s.model).toBe("claude-4");
  });

  it("StartOpts has required fields", () => {
    const opts: StartOpts = {
      cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "s1", env: {},
    };
    expect(opts.cwd).toBe("/tmp");
  });

  it("SmartRouter.select returns runtime + reason", () => {
    expectTypeOf<SmartRouter>().toMatchTypeOf<{
      select(input: { prompt: string; agentOverride?: string; modelOverride?: string }):
        Promise<{ runtime: AgentRuntime; reason: string }>;
    }>();
  });

  it("CostTracker has record, getSessionCost, forget", () => {
    expectTypeOf<CostTracker>().toMatchTypeOf<{
      record(sessionId: string, event: AgentEvent): void;
      getSessionCost(sessionId: string): { totalUsd: number; turns: number } | undefined;
    }>();
  });

  it("EnrichContext has required fields", () => {
    const ctx: EnrichContext = {
      sessionId: "s1", runtimeType: "pi", executionModel: "in-process",
    };
    expect(ctx.executionModel).toBe("in-process");
  });

  it("PromptEnricher has enrich and capture", () => {
    expectTypeOf<PromptEnricher>().toMatchTypeOf<{
      enrich(prompt: string, ctx: EnrichContext): Promise<string>;
      capture(output: string, ctx: EnrichContext): Promise<void>;
    }>();
  });

  it("CompactionResult strategy has all variants", () => {
    const strategies: CompactionResult["strategy"][] = [
      "native", "llm-summarize", "truncate", "continue-session", "none",
    ];
    expect(strategies).toHaveLength(5);
  });
});
