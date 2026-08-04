/**
 * @my-agent/gateway — shared types (wire envelope, readiness probes, pool/role
 * metadata, GatewayOptions).
 *
 * Extracted from src/index.ts so the standalone pieces around the Gateway class
 * live in logical modules. The Gateway class itself stays in index.ts.
 */
import type { ControlPlane, ControlCronJob } from "./control.js";
import type { HookRegistry } from "./hooks.js";
import type { CronScheduler, LifecycleGuard } from "@my-agent/cron";
import type { SyncServer } from "@my-agent/sync";
import type { CollabRelay } from "@my-agent/collab";
import type { ChannelSessionRouter } from "./channel-session.js";
import type { ChannelRegistry } from "./channels.js";
import type { ChannelsPackageConfig, ChannelTransportFactories } from "./channel-bridge.js";
import type { DevicePairing, WebAuthnService } from "@my-agent/secrets";
import type { ApprovalRelay } from "./approval-relay.js";
import type { VoiceCallChannel } from "./voice-call.js";
export type { WireEnvelope } from "./wire-envelope.js";
export type { ReadinessState, ProbeResult } from "./readiness.js";
import type { ReadinessRegistry } from "./readiness.js";

/** Per-session role-subagent metadata, tracked by the host (e.g. main.ts) in an
 * in-memory Map and surfaced through poolSubagents + GET /pool/tree. This is
 * the "SessionMeta" shape shared between the gateway surface and the host.
 *
 * `parentSessionId` links a role-subagent to its spawning session so /pool/tree
 * nests it: `main ▸ role-subagent`. */
export interface SessionMeta {
  /** Role name (e.g. "coder") for a role-subagent spawn. */
  role?: string;
  /** The task prompt the spawned mya should auto-run. */
  task?: string;
  /** Preferred model for the role-subagent. */
  model?: string;
  /** Parent session id — when set, the new session is registered as a child. */
  parentSessionId?: string;
  /** Phase 2: task-status reported by the spawned mya
   * ('working'|'done'|'failed'|'idle'|'acquired'). */
  status?: string;
  /** Phase 3: structured result summary (parsed from <DONE> output). */
  summary?: string;
  /** Phase 3: structured result key outputs (parsed from <DONE> output). */
  keyOutputs?: string[];
}

/** Input to poolAcquire: cwd plus optional role-subagent metadata + parent link.
 * A bare string is also accepted for backward compatibility (treated as cwd). */
export interface PoolAcquireInput extends SessionMeta {
  cwd: string;
}

/** A single subagent entry returned by poolSubagents and nested in /pool/tree. */
export interface PoolSubagentEntry {
  id: string;
  goal: string;
  status: string;
  depth: number;
  output?: string;
  /** Role-subagent metadata (present when this is a role-subagent). */
  role?: string;
  task?: string;
  model?: string;
  parentSessionId?: string;
  /** Phase 3: structured result summary. */
  summary?: string;
  /** Phase 3: structured result key outputs. */
  keyOutputs?: string[];
}

/** A node in the GET /pool/tree response. */
export interface PoolTreeNode {
  sessionId: string;
  busy: boolean;
  messages: number;
  lastActivity: number;
  /** Role-subagent metadata (present when this session is a role-subagent). */
  role?: string;
  task?: string;
  model?: string;
  parentSessionId?: string;
  /** Phase 2: explicit task-status (richer than busy). Mirrors SessionMeta.status. */
  status?: string;
  /** Phase 3: structured result summary. */
  summary?: string;
  /** Phase 3: structured result key outputs. */
  keyOutputs?: string[];
  subagents: PoolSubagentEntry[];
}

