// packages/print/src/runtimes/mya-native.ts

import type {
  AgentEvent, AgentRuntime, AgentCapabilities, CompactionResult,
  ModelInfo, RuntimeSession, SessionState, StartOpts, ThinkingLevel, PromptOpts, RuntimeEvent
} from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";
import { join } from "node:path";

// ─── Event Normalizer (pure function) ─────────────────────────────────────────

interface MyaNormalizerState {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Map a RuntimeEvent to zero or more AgentEvents (array for multi-call batches). */
export function mapMyaEvent(
  event: RuntimeEvent,
  state: MyaNormalizerState,
): AgentEvent[] {
  const e = event as any;
  switch (e.kind) {
    case "turn":
      if (e.stage !== "event") return [];
      const te = e.turnEvent;
      if (!te) return [];
      switch (te.state) {
        case "Streaming": {
          const chunk = te.chunk;
          if (!chunk) return [];
          if (chunk.kind === "text") return [{ type: "text", delta: chunk.text ?? "" }];
          // Defensive: some providers may emit error chunks directly
          if (chunk.kind === "error") {
            const err = chunk.error;
            return [{ type: "error", message: err?.context?.reason ?? err?.context?.cause ?? "stream error", recoverable: err?.recoverable ?? false }];
          }
          return [];
        }
        case "Completed":
          state.tokensIn += te.usage?.input ?? 0;
          state.tokensOut += te.usage?.output ?? 0;
          state.costUsd += te.cost?.usd ?? 0;
          return [];
        case "Failed":
        case "Recoverable": {
          const err = te.error;
          return [{ type: "error", message: err?.context?.reason ?? err?.context?.cause ?? "turn failed", recoverable: te.state === "Recoverable" }];
        }
        case "Cancelled":
          return [{ type: "error", message: te.reason ?? "cancelled", recoverable: false }];
        case "ToolCalls": {
          // MEDIUM fix: emit ALL tool calls in batch, not just first
          if (!te.calls?.length) return [];
          return te.calls.map((call: any) => ({
            type: "tool_call" as const,
            toolCallId: call?.id ?? "",
            name: call?.name ?? "",
            args: call?.args ?? {},
          }));
        }
        case "ToolExec": {
          // MEDIUM fix: emit ALL tool results in batch, not just first
          const results: any[] = Array.isArray(te.result) ? te.result : te.result?.results ?? [];
          return results.map((r: any) => ({
            type: "tool_result" as const,
            toolCallId: r?.callId ?? "",
            output: typeof r?.output === "string" ? r.output : JSON.stringify(r?.output ?? ""),
            error: r ? !r.ok : false,
          }));
        }
        case "AwaitingApproval": {
          // MED-8 fix: surface approval as error event (not tool_call — semantic mismatch)
          const call = te.call;
          return [{ type: "error", message: `Approval required for tool: ${call?.name ?? "unknown"}`, recoverable: true }];
        }
        default:
          return [];
      }
    default:
      return [];
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
  private agentInstance: any = null;
  private busy = false;
  private lastState = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

  constructor(private opts: StartOpts) {}

  private async getAgent(): Promise<any> {
    if (!this.agentInstance) {
      const { createAgent } = await import("@my-agent/agent");
      this.agentInstance = await createAgent({ memoryDir: join(this.opts.agentDir, "memory") } as any);
    }
    return this.agentInstance;
  }

  async prompt(text: string, _opts?: PromptOpts): Promise<void> {
    this.textBuffer = "";
    this.busy = true;
    this.emit({ type: "turn_start", model: this.model, sessionId: this.opts.sessionId });
    try {
      const agent = await this.getAgent();
      const state = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
      await agent.run(text, (event: RuntimeEvent) => {
        const mapped = mapMyaEvent(event, state);
        for (const m of mapped) {
          if (m.type === "text") { this.textBuffer += m.delta; }
          this.emit(m);
        }
      });
      this.lastState = state;
      this.emit({ type: "turn_end", tokensIn: state.tokensIn, tokensOut: state.tokensOut, ...(state.costUsd > 0 ? { costUsd: state.costUsd } : {}) });
    } catch (e) {
      this.emit({ type: "error", message: String(e), recoverable: false });
      this.emit({ type: "turn_end", tokensIn: 0, tokensOut: 0 });
      throw e;
    } finally {
      this.busy = false;
    }
  }

  async setModel(model: any): Promise<void> { this.model = model.id; this.emit({ type: "model_changed", model: model.id }); }
  setThinking(_level: ThinkingLevel): void {}
  async compact(): Promise<CompactionResult> { return { tokensBefore: 0, tokensAfter: 0, strategy: "none" }; }
  getState(): SessionState {
    return { model: this.model, thinking: "off", status: this.busy ? "thinking" : "idle", tokensIn: this.lastState.tokensIn, tokensOut: this.lastState.tokensOut, contextPct: 0, contextWindow: 200_000, costUsd: this.lastState.costUsd, startedAt: this.createdAt, lastActivity: nowWallclock() };
  }
  isIdle(): boolean { return !this.busy; }
  async dispose(): Promise<void> { this.agentInstance?.killAllSubagents?.(); this.agentInstance = null; this.listeners.clear(); this.textBuffer = ""; }
  onEvent(handler: (e: AgentEvent) => void): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  getTextBuffer(): string { return this.textBuffer; }
  private emit(event: AgentEvent): void { this.listeners.forEach(l => l(event)); }
}
