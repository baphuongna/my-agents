/**
 * @my-agent/core — type glossary (SSOT).
 *
 * Transcribed from SPEC §4 "Complete type glossary (round 26)" + R36 additions.
 * These are the canonical types every package references. Defined ONCE here.
 * See source/.learned/spec/01-core-loop.md for the authoritative prose + source links.
 */

// ─── Turn lifecycle (FSM) ───────────────────────────────────────────────────
/** Internal scheduling states (not emitted to observers — R25-7). */
export type TurnState =
  | "Pending"
  | "Streaming"
  | "ToolCalls"
  | "ToolExec"
  | "Compressing"
  | "AwaitingHuman"
  | "Completed"
  | "Failed";

/** Observable turn events on the RuntimeEvent bus. */
export type TurnEvent =
  | { state: "Streaming"; chunk: StreamChunk }
  | { state: "ToolCalls"; calls: ToolCall[] }
  | { state: "AwaitingApproval"; call: ToolCall; prompt: ApprovalRequest }
  | { state: "ToolExec"; result: ToolResult[] | DegradedResult }
  | { state: "Completed"; usage: TokenUsage; cost: Cost }
  | { state: "Recoverable"; error: LifecycleError }
  | { state: "Failed"; error: LifecycleError }
  | { state: "Cancelled"; reason: string };

export interface LifecycleError {
  /** Canonical phase vocabulary (sandbox removed in R30). */
  phase:
    | "stream"
    | "tool"
    | "provider"
    | "auth"
    | "quota"
    | "memory"
    | "subagent"
    | "validation"
    | "resource";
  recoverable: boolean;
  retries: number;
  context: Record<string, string>;
  /** R27-10: raw invalid yield for salvage (validation phase). */
  partial?: unknown;
  cause?: unknown;
}

// ─── Core primitives ────────────────────────────────────────────────────────
export type StreamChunk = StreamEvent;
export interface ToolCall { id: string; name: string; args: unknown }
export interface ToolResult {
  callId: string;
  ok: boolean;
  output: unknown;
  error?: string;
  degraded?: boolean;
}
export type DegradedResult = { results: ToolResult[]; failedCallIds: string[] };

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  /** R36: provider-telemetry split (ponytail pattern) — prompt-cache ROI. */
  cacheCreation?: number;
}
export type Cost = { usd: number };

// ─── Provider (§6) ──────────────────────────────────────────────────────────
export type StreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_calls"; calls: ToolCall[] }
  | { kind: "done"; usage: TokenUsage }
  | { kind: "error"; error: LifecycleError };

export interface ProviderProfile {
  id: string;
  model: string;
  stream(
    prompt: SystemPrompt,
    history: History,
  ): Promise<{ events: StreamEvent[] }>;
  health(): ComponentHealth;
}

// ─── Permission (§7) ────────────────────────────────────────────────────────
export type Mode =
  | "ReadOnly"
  | "WorkspaceWrite"
  | "DangerFullAccess"
  | "Prompt"
  | "Allow";

/** §7 step-5 "active ≥ required" uses this ordering. */
export const MODE_RANK: Record<Mode, number> = {
  ReadOnly: 0,
  Prompt: 1,
  WorkspaceWrite: 2,
  DangerFullAccess: 3,
  Allow: 4,
};

export type PermissionOutcome =
  | { outcome: "Allow" }
  | { outcome: "Deny"; reason: string };

export interface ApprovalRequest {
  call: ToolCall;
  reason: string;
  currentMode: Mode;
  requiredMode: Mode;
}
export type ApprovalDecision =
  | { decision: "Allow" }
  | { decision: "Deny"; reason: string };

export type ApprovalChannel = {
  request(r: ApprovalRequest): Promise<ApprovalDecision>;
};

/** §4 turn-loop context passed to helpers (requiresApproval, runTool, etc.). */
export interface TurnContext {
  session: Session;
  history: History;
  budget: BudgetConfig;
  approval: ApprovalChannel;
  emit: (te: TurnEvent) => void;
  lane?: {
    taskId: LaneId;
    setBlockedOn(b: "approval" | undefined): void;
  };
  cancel?: AbortSignal;
}

