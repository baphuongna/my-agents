// packages/print/src/runtimes/mya-native.ts

import type {
  AgentEvent, AgentRuntime, AgentCapabilities, CompactionResult,
  ModelInfo, RuntimeSession, SessionState, StartOpts, ThinkingLevel, PromptOpts,
} from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";
import type { RuntimeEvent } from "@my-agent/core";

// ─── Event Normalizer (pure function) ─────────────────────────────────────────

interface MyaNormalizerState {
  tokensIn: number;
  tokensOut: number;
}

export function mapMyaEvent(
  event: RuntimeEvent,
  state: MyaNormalizerState,
): AgentEvent | null {
  const e = event as any;
  switch (e.kind) {
    case "turn":
      if (e.state === "started") return null; // turn_start emitted by prompt()
      if (e.state === "completed" || e.state === "failed") {
        return { type: "turn_end", tokensIn: state.tokensIn, tokensOut: state.tokensOut };
      }
      return null;
    case "tool":
      if (e.state === "started") return { type: "tool_call", toolCallId: e.id ?? "", name: e.name ?? "", args: e.args ?? {} };
      if (e.state === "completed") return { type: "tool_result", toolCallId: e.id ?? "", output: typeof e.result === "string" ? e.result : JSON.stringify(e.result ?? ""), error: e.error ?? false };
      return null;
    case "streaming":
      if (!e.chunk) return null;
      if (e.chunk.kind === "text") return { type: "text", delta: e.chunk.text ?? "" };
      if (e.chunk.kind === "thinking") return { type: "thinking", delta: e.chunk.text ?? "" };
      if (e.chunk.kind === "error") return { type: "error", message: e.chunk.error?.context?.reason ?? "stream error", recoverable: e.chunk.error?.recoverable ?? false };
      return null;
    default:
      return null;
  }
}

// ─── Runtime + Session ─────────────────────────────────────────────────────────

export class MyaNativeRuntime implements AgentRuntime {
  readonly runtimeType = "mya-native";
  readonly displayName = "mya native agent";

  isAvailable(): boolean { return true; }

  async start(opts: StartOpts): Promise<RuntimeSession> {
    return new MyaNativeSession(opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "mya-default", provider: "mya", contextWindow: 200_000, maxTokens: 8192, reasoning: false }];
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: false, hasHeadless: true,
      supportsTools: true, supportsResume: false,
      supportsCompaction: false, supportsImages: false,
      supportsThinking: false,
      execution: "in-process", maxContextWindow: 200_000,
      injectionMethod: "in-process-call",
    };
  }

  costPerMTokens() { return { input: 0.15, output: 0.6 }; }
}

export class MyaNativeSession implements RuntimeSession {
  readonly executionModel = "in-process" as const;
  get sessionId(): string { return this.opts.sessionId; }
  get runtimeType(): string { return "mya-native"; }

  private listeners = new Set<(e: AgentEvent) => void>();
  private textBuffer = "";
  private readonly createdAt = nowWallclock();
  private model = "mya-default";

  constructor(private opts: StartOpts) {}

  async prompt(text: string, _opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    this.emit({ type: "turn_start", model: this.model, sessionId: this.opts.sessionId });
    try {
      const { createAgent } = await import("@my-agent/agent");
      const agent = await createAgent({} as any);
      const state = { tokensIn: 0, tokensOut: 0 };
      await agent.run(text, (event: RuntimeEvent) => {
        const mapped = mapMyaEvent(event, state);
        if (mapped) {
          if (mapped.type === "text") { this.textBuffer += mapped.delta; }
          this.emit(mapped);
        }
      });
      this.emit({ type: "turn_end", tokensIn: state.tokensIn, tokensOut: state.tokensOut });
    } catch (e) {
      this.emit({ type: "error", message: String(e), recoverable: false });
      this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
      throw e;
    }
  }

  async setModel(model: any): Promise<void> { this.model = model.id; this.emit({ type: "model_changed", model: model.id }); }
  setThinking(_level: ThinkingLevel): void {}
  async compact(): Promise<CompactionResult> { return { tokensBefore: 0, tokensAfter: 0, strategy: "none" }; }
  getState(): SessionState {
    return { model: this.model, thinking: "off", status: "idle", tokensIn: 0, tokensOut: 0, contextPct: 0, contextWindow: 200_000, costUsd: 0, startedAt: this.createdAt, lastActivity: nowWallclock() };
  }
  isIdle(): boolean { return true; }
  async dispose(): Promise<void> {}
  onEvent(handler: (e: AgentEvent) => void): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  getTextBuffer(): string { return this.textBuffer; }
  private emit(event: AgentEvent): void { this.listeners.forEach(l => l(event)); }
}
