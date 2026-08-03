// packages/core/src/runtime-spi.ts

/**
 * AgentRuntime SPI — the uniform interface for all agent runtimes.
 *
 * Every runtime (pi, claude, mya-native, future) implements AgentRuntime.
 * Every consumer (RuntimePool, adapter, gateway) consumes these types.
 *
 * This file is TYPES ONLY — no runtime code, no imports with side effects.
 * Placed in @my-agent/core so all packages get the SPI with zero extra deps.
 *
 * Spec reference: option-d-spec-v8.md §1.1, §1.2, §1.3, §5.1
 */

import type { Model, Api } from "@earendil-works/pi-ai";

// ─── §1.1 Types ──────────────────────────────────────────────────────────────

export interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  strategy: "native" | "llm-summarize" | "truncate" | "continue-session" | "none";
}

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentCapabilities {
  hasInteractive: boolean;
  hasHeadless: boolean;
  supportsTools: boolean;
  supportsResume: boolean;
  supportsCompaction: boolean;
  supportsImages: boolean;
  supportsThinking: boolean;
  execution: "in-process" | "subprocess";
  maxContextWindow: number;
  injectionMethod: "extension" | "rpc" | "stdin-prompt" | "in-process-call";
}

export interface AgentRuntime {
  readonly runtimeType: string;
  readonly displayName: string;
  start(opts: StartOpts): Promise<RuntimeSession>;
  isAvailable(): boolean;
  listModels(): Promise<ModelInfo[]>;
  capabilities(): AgentCapabilities;
  login?(provider: string): Promise<void>;
  costPerMTokens?(): { input: number; output: number };
}

export interface StartOpts {
  cwd: string;
  agentDir: string;
  sessionId: string;
  model?: Model<Api>;
  modelId?: string;
  thinking?: ThinkingLevel;
  systemPromptOverride?: string;
  toolsAllowList?: string[];
  env: Record<string, string>;
  resumeFrom?: string;
}

// ─── §1.2 Session Interface ──────────────────────────────────────────────────

export interface RuntimeSession {
  readonly sessionId: string;
  readonly runtimeType: string;
  readonly executionModel: "in-process" | "subprocess";
  prompt(text: string, opts?: PromptOpts): Promise<void>;
  setModel(model: Model<Api>): Promise<void>;
  setThinking(level: ThinkingLevel): void;
  compact(): Promise<CompactionResult>;
  getState(): SessionState;
  isIdle(): boolean;
  dispose(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): () => void;
}

export interface PromptOpts {
  signal?: AbortSignal;
  images?: Array<{ data: string; mimeType: string }>;
  streamingBehavior?: "steer" | "followUp";
}

export interface SessionState {
  model: string;
  thinking: string;
  status: "idle" | "thinking" | "tool:<name>";
  tokensIn: number;
  tokensOut: number;
  contextPct: number;
  contextWindow: number;
  costUsd: number;
  startedAt: number;
  lastActivity: number;
}

// ─── §1.3 Uniform Event Type ─────────────────────────────────────────────────

export type AgentEvent =
  | { type: "turn_start"; model: string; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; output: string; error?: boolean }
  | { type: "turn_end"; tokensIn: number; tokensOut: number; costUsd?: number }
  | { type: "compaction"; result: CompactionResult }
  | { type: "model_changed"; model: string }
  | { type: "thinking_changed"; level: string }
  | { type: "error"; message: string; recoverable: boolean };

export const AGENT_EVENT_TYPES = [
  "turn_start",
  "text",
  "thinking",
  "tool_call",
  "tool_result",
  "turn_end",
  "compaction",
  "model_changed",
  "thinking_changed",
  "error",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

// ─── §5.1 Component Interfaces ───────────────────────────────────────────────

export interface SmartRouter {
  select(input: {
    prompt: string;
    agentOverride?: string;
    modelOverride?: string;
  }): Promise<{ runtime: AgentRuntime; reason: string }>;
}

export interface EnrichContext {
  sessionId: string;
  runtimeType: string;
  executionModel: "in-process" | "subprocess";
  role?: string;
  contextWindow?: number;
}

export interface PromptEnricher {
  enrich(prompt: string, ctx: EnrichContext): Promise<string>;
  capture(output: string, ctx: EnrichContext): Promise<void>;
}

export interface CostTracker {
  record(sessionId: string, event: AgentEvent): void;
  getSessionCost(sessionId: string): { totalUsd: number; turns: number } | undefined;
  forget?(sessionId: string): void;
  setRuntimeType?(sessionId: string, type: string): void;
}