// ─── Session / prompt (§5) ──────────────────────────────────────────────────
export interface SystemPrompt {
  stable: string;
  context: string;
  volatile: string;
}

export interface Session {
  profiles: ProviderProfile[];
  stableTier: string;
  ctxFiles: string[];
  memory: MemoryManager;
  userMd: string;
  prompt?: SystemPrompt;
  history: History;
  skillSetDirty: boolean;
}

export interface History {
  append(entry: unknown): void;
  /** Tier-0: read-back for prompt assembly. */
  entries(): readonly unknown[];
}

/** §5 serialization primitive; tier rebuilds are the sole mutators (invariant #15). */
export interface PromptMutex {
  withLock<T>(fn: () => T): T;
}

/** §9 skill curator / §8 memory side tasks; NEVER touches main prompt cache (invariant #8). */
export interface AuxiliaryProvider {
  resolve(): ProviderProfile;
  health(): ComponentHealth;
}

// ─── Memory (§8) ────────────────────────────────────────────────────────────
export type MemoryRoleId =
  | "archivist"
  | "tree"
  | "diff"
  | "goals"
  | "sync"
  | "working";

export interface MemoryQuery {
  text: string;
  role?: MemoryRoleId;
  topK?: number;
}
export interface MemoryHit {
  id: string;
  role: MemoryRoleId;
  content: string;
  score: number;
}
export interface MemoryEntry {
  role: MemoryRoleId;
  content: string;
  metadata?: Record<string, string>;
}
export interface MemorySnapshot {
  entries: MemoryHit[];
  /** Day-precision (R25-15). */
  generatedDay: number;
}

export interface MemoryManager {
  snapshot(): MemorySnapshot;
  query(q: MemoryQuery): Promise<MemoryHit[]>;
}

export type ScanVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; matchedPattern?: string };

export interface KnowledgeGraph {
  entities: { id: string; type: string; name: string }[];
  relations: { from: string; to: string; kind: string }[];
}

export interface ContextSource {
  scheme: string;
  list(q: MemoryQuery): Promise<MemoryHit[]>;
  read(uri: string): Promise<string>;
  grep(pattern: string): Promise<MemoryHit[]>;
}

// ─── Observability (§13) ────────────────────────────────────────────────────
export type ComponentId = string;
export type ComponentHealth = "Healthy" | "Degraded" | "Failed";

/** Discriminated RuntimeEvent bus — UI/observers subscribe to this (never scrape stdout). */
export type RuntimeEvent =
  | { kind: "turn"; stage: "start" | "event" | "end"; turnEvent?: TurnEvent }
  | { kind: "tool"; stage: "request" | "result"; call?: ToolCall; result?: ToolResult }
  | { kind: "approval"; stage: "requested" | "decided"; call: ToolCall }
  | { kind: "health"; component: ComponentId; status: ComponentHealth; detail?: string }
  | { kind: "lane"; taskId: LaneId; freshness: LaneFreshness; heartbeat: LaneHeartbeat }
  | { kind: "budget"; spentUsd: number; remainingUsd: number; exhausted: boolean };

// ─── LaneBoard (§13) ────────────────────────────────────────────────────────
export type LaneId = string;
/** == taskId */
export type LaneStatus =
  | "running"
  | "idle"
  | "done"
  | "failed"
  | "blocked";

export type LaneFreshness =
  | "Healthy"
  | "Stalled"
  | "TransportDead"
  | "Unknown"
  | "AwaitingHuman";

export interface LaneHeartbeat {
  observedAt: number;
  transportAlive: boolean;
  status: LaneStatus;
  blockedOn?: "approval";
}

export interface LaneBoardEntry {
  taskId: string;
  prompt: string;
  status: LaneStatus;
  teamId: string;
  heartbeat: LaneHeartbeat;
  freshness: LaneFreshness;
}