export interface GatewayOptions {
  host?: string;
  port?: number;
  readiness?: ReadinessRegistry;
  /** HTML served at `/` (the dashboard SPA). The host wires @my-agent/web's
   * dashboardHtml() here — gateway stays UI-independent (layering). */
  rootHtml?: string;
  /** Optional: directory to serve static files from (e.g., dist/web/).
   * Files are served with appropriate MIME types. Falls back to rootHtml
   * for `/` if no index.html exists in staticDir. */
  staticDir?: string;
  /** M8 fix: allow binding to a non-loopback host. The default loopback bind is
   * safe; setting this to true is required (with a logged warning) for any
   * network-facing bind, since the gateway's WS/HTTP surface is unauthenticated. */
  allowExternalBind?: boolean;
  /** Optional: handle incoming WS messages (e.g. a dashboard sending a prompt). */
  onWsMessage?: (session: string, data: unknown) => void;
  /** Called when thinking level changes via POST /thinking. */
  onThinkingChange?: (level: string | undefined) => void;
  /** Phase 15 M2: optional local-only WS auth token (blocks other local processes). */
  wsToken?: string;
  /** §12 control-plane (sessions/cron/config/tools + handle LRU). Defaults to a
   * fresh ControlPlane. */
  control?: ControlPlane;
  /** §12 extension-lifecycle hook registry (session_start, pre_tool, ...).
   * Default: a fresh HookRegistry. The Agent wiring (Phase 2) should pass the
   * SAME instance here so hooks registered on the gateway also fire when the
   * agent calls tool hooks. */
  hooks?: HookRegistry;
  /** §12.3 cron scheduler. If provided, start() spins up a sweep interval that
   * claims due jobs and forwards them to onWsMessage (one-way fire-and-forget
   * until a richer Protocol lands Tier-2). */
  cron?: CronScheduler;
  /** Optional sweep interval in ms. Defaults to 30_000. */
  cronIntervalMs?: number;
  /** Phase 0B: reconcile the scheduler from cron.json at the top of each sweep
   * (picks up external/CLI file edits). Called once at start() too so jobs load
   * before the first sweep tick. */
  cronReload?: () => void;
  /** Phase 1A: run a cron-fired prompt on a pooled session and return its text.
   * The sweep awaits this before recording the run's outcome (D2 fix).
   * Fix 1: signal (AbortSignal) — timeout abort → piSession.abort(). */
  onRunOnSession?: (sessionId: string, prompt: string, onEvent?: (e: unknown) => void, signal?: AbortSignal) => Promise<string>;
  /** Fix 1: timeout (ms) per cron-fired session. Quá hạn → abort session turn.
   * Mặc định 5 phút. 0 = disable (không tạo timer).
   * R1-H1: undefined KHÔNG disable — default 5 phút qua constructor. */
  cronSessionTimeoutMs?: number;
  /** Phase 3A stopgap: max due jobs fired per sweep (bounds concurrent full-cred
   * turns / cost amplification until the full scheduler.max_concurrent lands). */
  cronMaxConcurrent?: number;
  /** Phase 2C: persist the scheduler state (advanced nextRunAt) to cron.json.
   * Called before firing (at-most-once across crashes) + after complete (re-anchor). */
  cronPersist?: () => void;
  /** Phase 4A: mirror a run to durable history (SQLite) on claim. */
  cronRunStart?: (rec: { runId: string; jobId: string; startedAt: number; status: string; claimedBy?: string }) => void;
  /** Phase 4A: update durable history on completion. */
  cronRunEnd?: (runId: string, status: string, error: string | null, endedAt: number, output?: string) => void;
  /** Phase 4A: read a job's durable run history for GET /cron/jobs/:id/runs. */
  cronRuns?: (jobId: string) => unknown[];
  /** Phase 4C: heartbeat (alive each sweep; success on a clean sweep). */
  cronHeartbeat?: (success: boolean) => void;
  /** Phase 3C/G8: runtime-flip the cron approval mode (deny/approve). */
  cronSetApprovalMode?: (mode: "deny" | "approve") => void;
  /** Phase 5: run a shell/script cron job (no LLM). */
  onRunShell?: (job: { command?: string; script?: string; workdir?: string }) => Promise<{ ok: boolean; output: string; error?: string }>;
  /** Phase 5: the current global default provider/model (for snapshot drift check). */
  cronCurrentDefault?: () => { provider?: string; model?: string };
  /** Phase 5: fetch a prior job's latest output (context_from chaining). */
  cronJobOutput?: (jobId: string) => string | undefined;
  /** Phase 5: load + assemble per-job skill bodies (returns the assembled skill text). */
  cronLoadSkills?: (names: string[]) => string;
  /** §12 sync server (CRDT + HLC). Endpoints active: /sync/pull, /sync/push. */
  sync?: SyncServer;
  /** §12 collaboration relay (rooms). Endpoint active: /collab/rooms. */
  collab?: CollabRelay;
  /** Channel session router (inbound messages → sessions). */
  channelRouter?: ChannelSessionRouter;
  /** Channel registry (messaging adapters). */
  channels?: ChannelRegistry;
  /** Item 17: @my-agent/channels config — when provided, WhatsApp/Matrix adapters
   * from the channels package are instantiated (via transport injection) and
   * registered into the local ChannelRegistry as bridges. */
  channelsConfig?: ChannelsPackageConfig;
  /** Item 17: injectable transport factories for @my-agent/channels adapters.
   * When absent, placeholder transports are used (adapter appears in /status
   * but cannot connect). */
  channelTransports?: ChannelTransportFactories;
  /** Optional: returns AgentPool status for GET /pool/sessions. */
  poolStatus?: () => unknown;
  /** Optional: kill a pool session for POST /pool/kill/:id. */
  poolKill?: (sessionId: string) => boolean;
  /** Optional: acquire a new pool session for POST /pool/acquire. Accepts the
   * extended input (cwd + role/task/model/parentSessionId) for role-subagent
   * spawns, or a bare cwd string for backward compatibility. */
  poolAcquire?: (input: PoolAcquireInput | string) => string | Promise<string>;
  /** Optional: send a prompt to a pool session for POST /pool/prompt/:id. */
  poolPrompt?: (sessionId: string, text: string) => void;
  /** Optional: list subagents for a session (returns PoolSubagentEntry[]). */
  poolSubagents?: (sessionId: string) => PoolSubagentEntry[];
  /** Phase 2: set task-status for POST /pool/session/:id/status. */
  poolSessionStatus?: (sessionId: string, status: string, summary?: string, keyOutputs?: string[]) => void;
  /** Optional: MCP server management callbacks. */
  mcpList?: () => Array<{ id: string; command: string; args: string[]; phase: string; health: string; tools: string[]; lastError?: string }>;
  mcpAdd?: (cfg: { id: string; command: string; args?: string[]; env?: Record<string, string> }) => void;
  mcpRemove?: (id: string) => boolean;
  mcpConnect?: (id: string) => Promise<void>;
  mcpDiscover?: (id: string) => Promise<string[]>;
  /** Skills list. */
  skillsList?: () => Array<{ name: string; description: string; triggers: string[] }>;
  /** Skills create (H7: POST /skills/create). */
  skillCreate?: (skill: { name: string; description: string; body: string }) => { ok: boolean; error?: string };
  /** Roles list (from ~/.mya/roles/*.json). */
  rolesList?: () => Array<{ name: string; description: string; promptAppend?: string; toolsAllowed?: string[]; toolsDenied?: string[]; modelPrefer?: string; memoryScope?: string }>;
  /** Memory/brain stats. */
  memoryStats?: () => { facts: number; workingMemory?: number; episodic?: number; takes: number; tombstones: number; dreamRunning: boolean; lastDream?: string };
  /** Trigger a dream cycle manually. */
  dreamTrigger?: () => Promise<{ memoriesConsolidated: number; skillsReviewed: number; summary: string; durationMs: number }>;
  /** J2: Achievements list (GET /achievements). */
  achievementsList?: () => { unlocked: Array<{ id: string; name: string; description: string; unlockedAt: number }>; locked: Array<{ id: string; name: string; description: string }>; stats: Record<string, number> };
  /** H9: Webhooks list (GET /webhooks). */
  webhooksList?: () => Array<{ id: string; url: string; events: string[]; createdAt: number }>;
  /** H9: Webhook add (POST /webhooks). */
  webhookAdd?: (webhook: { url: string; events: string[] }) => { id: string };
  /** Optional: trigger an immediate run of a cron job. */
  cronRunNow?: (jobId: string) => void | Promise<void>;
  /** Optional: remove a job from the underlying cron scheduler. */
  cronRemove?: (jobId: string) => boolean;
  cronAdd?: (job: ControlCronJob) => void;
  /** Optional: returns current queue depth for a session. */
  poolQueueDepth?: (sessionId: string) => number;
  /** Optional: returns WS connection info (token) for GET /ws-info. */
  wsInfo?: () => unknown;
  /** Phase G: device pairing manager (optional). */
  devicePairing?: DevicePairing;
  approvalRelay?: ApprovalRelay;
  lifecycleGuard?: LifecycleGuard;
  /** Phase 3-7: WebAuthn/FaceID biometric auth service (optional). */
  webAuthn?: WebAuthnService;
  /** C-5 fix: optional voice call channel for Twilio integration. */
  voiceCall?: VoiceCallChannel;
}