// ─── Tools / subagents (§7/§10) ─────────────────────────────────────────────
/**
 * Minimal structural JSON Schema (Draft-07). Avoids pulling ajv as a type-only
 * dep at Tier 0; concrete validation uses ajv at runtime in the tools package.
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  [ext: string]: unknown;
}

export interface Tool {
  name: string;
  args: JSONSchema;
  requiredMode: Mode;
  allowedToolNames?: string[];
  idempotent?: boolean;
}

export type ToolSet = { allowed: string[]; blocked: string[] };

/** §17 extension host API — deliberately limited (no fs/net/child_process). */
export interface ExtensionAPI {
  registerTool(t: Tool): void;
  on(e: string, h: (...a: unknown[]) => void): void;
}

/** Canonical denylist every subagent inherits (§10). */
export const DELEGATE_BLOCKED_TOOLS = new Set([
  "task",
  "delegate",
  "codeExecBridge",
  "spawn",
  "exec",
  "bash",
]);

export interface SubagentSpawn {
  prompt: string;
  toolSurface: ToolSet;
  approval: ApprovalChannel;
  budget: BudgetConfig;
  topology?: TeamTopology;
}
export type SubagentResult =
  | { ok: true; data: unknown; changedPaths?: string[] }
  | { ok: false; error: ConflictError | string };

export interface SubagentRunner {
  spawn(s: SubagentSpawn): Promise<SubagentResult>;
}

export interface ConflictError {
  path: string;
  baseHash: string;
  childHash: string;
  parentHash: string;
  hunks?: { base: [number, number]; child: [number, number] }[];
}

export type TeamTopology =
  | "pipeline"
  | "fanout_fanin"
  | "expert_pool"
  | "producer_reviewer"
  | "supervisor"
  | "hierarchical";

// ─── Compression / eval (§5/§15) ────────────────────────────────────────────
/** Tier-0 interface stub; concrete impls are Tier-1. */
export interface Compressor {
  compress(history: unknown[]): unknown[];
  ratio(): number;
}
export interface LlmTrace {
  messages: unknown[];
  responses: string[];
}
export interface MockResponse {
  id: string;
  body: unknown;
}
export interface BehaviorStep {
  kind: "tool_call" | "state";
  expect: unknown;
}

// ─── Budget (§21) — tree-accounting ─────────────────────────────────────────
export interface ResourceBudget {
  diskBytes: number;
  heapBytes: number;
}

export interface BudgetConfig {
  total: number;
  warningThreshold: number;
  abortThreshold: number;
  unlimited: boolean;
  parent?: BudgetConfig;
  remaining(): number;
  /** Atomic CAS — REQUIRED; rejects a spend breaching abortThreshold (returns false). */
  spend(c: Cost): boolean;
  /** Atomically reserves min(alloc, remaining); pre-charge. */
  deriveChild(alloc: number): BudgetConfig;
  /** Refund alloc - child.spent on ANY terminal state (incl. crash). */
  releasePrecharge(childId: string): number;
  exhausted(): boolean;
  resource?: ResourceBudget;
}

// ─── Cross-cutting result types (R27) ───────────────────────────────────────
export type Durability = "BestEffort" | "Durable" | "DurableWithWal";
export type WriteResult =
  | { Ok: true }
  | { Durable: true }
  | { Spilled: { pendingCount: number } }
  | { ResourceExhausted: true };
export interface DrainReport {
  completed: number;
  timedOut: number;
  lostWrites: MemoryEntry[];
}
/** Every napi entry returns this; panics never kill the process. */
export type NativeResult<T> = { Ok: T } | { Panic: { backtrace: string } };

// ─── Shell (§20 Tier-0 contract) ────────────────────────────────────────────
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// ─── Tier-0 constants ───────────────────────────────────────────────────────
export const MAX_ATTEMPTS = 3;
export const MAX_APPROVAL_CHAIN_DEPTH = 3;
export const SUBAGENT_SCHEMA_REPAIR_RETRIES = 1;
export const MAX_CONCURRENT_SUBAGENTS = 8;
export const MAX_DEPTH = 4;
export const MAX_TREE_NODES = 64;
export const MAX_SIZE = 128;
export const IDLE_TTL_SECS = 3600;
export const SSE_BUFFER_BYTES = 16 * 1024 * 1024;
export const MAX_GOLDEN_AGE_DAYS = 30;
export const SYNC_DRAIN_TIMEOUT_S = 5;
export const APPROVAL_ESCALATION_TIMEOUT_S = 24 * 3600;
