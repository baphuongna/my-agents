/**
 * @my-agent/gateway — HTTP/WS gateway + §25.6 wire envelope + readiness probes.
 *
 * One loop, many surfaces. The gateway serves: (a) an HTTP control plane
 * (sessions/channels/cron/config/tools — §12 gateway-protocol), (b) a WebSocket
 * subscription to the typed RuntimeEvent bus (§25.6) w/ replay-from-cursor, and
 * (c) readiness probes (§13 R31: /health/live vs /ready vs /functional).
 *
 * UI surfaces (§25) are CONSUMERS of the typed RuntimeEvent bus — they never
 * scrape stdout (invariant #11). The wire envelope is the only core UI contract.
 *
 * Source: §12 Channels & Gateway, §13 Observability readiness, §25.6 contract.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, resolve as pathResolve, sep as pathSep, dirname } from "node:path";
export { ControlPlane, HandleLruCache } from "./control.js";
export type { ControlSession, ControlCronJob, CachedHandle } from "./control.js";
import { ControlPlane } from "./control.js";
import type { ControlCronJob } from "./control.js";
import { WebSocketServer, type WebSocket } from "ws";
import { nowWallclock, type RuntimeEvent } from "@my-agent/core";
import { HookRegistry } from "./hooks.js";
import { CronScheduler } from "@my-agent/cron";
import { SyncServer } from "@my-agent/sync";
import { CollabRelay } from "@my-agent/collab";
import { ChannelSessionRouter } from "./channel-session.js";
import type { ChannelRegistry, ChannelMessage } from "./channels.js";
import { getVapidPublicKey, addSubscription, removeSubscription } from "./push.js";
import { encodePairingQR, type DevicePairing, type PairingQR, type WebAuthnService } from "@my-agent/secrets";
import type { VoiceCallChannel } from "./voice-call.js";

// ─── §25.6 UI ↔ Runtime wire envelope ─────────────────────────────────────────

export interface WireEnvelope {
  version: 1;
  sessionId: string;
  runId?: string;
  laneId?: string;
  seq: number;
  event: unknown; // a RuntimeEvent (§13) — opaque here to avoid a core import cycle
  ts: number;
}

/** Frame a RuntimeEvent into the wire envelope. */

/** Phase C: CSP for PWA — widened for service workers + push subscriptions. */
const GATEWAY_CSP =
  "frame-ancestors 'none'; default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:*; script-src 'self'; worker-src 'self';";

export function frame(opts: {
  sessionId: string;
  seq: number;
  event: unknown;
  runId?: string;
  laneId?: string;
  ts?: number;
}): WireEnvelope {
  return { version: 1, sessionId: opts.sessionId, runId: opts.runId, laneId: opts.laneId, seq: opts.seq, event: opts.event, ts: opts.ts ?? nowWallclock() };
}

// ─── §13 R31 readiness probes ─────────────────────────────────────────────────

/** 3-phase readiness: liveness (alive) vs readiness (can serve) vs functional
 * (deps healthy). MyAgents readiness-state. */
export type ReadinessState = "live" | "ready" | "functional";

export interface ProbeResult {
  state: ReadinessState;
  ok: boolean;
  /** 503 + Retry-After when not ready (§13). */
  retryAfterS?: number;
  detail?: string;
}

/** A readiness registry: components register health; the probe aggregates. */
export class ReadinessRegistry {
  private readonly checks = new Map<string, () => boolean>();
  private booted = false;

  register(name: string, check: () => boolean): void {
    this.checks.set(name, check);
  }
  markBooted(): void {
    this.booted = true;
  }

  /** /health/live — process is alive (always 200 once the server is up). */
  liveness(): ProbeResult {
    return { state: "live", ok: true };
  }
  /** /ready — booted + all registered checks pass (503 + Retry-After otherwise). */
  readiness(): ProbeResult {
    if (!this.booted) return { state: "ready", ok: false, retryAfterS: 2, detail: "booting" };
    const failed: string[] = [];
    for (const [name, check] of this.checks) {
      try {
        if (!check()) failed.push(name);
      } catch {
        failed.push(name);
      }
    }
    if (failed.length > 0) {
      return { state: "ready", ok: false, retryAfterS: 2, detail: `failed: ${failed.join(",")}` };
    }
    return { state: "ready", ok: true };
  }
  /** /functional — ready + the loop has produced at least one healthy turn. */
  functional(healthyTurns: number): ProbeResult {
    const r = this.readiness();
    if (!r.ok) return { ...r, state: "functional" };
    if (healthyTurns < 1) return { state: "functional", ok: false, retryAfterS: 5, detail: "no healthy turn yet" };
    return { state: "functional", ok: true };
  }
}

// ─── HTTP/WS gateway ──────────────────────────────────────────────────────────

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
   * The sweep awaits this before recording the run's outcome (D2 fix). */
  onRunOnSession?: (sessionId: string, prompt: string, onEvent?: (e: unknown) => void) => Promise<string>;
  /** Phase 3A stopgap: max due jobs fired per sweep (bounds concurrent full-cred
   * turns / cost amplification until the full scheduler.max_concurrent lands). */
  cronMaxConcurrent?: number;
  /** Phase 2C: persist the scheduler state (advanced nextRunAt) to cron.json.
   * Called before firing (at-most-once across crashes) + after complete (re-anchor). */
  cronPersist?: () => void;
  /** Phase 4A: mirror a run to durable history (SQLite) on claim. */
  cronRunStart?: (rec: { runId: string; jobId: string; startedAt: number; status: string; claimedBy?: string }) => void;
  /** Phase 4A: update durable history on completion. */
  cronRunEnd?: (runId: string, status: string, error: string | null, endedAt: number) => void;
  /** Phase 4A: read a job's durable run history for GET /cron/jobs/:id/runs. */
  cronRuns?: (jobId: string) => unknown[];
  /** Phase 4C: heartbeat (alive each sweep; success on a clean sweep). */
  cronHeartbeat?: (success: boolean) => void;
  /** Phase 3C/G8: runtime-flip the cron approval mode (deny/approve). */
  cronSetApprovalMode?: (mode: "deny" | "approve") => void;
  /** §12 sync server (CRDT + HLC). Stored only — no auto-start (Tier-2). */
  sync?: SyncServer;
  /** §12 collaboration relay (rooms). Stored only — no auto-start (Tier-2). */
  collab?: CollabRelay;
  /** Channel session router (inbound messages → sessions). */
  channelRouter?: ChannelSessionRouter;
  /** Channel registry (messaging adapters). */
  channels?: ChannelRegistry;
  /** Optional: returns AgentPool status for GET /pool/sessions. */
  poolStatus?: () => unknown;
  /** Optional: kill a pool session for POST /pool/kill/:id. */
  poolKill?: (sessionId: string) => boolean;
  /** Optional: acquire a new pool session for POST /pool/acquire. */
  poolAcquire?: (cwd: string) => string | Promise<string>;
  /** Optional: send a prompt to a pool session for POST /pool/prompt/:id. */
  poolPrompt?: (sessionId: string, text: string) => void;
  /** Optional: list subagents for a session (returns SubagentHandle[]). */
  poolSubagents?: (sessionId: string) => Array<{ id: string; goal: string; status: string; depth: number; output?: string }>;
  /** Optional: MCP server management callbacks. */
  mcpList?: () => Array<{ id: string; command: string; args: string[]; phase: string; health: string; tools: string[]; lastError?: string }>;
  mcpAdd?: (cfg: { id: string; command: string; args?: string[]; env?: Record<string, string> }) => void;
  mcpRemove?: (id: string) => boolean;
  mcpConnect?: (id: string) => Promise<void>;
  mcpDiscover?: (id: string) => Promise<string[]>;
  /** Skills list. */
  skillsList?: () => Array<{ name: string; description: string; triggers: string[] }>;
  /** Roles list (from ~/.mya/roles/*.json). */
  rolesList?: () => Array<{ name: string; description: string; promptAppend?: string; toolsAllowed?: string[]; toolsDenied?: string[]; modelPrefer?: string; memoryScope?: string }>;
  /** Memory/brain stats. */
  memoryStats?: () => { facts: number; takes: number; tombstones: number; dreamRunning: boolean; lastDream?: string };
  /** Trigger a dream cycle manually. */
  dreamTrigger?: () => Promise<{ memoriesConsolidated: number; skillsReviewed: number; summary: string; durationMs: number }>;
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
  /** Phase 3-7: WebAuthn/FaceID biometric auth service (optional). */
  webAuthn?: WebAuthnService;
  /** C-5 fix: optional voice call channel for Twilio integration. */
  voiceCall?: VoiceCallChannel;
}

/** A minimal HTTP + WS gateway. HTTP serves readiness probes + a control stub;
 * WS subscribes clients to the RuntimeEvent bus with replay-from-cursor. */
export class Gateway {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly subscribers = new Map<WebSocket, { session: string; since: number; room?: string; clientId: string }>(); // ws → subscribed session + cursor
  /** SSE subscribers: ServerResponse → { session, since, clientId } */
  private readonly sseSubscribers = new Map<ServerResponse, { session: string; since: number; clientId: string }>();
  /** Session takeover: sessionId → controllerClientId */
  private readonly sessionController = new Map<string, string>();
  private seq = 0;
  /** HIGH-2 fix: per-session retained-event buffers (was a single global buffer →
   * cross-session leak). Keyed by sessionId. */
  private readonly retainedBySession = new Map<string, WireEnvelope[]>();
  private readonly retainBound = 10_000; // per session
  readonly readiness: ReadinessRegistry;
  readonly host: string;
  readonly port: number;
  /** §12 control-plane (sessions/cron/config/tools + per-session handle LRU). */
  readonly control: ControlPlane;
  /** §12 extension-lifecycle hook registry (Phase 2 wiring). */
  private readonly hooks: HookRegistry;
  /** §12.3 cron scheduler (optional — Phase 3 wiring). */
  private readonly cron?: CronScheduler;
  /** Cron sweep interval in ms. */
  private readonly cronIntervalMs: number;
  /** Cron sweep timer handle; tracked so stop() can clear it. */
  private cronTimer?: NodeJS.Timeout;
  /** Phase 0B: reconcile scheduler from cron.json each sweep. */
  private readonly cronReload?: () => void;
  /** Phase 1A: run a cron-fired prompt, returning the response text. */
  private readonly onRunOnSession?: (sessionId: string, prompt: string, onEvent?: (e: unknown) => void) => Promise<string>;
  /** Phase 3A stopgap: max due jobs fired per sweep. */
  private readonly cronMaxConcurrent: number;
  /** Phase 2C: persist scheduler state (atomic cron.json write). */
  private readonly cronPersist?: () => void;
  private readonly cronRunStart?: (rec: { runId: string; jobId: string; startedAt: number; status: string; claimedBy?: string }) => void;
  private readonly cronRunEnd?: (runId: string, status: string, error: string | null, endedAt: number) => void;
  private readonly cronRuns?: (jobId: string) => unknown[];
  private readonly cronHeartbeat?: (success: boolean) => void;
  private readonly cronSetApprovalMode?: (mode: "deny" | "approve") => void;
  /** Phase 1A: re-entrancy guard — a sweep overlapping the previous one (a slow
   * job > cronIntervalMs) skips instead of double-scanning / racing claims. */
  private cronSweeping = false;
  /** §12 sync server (optional — Phase 6 wiring). Stored; no auto-start. */
  private readonly sync?: SyncServer;
  /** §12 collaboration relay (optional — Phase 6 wiring). Stored; no auto-start. */
  private readonly collab?: CollabRelay;
  /** Channel session router (inbound messages → sessions). */
  private readonly channelRouter?: ChannelSessionRouter;
  /** Channel registry (messaging adapters). */
  private readonly channels?: ChannelRegistry;
  /** Optional pool status callback. */
  private readonly poolStatus?: () => unknown;
  /** Optional pool kill callback. */
  private readonly poolKill?: (sessionId: string) => boolean;
  /** Optional pool acquire callback. */
  private readonly poolAcquire?: (cwd: string) => string | Promise<string>;
  private readonly poolPrompt?: (sessionId: string, text: string) => void;
  private readonly poolSubagents?: (sessionId: string) => Array<{ id: string; goal: string; status: string; depth: number; output?: string }>;
  private readonly mcpList?: () => Array<{ id: string; command: string; args: string[]; phase: string; health: string; tools: string[]; lastError?: string }>;
  private readonly mcpAdd?: (cfg: { id: string; command: string; args?: string[]; env?: Record<string, string> }) => void;
  private readonly mcpRemove?: (id: string) => boolean;
  private readonly mcpConnect?: (id: string) => Promise<void>;
  private readonly mcpDiscover?: (id: string) => Promise<string[]>;
  private readonly skillsList?: () => Array<{ name: string; description: string; triggers: string[] }>;
  private readonly rolesList?: () => Array<{ name: string; description: string; promptAppend?: string; toolsAllowed?: string[]; toolsDenied?: string[]; modelPrefer?: string; memoryScope?: string }>;
  private readonly memoryStats?: () => { facts: number; takes: number; tombstones: number; dreamRunning: boolean; lastDream?: string };
  private readonly dreamTrigger?: () => Promise<{ memoriesConsolidated: number; skillsReviewed: number; summary: string; durationMs: number }>;
  private readonly cronRunNow?: (jobId: string) => void | Promise<void>;
  private readonly cronRemove?: (jobId: string) => boolean;
  private readonly cronAdd?: (job: ControlCronJob) => void;
  private readonly poolQueueDepth?: (sessionId: string) => number;
  /** Optional WS info callback. */
  private readonly wsInfo?: () => unknown;
  /** Phase G: device pairing manager. */
  private readonly devicePairing?: DevicePairing;
  /** Phase 3-7: WebAuthn biometric auth service. */
  private readonly webAuthn?: WebAuthnService;
  private readonly voiceCall?: VoiceCallChannel;
  /** Thinking level change handler. */
  private onThinkingChange?: (level: string | undefined) => void;
  /** One-shot delivery-channel warning flag. */
  private cronDeliveredWarned = false;
  /** Static file directory (optional — Phase 25.2 build pipeline). */
  private readonly staticDir?: string;
  /** MIME type map for common static file extensions. */
  private readonly mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  constructor(opts: GatewayOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 0;
    // M8 fix: refuse a non-loopback bind unless explicitly opted in (the gateway
    // is unauthenticated; binding it to 0.0.0.0 is a full compromise).
    const loopback = new Set(["127.0.0.1", "::1", "localhost", ""]);
    if (!loopback.has(this.host) && !opts.allowExternalBind) {
      throw new Error(`gateway refuses non-loopback bind ${this.host} without allowExternalBind:true`);
    }
    if (!loopback.has(this.host)) {
      console.warn(`[gateway] WARNING: binding to non-loopback ${this.host} (unauthenticated surface exposed)`);
    }
    this.readiness = opts.readiness ?? new ReadinessRegistry();
    this.rootHtml = opts.rootHtml;
    this.staticDir = opts.staticDir;
    this.onWsMessage = opts.onWsMessage;
    this.onThinkingChange = opts.onThinkingChange;
    this.wsToken = opts.wsToken;
    this.control = opts.control ?? new ControlPlane();
    this.hooks = opts.hooks ?? new HookRegistry();
    this.cron = opts.cron;
    this.cronIntervalMs = opts.cronIntervalMs ?? 30_000;
    this.sync = opts.sync;
    this.collab = opts.collab;
    this.channelRouter = opts.channelRouter;
    this.channels = opts.channels;
    // Forward channel events to WS subscribers (real-time TUI visibility)
    if (this.channelRouter) {
      this.channelRouter.onEvent((event) => {
        if ("sessionId" in event) {
          this.broadcast(event.sessionId, { kind: "channel", ...event });
        }
      });
    }
    this.poolStatus = opts.poolStatus;
    this.poolKill = opts.poolKill;
    this.poolAcquire = opts.poolAcquire;
    this.poolPrompt = opts.poolPrompt;
    this.poolSubagents = opts.poolSubagents;
    this.mcpList = opts.mcpList;
    this.mcpAdd = opts.mcpAdd;
    this.mcpRemove = opts.mcpRemove;
    this.mcpConnect = opts.mcpConnect;
    this.mcpDiscover = opts.mcpDiscover;
    this.skillsList = opts.skillsList;
    this.rolesList = opts.rolesList;
    this.memoryStats = opts.memoryStats;
    this.dreamTrigger = opts.dreamTrigger;
    this.cronRunNow = opts.cronRunNow;
    this.cronRemove = opts.cronRemove;
    this.cronAdd = opts.cronAdd;
    this.cronReload = opts.cronReload;
    this.onRunOnSession = opts.onRunOnSession;
    this.cronMaxConcurrent = opts.cronMaxConcurrent ?? 4;
    this.cronPersist = opts.cronPersist;
    this.cronRunStart = opts.cronRunStart;
    this.cronRunEnd = opts.cronRunEnd;
    this.cronRuns = opts.cronRuns;
    this.cronHeartbeat = opts.cronHeartbeat;
    this.cronSetApprovalMode = opts.cronSetApprovalMode;
    this.poolQueueDepth = opts.poolQueueDepth;
    this.wsInfo = opts.wsInfo;
    this.devicePairing = opts.devicePairing;
    this.webAuthn = opts.webAuthn;
    this.voiceCall = opts.voiceCall;
    // Phase 3: if cron is configured but no delivery channel exists, log once.
    // Phase 1A: delivery is now via onRunOnSession (the sweep runs + records real
    // outcome). Warn only if NEITHER is wired (truly no way to execute).
    if (this.cron && !this.onWsMessage && !this.onRunOnSession && !this.cronDeliveredWarned) {
      console.warn("[gateway] cron is configured but neither onWsMessage nor onRunOnSession is wired; due jobs cannot execute.");
      this.cronDeliveredWarned = true;
    }
  }

  private rootHtml?: string;
  /** Phase 15: incoming WS message handler (for dashboard prompts). */
  onWsMessage?: (session: string, data: unknown) => void;
  /** Phase 15 M2: optional local-only WS auth token. */
  wsToken?: string;

  /** Start listening. Resolves with the bound port (0 = ephemeral). */
  start(): Promise<{ port: number; wsPath: string }> {
    return new Promise((resolve, reject) => {
      this.http = createServer((req, res) => this.handleHttp(req, res));
      this.wss = new WebSocketServer({ noServer: true });
      this.http.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", `http://${this.host}`);
        if (url.pathname === "/events") {
          // Phase 15 M2 / 0C: check the WS token (if configured) via query param
          // OR the HttpOnly mya_ws cookie (token-free dashboard connects via cookie).
          if (this.wsToken) {
            const token = url.searchParams.get("token");
            const cookieOk = (() => {
              const c = req.headers.cookie;
              if (typeof c !== "string") return false;
              for (const part of c.split(";")) {
                const [k, ...v] = part.trim().split("=");
                if (k === "mya_ws" && v.join("=") === this.wsToken) return true;
              }
              return false;
            })();
            if (token !== this.wsToken && !cookieOk) {
              socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
              socket.destroy();
              return;
            }
          }
          // HIGH-1 / 0C CSRF fix: enforce Origin == the gateway's OWN origin (same
          // port). A malicious localhost page on a different port could otherwise
          // plant the auth cookie (same-site across localhost ports) + open a WS
          // (CSWSH). No-Origin clients (the cookie-authed dashboard is same-origin
          // and sends Origin; native/CLI WS send none) are allowed.
          const origin = req.headers.origin;
          const port = (this.http?.address() as { port?: number } | null)?.port ?? this.port;
          const allowed = new Set([
            `http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`,
          ]);
          if (origin && !allowed.has(origin)) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
          this.wss!.handleUpgrade(req, socket, head, (ws) => this.handleWs(ws, url, !!origin));
        } else {
          socket.destroy();
        }
      });
      this.http.on("error", reject);
      // Phase 3 wiring: cron sweep timer. Started just before listen() so a
      // misbehaving sweep never blocks the listening socket from accepting
      // upgrades.
      if (this.cron) {
        const workerId = `gateway:${this.host}:${this.port}`;
        // Phase 0B: reconcile from cron.json once at start so CLI/external edits
        // load before the first sweep tick (no 30s delay on startup).
        try { this.cronReload?.(); } catch (e) {
          console.warn("[gateway] cron initial reload failed (non-fatal):", (e as Error).message);
        }
        this.cronTimer = setInterval(() => { void this.cronSweep(workerId); }, this.cronIntervalMs);
        // Don't keep the process alive solely for the cron sweep.
        this.cronTimer.unref?.();
      }
      this.http.listen(this.port, this.host, () => {
        const addr = this.http!.address();
        const port = addr && typeof addr === "object" ? addr.port : this.port;
        // Mark the gateway as booted so /ready returns ok:true (not "booting").
        this.readiness.markBooted();
        resolve({ port, wsPath: `ws://${this.host}:${port}/events` });
      });
    });
  }

  /** Phase 1A: one cron sweep — reconcile, claim due jobs, run each on its own
   * `_cron:<jobId>` session (parallelism), and record the REAL outcome after the
   * agent turn resolves (D2 fix — was synchronously 'succeeded' before execution).
   * Public so the D2 outcome behavior is testable without a live sweep timer. */
  async cronSweep(workerId: string): Promise<void> {
    if (!this.cron) return;
    if (this.cronSweeping) return; // overlapping sweep (a prior job > interval) — skip
    this.cronSweeping = true;
    try {
      // Phase 4C: heartbeat — alive marker (every sweep).
      try { this.cronHeartbeat?.(false); } catch { /* best-effort */ }
      // Phase 0B: pick up external cron.json edits each sweep.
      try { this.cronReload?.(); } catch (e) {
        console.warn("[gateway] cron reload failed (non-fatal):", (e as Error).message);
      }
      const due = this.cron.dueAndAdvance();
      // Phase 2C: persist the advanced nextRunAt BEFORE firing — at-most-once
      // across crashes. If the persist FAILS, skip the fire this sweep (the safe
      // degradation is a missed fire, not a potential double-fire on crash).
      try { this.cronPersist?.(); } catch (e) {
        console.warn("[gateway] cron persist (pre-fire) failed — skipping fire this sweep (at-most-once):", (e as Error).message);
        this.cron.sweepExpired();
        return;
      }
      if (due.length === 0) { this.cron.sweepExpired(); return; }
      // Phase 3A stopgap: cap concurrent full-cred turns per sweep.
      const batch = due.slice(0, this.cronMaxConcurrent);
      // Fire due jobs in parallel — each on a distinct _cron:<jobId> session so a
      // slow job doesn't block others (C3 fix; bounded by AgentPool concurrency).
      await Promise.allSettled(batch.map(async (job) => {
        const run = this.cron!.claim(job.id, workerId);
        if (!run) return; // another worker holds an unexpired lease
        // Phase 4A: mirror the run start to durable history.
        try { this.cronRunStart?.({ runId: run.runId, jobId: job.id, startedAt: run.startedAt, status: "claimed", claimedBy: run.claimedBy }); } catch { /* best-effort */ }
        this.cron!.start(run.runId);
        try {
          if (!this.onRunOnSession) {
            // No runner wired — can't execute. Fail (not silent 'succeeded').
            this.cron!.complete(run.runId, "failed", "no cron session runner wired");
          } else {
            const sessionId = `_cron:${job.id}`;
            const text = await this.onRunOnSession(sessionId, job.prompt, (e: unknown) => this.broadcast(`_cron:${job.id}`, e));
            // D2 / hermes empty-response soft-fail: success but no text → failed.
            if (text == null || text.trim() === "") {
              this.cron!.complete(run.runId, "failed", "agent produced empty response");
            } else {
              this.cron!.complete(run.runId, "succeeded");
            }
          }
        } catch (e) {
          this.cron!.complete(run.runId, "failed", (e as Error).message);
        }
        // Phase 4A: mirror the run outcome to durable history (runs for EVERY
        // outcome incl. no-runner — the early-return bug left rows stuck 'claimed').
        const rec = this.cron!.runsOf(job.id).at(-1);
        if (rec) {
          try { this.cronRunEnd?.(run.runId, rec.status, rec.error ?? null, rec.endedAt ?? Date.now()); } catch { /* best-effort */ }
        }
      }));
      // complete() re-anchored nextRunAt off completion time — persist for accuracy.
      try { this.cronPersist?.(); } catch { /* best-effort */ }
      // Phase 4A: mirror lease-expired runs (a crashed worker's run flips to
      // 'lease-expired' in memory; mirror it so the durable row isn't stuck 'claimed').
      const expired = this.cron.sweepExpired();
      for (const runId of expired) {
        try { this.cronRunEnd?.(runId, "lease-expired", null, Date.now()); } catch { /* best-effort */ }
      }
      // Phase 4C: success marker (clean sweep).
      try { this.cronHeartbeat?.(true); } catch { /* best-effort */ }
    } catch (e) {
      // cron loop must NEVER crash the gateway.
      console.warn("[gateway] cron sweep failed (non-fatal):", (e as Error).message);
    } finally {
      this.cronSweeping = false;
    }
  }

  /** Phase 0C: paths exempt from the auth gate (health probes, PWA assets,
   * GET / which sets the auth cookie, channel webhooks + pairing which carry
   * their OWN auth via adapter verify() / MYA_PAIRING_TOKEN). Everything else
   * (incl. /ws-info, /cron/jobs*, /sessions/*) requires the ws token. */
  private isAuthAllowlisted(url: URL, method: string | undefined): boolean {
    const p = url.pathname;
    if (p === "/health/live" || p === "/ready" || p === "/manifest.json" || p === "/sw.js") return true;
    if (p.startsWith("/icons/")) return true;
    // channel webhooks carry their own auth (adapter verify() / signature);
    // gating them with wsToken would block external webhook delivery.
    if (/^\/channel\/([^/]+)\/webhook$/.test(p) && method === "POST") return true;
    // device pairing uses MYA_PAIRING_TOKEN (checked in the handler); the wsToken
    // gate would reject a pairing client that has only the pairing token.
    if (p === "/pair/request" || p === "/pair/accept" || p === "/pair/devices" || /^\/pair\/devices\//.test(p)) return true;
    if ((p === "/" || p === "/index.html") && method === "GET") return true;
    return false;
  }

  /** Phase 0C: a request is authed if it carries the WS token as a Bearer header
   * or in the HttpOnly mya_ws cookie. Constant-time compare (defense-in-depth). */
  private isAuthed(req: IncomingMessage): boolean {
    if (!this.wsToken) return true; // no token configured (dev) → open
    const tok = this.wsToken;
    const same = (v: string | undefined): boolean => {
      if (typeof v !== "string") return false;
      const a = Buffer.from(v);
      const b = Buffer.from(tok);
      return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
    };
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.startsWith("Bearer ") && same(auth.slice(7))) return true;
    const cookie = req.headers.cookie;
    if (typeof cookie === "string") {
      for (const part of cookie.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === "mya_ws" && same(v.join("="))) return true;
      }
    }
    return false;
  }

  /** Phase 0C (CSRF): the request's Origin (if present) must be the gateway's own
   * origin (same port). Blocks a malicious localhost page on a different port.
   * Absent Origin (curl/CLI) is allowed. */
  private isOwnOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== "string" || !origin) return true; // non-browser caller
    const port = (this.http?.address() as { port?: number } | null)?.port ?? this.port;
    const own = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
    return own.has(origin);
  }

  /** Phase 0C: set the HttpOnly SameSite=Strict auth cookie when serving the
   * dashboard from the gateway's OWN origin (blocks a cross-port localhost page
   * from planting the cookie). HttpOnly → JS/XSS can't read it; SameSite=Strict →
   * CSRF-resistant. (Same-user process isolation is deferred to a Unix-socket
   * binding — a loopback curl with no Origin still receives it.) */
  private setAuthCookie(req: IncomingMessage, res: ServerResponse): void {
    if (!this.wsToken) return;
    if (!this.isOwnOrigin(req)) return; // don't set the cookie for cross-origin GET /
    res.setHeader("Set-Cookie", `mya_ws=${this.wsToken}; HttpOnly; SameSite=Strict; Path=/`);
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    // ── CORS (localhost-only): lets the desktop dashboard / web UI reach the
    //    gateway from a browser origin (e.g. dev index.html on another loopback
    //    port). Only localhost origins are reflected — never arbitrary origins,
    //    so this does not expose the gateway to the wider network.
    const origin = req.headers.origin;
    if (typeof origin === "string" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    // Phase 0C: auth gate. Non-allowlist routes require the WS token (Bearer
    // header OR HttpOnly cookie). Allowlist: health/ready probes, PWA assets
    // (manifest/icons/sw), GET / (rootHtml — which SETS the cookie), channel
    // webhooks + pairing (own auth). When wsToken is unset (MYA_NO_WS_TOKEN dev)
    // everything is open.
    if (this.wsToken && !this.isAuthAllowlisted(url, req.method)) {
      if (!this.isAuthed(req)) return send(401, { error: "unauthorized" });
      // CSRF defense: a state-changing request carrying an Origin header must
      // come from the gateway's OWN origin (same port). SameSite=Strict is the
      // same registrable site across localhost ports, so it alone can't stop a
      // malicious localhost page on another port. No-Origin callers (curl/CLI)
      // are unaffected.
      if (req.method && req.method !== "GET" && !this.isOwnOrigin(req)) {
        return send(403, { error: "cross-origin state change blocked" });
      }
    }
    // C11: cron MUTATIONS require auth (wsToken) OR an explicit
    // MYA_CRON_UNSAFE_NO_AUTH=1 — never implicitly opened by MYA_NO_WS_TOKEN
    // (the dashboard dev bypass). Closes the D6 re-opening in dev deployments.
    const isCronMutation = req.method !== "GET" && req.method !== "OPTIONS" && /^\/cron\/jobs/.test(url.pathname);
    if (isCronMutation && !this.wsToken && !process.env["MYA_CRON_UNSAFE_NO_AUTH"]) {
      return send(401, { error: "cron mutations require wsToken auth (or MYA_CRON_UNSAFE_NO_AUTH=1)" });
    }
    // §12 parametric control-plane route: /sessions/:id
    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sid = sessionMatch[1]!;
      // DELETE /sessions/:id — kill session
      if (req.method === "DELETE") {
        this.control.killSession(sid);
        return send(200, { ok: true, killed: sid });
      }
      // GET /sessions/:id — get session info
      const s = this.control.getSession(sid);
      return s ? send(200, s) : send(404, { error: "session not found" });
    }
    // Phase 3: Sync HTTP endpoints.
    if (url.pathname === "/sync/state" && this.sync) {
      return send(200, this.sync.replicaState.export());
    }
    if (url.pathname === "/sync/pull" && this.sync) {
      try {
        const sinceParam = url.searchParams.get("since");
        const sinceHlc = sinceParam ? JSON.parse(sinceParam) : undefined;
        return send(200, this.sync.pull(sinceHlc));
      } catch (e) {
        return send(400, { error: "invalid since param", detail: (e as Error).message });
      }
    }
    if (url.pathname === "/sync/push" && this.sync && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const entries = JSON.parse(body);
          return send(200, this.sync!.push(entries));
        } catch (e) {
          return send(400, { error: "invalid push body", detail: (e as Error).message });
        }
      });
      return;
    }
    // Phase 3: Collab room management.
    if (url.pathname === "/collab/rooms" && this.collab) {
      const rooms: Record<string, unknown> = {};
      for (const ws of this.subscribers.keys()) {
        const sub = this.subscribers.get(ws)!;
        if (sub.room) {
          const r = sub.room;
          rooms[r] = rooms[r] ?? { clients: 0 };
          (rooms[r] as { clients: number }).clients++;
        }
      }
      return send(200, rooms);
    }
    switch (url.pathname) {
      case "/health/live": {
        const p = this.readiness.liveness();
        return send(p.ok ? 200 : 503, p);
      }
      case "/ready": {
        const p = this.readiness.readiness();
        return send(p.ok ? 200 : 503, p, p.ok ? {} : { "retry-after": String(p.retryAfterS ?? 2) });
      }
      case "/status": {
        const channels = this.channels?.list().map((c) => ({
          id: c.id,
          type: c.type,
          alias: c.alias,
          label: c.label,
          enabled: this.channels!.getConfig(c.id)?.enabled ?? c.isConfigured(),
          configured: c.isConfigured(),
          health: c.health(),
        })) ?? [];
        // Detect configured providers from env
        const providers = detectProviderSummary();
        // Subagent info from pool
        const poolEntries = (this.poolStatus ? this.poolStatus() : []) as Array<{ sessionId: string; busy: boolean; messages: number }>;
        const subagents = poolEntries.map((s: { sessionId: string; busy: boolean; messages: number }) => ({
          sessionId: s.sessionId,
          busy: s.busy,
          messages: s.messages,
        }));
        return send(200, {
          model: process.env["MYA_MODEL"] ?? "auto",
          uptime: Math.floor(process.uptime()),
          pid: process.pid,
          version: process.env["MYA_VERSION"] ?? "0.1.0",
          channels,
          providers,
          roles: this.rolesList ? this.rolesList() : [],
          subagents: { active: subagents.filter((s: { busy: boolean }) => s.busy).length, total: subagents.length },
        });
      }
      case "/functional": {
        const p = this.readiness.functional(this.healthyTurns);
        return send(p.ok ? 200 : 503, p);
      }
      // §12 control-plane: read-only management surface (sessions/cron/config/tools).
      case "/sessions":
        if (req.method === "POST") {
          // Create new session
          const sid = this.control.createSession() ?? `sess-${Date.now()}`;
          return send(201, { ok: true, sessionId: sid });
        }
        return send(200, this.control.listSessions());
      case "/config": return send(200, this.control.getConfig());
      case "/tools": return send(200, this.control.listTools());
      case "/models": {
        const providers = detectProviderSummary();
        const models = providers.map((p) => {
          const meta = MODEL_METADATA[p.id] ?? MODEL_METADATA[p.id.split("-")[0] ?? ""] ?? {};
          return {
            provider: p.id,
            id: p.model,
            name: p.model,
            reasoning: meta.reasoning,
            contextWindow: meta.contextWindow,
            maxTokens: meta.maxTokens,
          };
        });
        return send(200, models);
      }
      case "/thinking": {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { level } = JSON.parse(body || "{}") as { level?: string };
              const valid = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
              if (level && !valid.includes(level)) return send(400, { error: `invalid level; valid: ${valid.join("|")}` });
              process.env["MYA_THINKING_LEVEL"] = level || "";
              // Update all PiAiProviderBridge instances
              if (this.onThinkingChange) this.onThinkingChange(level || undefined);
              return send(200, { ok: true, level: level || "off" });
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        return send(200, { level: process.env["MYA_THINKING_LEVEL"] || "off" });
      }
      case "/repos": {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { cwd } = JSON.parse(body || "{}") as { cwd?: string };
              if (!cwd) return send(400, { error: "cwd required" });
              const normalized = this.addRepo(cwd);
              return send(201, { ok: true, cwd: normalized });
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        return send(200, this.listRepos());
      }
      case "/":
      case "/index.html": {
        // Serve static files from dist/web/ if available
        if (this.staticDir) {
          const indexPath = join(this.staticDir, "index.html");
          if (existsSync(indexPath)) {
            try {
              const content = readFileSync(indexPath, "utf-8");
              this.setAuthCookie(req, res);
              res.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "x-frame-options": "DENY",
                "x-content-type-options": "nosniff",
                "content-security-policy": GATEWAY_CSP,
              });
              res.end(content);
              return;
            } catch {
              // Fall through to rootHtml
            }
          }
        }
        if (this.rootHtml) {
          // HIGH-3 fix: anti-clickjacking + nosniff headers (§25.2). A full
          // session-cookie + CSRF double-submit lands when the dashboard grows
          // mutating routes; for the read-only SPA these headers close the
          // clickjacking/XSS-MIME vectors.
          this.setAuthCookie(req, res);
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
            "content-security-policy": GATEWAY_CSP,
          });
          res.end(this.rootHtml);
          return;
        }
        return send(404, { error: "no dashboard configured" });
      }
      // ── Channel webhooks: POST /channel/:id/webhook ───────────────────
      // Each channel adapter parses its own webhook payload format.
      default: {
        // ── SSE: GET /sessions/:id/events ──
        const sseMatch = url.pathname.match(/^\/sessions\/([^/]+)\/events$/);
        if (sseMatch && req.method === "GET") {
          return this.handleSse(req, res, sseMatch[1]!);
        }
        // ── Session takeover: POST /sessions/:id/takeover ──
        const takeoverMatch = url.pathname.match(/^\/sessions\/([^/]+)\/takeover$/);
        if (takeoverMatch && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { clientId } = JSON.parse(body || "{}") as { clientId?: string };
              if (!clientId) return send(400, { error: "clientId required" });
              const sid = takeoverMatch[1]!;
              this.sessionController.set(sid, clientId);
              this.broadcast(sid, { kind: "controller_changed", controllerClientId: clientId });
              return send(200, { ok: true, sessionId: sid, controllerClientId: clientId });
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        // ── Session release: POST /sessions/:id/release ──
        const releaseMatch = url.pathname.match(/^\/sessions\/([^/]+)\/release$/);
        if (releaseMatch && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { clientId } = JSON.parse(body || "{}") as { clientId?: string };
              if (!clientId) return send(400, { error: "clientId required" });
              const sid = releaseMatch[1]!;
              const controller = this.sessionController.get(sid);
              if (controller && controller !== clientId) {
                return send(403, { error: "not_controller" });
              }
              this.broadcast(sid, { kind: "released", byClientId: clientId });
              // Close WS subscribers for this session
              for (const [ws, sub] of this.subscribers) {
                if (sub.session === sid) {
                  try { ws.close(); } catch { /* best-effort */ }
                }
              }
              // Close SSE subscribers for this session
              for (const [res2, sub] of this.sseSubscribers) {
                if (sub.session === sid) {
                  try { res2.end(); } catch { /* best-effort */ }
                }
              }
              this.sessionController.delete(sid);
              return send(200, { ok: true, sessionId: sid });
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        const webhookMatch = url.pathname.match(/^\/channel\/([^/]+)\/webhook$/);
        if (webhookMatch && req.method === "POST" && this.channelRouter) {
          const channelId = webhookMatch[1]!;
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", async () => {
            try {
              const msg = parseChannelWebhook(channelId, body);
              if (msg) {
                const result = await this.channelRouter!.route(msg);
                if ("response" in result) {
                  // Send response back via the channel
                  if (this.channels) {
                    await this.channels.send(result.session.channelId, result.session.userId, result.response);
                  }
                  return send(200, { ok: true, sessionId: result.session.sessionId });
                }
                return send(200, { ok: false, error: result.error });
              }
              return send(200, { ok: true }); // webhook ACK (unparseable → still 200)
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        // Channel sessions listing
        // ── Provider config (add/remove API key from gateway.env) ──
        if (url.pathname === "/providers/config" && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { id, envKey, apiKey, action } = JSON.parse(body || "{}") as { id?: string; envKey?: string; apiKey?: string; action?: "add" | "remove" };
              if (!id || !envKey) return send(400, { error: "id + envKey required" });
              const envFile = join(homedir(), ".mya", "gateway.env");
              let lines: string[] = [];
              try { lines = readFileSync(envFile, "utf8").split("\n"); } catch { /* file doesn't exist */ }
              // Remove existing entry for this envKey
              lines = lines.filter((l) => !l.startsWith(`${envKey}=`) && !l.startsWith(`#${envKey}=`));
              if (action === "add" && apiKey) {
                lines.push(`${envKey}=${apiKey}`);
              }
              writeFileSync(envFile, lines.join("\n"), "utf8");
              return send(200, { ok: true, id, envKey, action: action ?? "add", restart: true });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        // ── Channel config + test ──
        const channelConfigMatch = url.pathname.match(/^\/channels\/([^/]+)\/config$/);
        if (channelConfigMatch && req.method === "POST" && this.channels) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const patch = JSON.parse(body || "{}") as { enabled?: boolean };
              const id = channelConfigMatch[1]!;
              const ch = this.channels!.list().find((c) => c.id === id);
              if (!ch) return send(404, { error: "channel not found" });
              const cfg = this.channels!.getConfig(id) ?? { id, enabled: ch.isConfigured(), credentials: {}, targets: {} };
              if (patch.enabled !== undefined) cfg.enabled = patch.enabled;
              this.channels!.configure(id, cfg);
              return send(200, { ok: true, id, config: cfg });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        const channelTestMatch = url.pathname.match(/^\/channels\/([^/]+)\/test$/);
        if (channelTestMatch && req.method === "POST" && this.channels) {
          const id = channelTestMatch[1]!;
          const ch = this.channels!.list().find((c) => c.id === id);
          if (!ch) return send(404, { error: "channel not found" });
          ch.send(id, "✅ mya channel test — connection OK").then(
            () => send(200, { ok: true, id, message: "test sent" }),
            (e: unknown) => send(500, { ok: false, id, error: (e as Error).message }),
          );
          return;
        }
        if (url.pathname === "/channel/sessions" && this.channelRouter) {
          return send(200, this.channelRouter.listSessions());
        }
        // ── Cron management ──
        if (url.pathname === "/cron/jobs") {
          if (req.method === "GET") return send(200, this.cron ? this.cron.listJobs().map((j) => this.cron!.summary(j)) : this.control.listCronJobs());
          if (req.method === "POST") {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
              try {
                const job = JSON.parse(body || "{}") as { id?: string; name?: string; schedule?: string; prompt?: string; trigger?: string; timezone?: string };
                if (!job.name) return send(400, { error: "name required" });
                const id = job.id ?? `job-${nowWallclock().toString(36)}`;
                const created: ControlCronJob = {
                  id,
                  name: job.name,
                  trigger: (job.trigger as "cron" | "on-interval" | "once") ?? "cron",
                  schedule: job.schedule ?? "* * * * *",
                  prompt: job.prompt ?? "",
                  deliveryTarget: "_cron",
                  enabled: true,
                  timezone: job.timezone, // D9: forward timezone (parser already supports it)
                };
                this.control.registerCronJob(created);
                if (this.cronAdd) this.cronAdd(created);
                return send(201, created);
              } catch (e) { return send(400, { error: (e as Error).message }); }
            });
            return;
          }
        }
        const cronJobMatch = url.pathname.match(/^\/cron\/jobs\/([^/]+)$/);
        if (cronJobMatch && req.method === "GET") {
          const job = this.cron?.getJob(cronJobMatch[1]!) ?? this.control.getCronJob(cronJobMatch[1]!);
          return job ? send(200, job) : send(404, { error: "not found" });
        }
        const cronPatchMatch = url.pathname.match(/^\/cron\/jobs\/([^/]+)\/patch$/);
        if (cronPatchMatch && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const patch = JSON.parse(body || "{}") as Record<string, unknown>;
              const id = cronPatchMatch[1]!;
              // Phase 0B: PATCH writes through to the scheduler (updateJob → onDirty
              // → atomicWriteJobs) so it persists + reflects in GET. Falls back to
              // the control plane only when no scheduler is wired.
              if (this.cron) {
                const updated = this.cron.updateJob(id, patch);
                return updated ? send(200, this.cron.summary(updated)) : send(404, { error: "not found" });
              }
              const updated = this.control.updateCronJob(id, patch);
              return updated ? send(200, updated) : send(404, { error: "not found" });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        const cronDelMatch = url.pathname.match(/^\/cron\/jobs\/([^/]+)$/);
        if (cronDelMatch && req.method === "DELETE") {
          // Remove from underlying scheduler first (so it doesn't get re-synced)
          if (this.cronRemove) this.cronRemove(cronDelMatch[1]!);
          // Then remove from control plane
          const ok = this.control.removeCronJob(cronDelMatch[1]!);
          return send(ok ? 200 : 404, { ok });
        }
        const cronRunMatch = url.pathname.match(/^\/cron\/jobs\/([^/]+)\/run$/);
        if (cronRunMatch && req.method === "POST" && this.cronRunNow) {
          void this.cronRunNow(cronRunMatch[1]!);
          return send(200, { ok: true });
        }
        // Phase 4A: durable run history for a job.
        const cronRunsMatch = url.pathname.match(/^\/cron\/jobs\/([^/]+)\/runs$/);
        if (cronRunsMatch && req.method === "GET" && this.cronRuns) {
          return send(200, this.cronRuns(cronRunsMatch[1]!));
        }
        // G8: runtime-flip the cron approval mode (deny/approve). Auth-gated +
        // C11 cron-mutation check apply (it's a /cron/jobs* non-GET route).
        if (url.pathname === "/cron/approval-mode" && req.method === "POST" && this.cronSetApprovalMode) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { mode } = JSON.parse(body || "{}") as { mode?: string };
              if (mode !== "deny" && mode !== "approve") return send(400, { error: "mode must be 'deny' or 'approve'" });
              this.cronSetApprovalMode!(mode);
              console.warn(`[cron] approval_mode runtime-flipped to ${mode}`);
              return send(200, { ok: true, mode });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        // AgentPool sessions
        if (url.pathname === "/pool/sessions" && this.poolStatus) {
          return send(200, this.poolStatus());
        }
        // Kill pool session
        const poolKillMatch = url.pathname.match(/^\/pool\/kill\/(.+)$/);
        if (poolKillMatch && req.method === "POST" && this.poolKill) {
          const ok = this.poolKill(poolKillMatch[1]!);
          return send(ok ? 200 : 404, { ok });
        }
        // Queue depth for a session (Phase 1 backpressure observability)
        const poolQueueMatch = url.pathname.match(/^\/pool\/queue\/(.+)$/);
        if (poolQueueMatch && req.method === "GET" && this.poolQueueDepth) {
          const id = decodeURIComponent(poolQueueMatch[1]!);
          return send(200, { sessionId: id, depth: this.poolQueueDepth(id) });
        }
        // Acquire new pool session
        if (url.pathname === "/pool/acquire" && req.method === "POST" && this.poolAcquire) {
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString()));
          req.on("end", async () => {
            try {
              const { cwd } = JSON.parse(body || "{}") as { cwd?: string };
              if (!cwd) return send(400, { error: "cwd required" });
              const sessionId = await this.poolAcquire!(cwd);
              return send(200, { sessionId });
            } catch {
              return send(400, { error: "invalid json" });
            }
          });
          return;
        }
        // Prompt an existing session
        const poolPromptMatch = url.pathname.match(/^\/pool\/prompt\/([^/]+)$/);
        if (poolPromptMatch && req.method === "POST" && this.poolPrompt) {
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString()));
          req.on("end", () => {
            try {
              const { text } = JSON.parse(body || "{}") as { text?: string };
              if (!text) return send(400, { error: "text required" });
              this.poolPrompt!(poolPromptMatch[1]!, text);
              return send(200, { ok: true, sessionId: poolPromptMatch[1] });
            } catch {
              return send(400, { error: "invalid json" });
            }
          });
          return;
        }
        // ── Device pairing (Phase G) ──
        // G-R2-1 fix: require bearer token for pairing endpoints
        const pairingToken = process.env.MYA_PAIRING_TOKEN;
        if (pairingToken) {
          const authHeader = req.headers["authorization"] ?? "";
          const token = String(authHeader).replace(/^Bearer\s+/i, "");
          if (token !== pairingToken) {
            return send(401, { error: "unauthorized: invalid or missing pairing token" });
          }
        }
        if (url.pathname === "/pair/request" && req.method === "POST" && this.devicePairing) {
          const qr = this.devicePairing.createPairingRequest();
          return send(200, { ok: true, qr, encoded: encodePairingQR(qr) });
        }
        // DELETE /pair/devices/:id must be checked before GET /pair/devices
        const pairRevokeMatch = url.pathname.match(/^\/pair\/devices\/([^/]+)$/);
        if (pairRevokeMatch && req.method === "DELETE" && this.devicePairing) {
          this.devicePairing.revokeDevice(pairRevokeMatch[1]!);
          return send(200, { ok: true });
        }
        if (url.pathname === "/pair/devices" && req.method === "GET" && this.devicePairing) {
          return send(200, this.devicePairing.listDevices());
        }
        if (url.pathname === "/pair/accept" && req.method === "POST" && this.devicePairing) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { qr } = JSON.parse(body || "{}") as { qr?: PairingQR };
              if (!qr) return send(400, { error: "qr required" });
              const { device, ourPubkey } = this.devicePairing!.acceptPairing(qr);
              return send(200, { ok: true, device, ourPubkey });
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        // ── Push (PWA) ──
        if (url.pathname === "/push/vapid-key" && req.method === "GET") {
          return send(200, { publicKey: getVapidPublicKey() });
        }
        if (url.pathname === "/push/subscribe" && req.method === "POST") {
          let pushBody = "";
          req.on("data", (c) => (pushBody += c));
          req.on("end", () => {
            try {
              const sub = JSON.parse(pushBody || "{}") as { endpoint: string; keys: { p256dh: string; auth: string } };
              addSubscription(sub);
              return send(200, { ok: true });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        if (url.pathname === "/push/unsubscribe" && req.method === "POST") {
          let pushBody = "";
          req.on("data", (c) => (pushBody += c));
          req.on("end", () => {
            try {
              const { endpoint } = JSON.parse(pushBody || "{}") as { endpoint: string };
              removeSubscription(endpoint);
              return send(200, { ok: true });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        // ── WebAuthn/FaceID (Phase 3-7) ──
        if (url.pathname === "/auth/webauthn/status" && req.method === "GET" && this.webAuthn) {
          const rpId = url.searchParams.get("rpId") ?? undefined;
          this.webAuthn.status(rpId).then(
            (result) => send(200, result),
            (e: unknown) => send(500, { error: (e as Error).message }),
          );
          return;
        }
        if (url.pathname === "/auth/webauthn/challenge" && req.method === "POST" && this.webAuthn) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { kind, rpId } = JSON.parse(body || "{}") as { kind?: "register" | "authenticate"; rpId?: string };
              if (!kind || (kind !== "register" && kind !== "authenticate")) {
                return send(400, { error: "kind must be 'register' or 'authenticate'" });
              }
              const result = this.webAuthn!.generateChallenge(kind, rpId);
              return send(200, result);
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        if (url.pathname === "/auth/webauthn/verify" && req.method === "POST" && this.webAuthn) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { challengeId, credential, kind } = JSON.parse(body || "{}") as {
                challengeId?: string;
                credential?: unknown;
                kind?: "register" | "authenticate";
              };
              if (!challengeId || !credential) {
                return send(400, { error: "challengeId + credential required" });
              }
              const promise = kind === "register"
                ? this.webAuthn!.verifyRegistration(challengeId, credential)
                : this.webAuthn!.verifyAuthentication(challengeId, credential);
              promise.then(
                (result) => send(200, result),
                (e: unknown) => send(400, { ok: false, error: (e as Error).message }),
              );
              return;
            } catch (e) {
              return send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        // ── Skills ──
        if (url.pathname === "/skills" && req.method === "GET" && this.skillsList) {
          return send(200, this.skillsList());
        }
        // ── Roles ──
        if (url.pathname === "/roles" && req.method === "GET" && this.rolesList) {
          return send(200, this.rolesList());
        }
        // ── Memory + Dream ──
        if (url.pathname === "/memory/stats" && req.method === "GET" && this.memoryStats) {
          return send(200, this.memoryStats());
        }
        if (url.pathname === "/memory/dream" && req.method === "POST" && this.dreamTrigger) {
          this.dreamTrigger().then(
            (result) => send(200, result),
            (e: unknown) => send(500, { error: (e as Error).message }),
          );
          return;
        }
        // ── MCP servers ──
        if (url.pathname === "/mcp/servers" && req.method === "GET" && this.mcpList) {
          return send(200, this.mcpList());
        }
        if (url.pathname === "/mcp/servers" && req.method === "POST" && this.mcpAdd) {
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString()));
          req.on("end", () => {
            try {
              const cfg = JSON.parse(body || "{}") as { id?: string; command?: string; args?: string[]; env?: Record<string, string> };
              if (!cfg.id || !cfg.command) return send(400, { error: "id + command required" });
              this.mcpAdd!({ id: cfg.id, command: cfg.command, args: cfg.args, env: cfg.env });
              return send(201, { ok: true, id: cfg.id });
            } catch (e) { return send(400, { error: (e as Error).message }); }
          });
          return;
        }
        const mcpActionMatch = url.pathname.match(/^\/mcp\/servers\/([^/]+)\/(connect|discover|test)$/);
        if (mcpActionMatch && req.method === "POST") {
          const id = mcpActionMatch[1]!;
          const action = mcpActionMatch[2]!;
          if (action === "connect" && this.mcpConnect) {
            this.mcpConnect!(id).then(
              () => send(200, { ok: true, id, phase: "Connected" }),
              (e: unknown) => send(500, { ok: false, id, error: (e as Error).message }),
            );
            return;
          }
          if (action === "discover" && this.mcpDiscover) {
            this.mcpDiscover!(id).then(
              (tools) => send(200, { ok: true, id, tools }),
              (e: unknown) => send(500, { ok: false, id, error: (e as Error).message }),
            );
            return;
          }
        }
        const mcpDelMatch = url.pathname.match(/^\/mcp\/servers\/([^/]+)$/);
        if (mcpDelMatch && req.method === "DELETE" && this.mcpRemove) {
          const ok = this.mcpRemove!(mcpDelMatch[1]!);
          return ok ? send(200, { ok: true }) : send(404, { error: "not found" });
        }
        // ── Agent tree: sessions + their subagents ──
        if (url.pathname === "/pool/tree" && req.method === "GET" && this.poolStatus && this.poolSubagents) {
          const poolEntries = this.poolStatus() as Array<{ sessionId: string; busy: boolean; messages: number; lastActivity: number }>;
          const tree = poolEntries.map((s) => ({
            sessionId: s.sessionId,
            busy: s.busy,
            messages: s.messages,
            lastActivity: s.lastActivity,
            subagents: this.poolSubagents!(s.sessionId),
          }));
          return send(200, tree);
        }
        // WS connection info (for launcher to get token)
        if (url.pathname === "/ws-info" && this.wsInfo) {
          // 0C: /ws-info returns the raw token in a JS-readable body, so it must
          // NOT be reachable via the HttpOnly cookie (that would defeat HttpOnly
          // — XSS could read the token). Require a Bearer header explicitly.
          const auth = req.headers.authorization;
          if (this.wsToken && !(typeof auth === "string" && auth.startsWith("Bearer ") && auth.slice(7) === this.wsToken)) {
            return send(401, { error: "unauthorized" });
          }
          return send(200, this.wsInfo());
        }
        // Serve static files from dist/web/ if available
        if (this.staticDir && req.method === "GET") {
          const normalizedRoot = pathResolve(this.staticDir);
          const resolved = pathResolve(this.staticDir, "." + url.pathname);
          // Path traversal guard: boundary-aware check (not naive startsWith)
          if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + pathSep)) {
            return send(403, { error: "forbidden" });
          }
          try {
            if (existsSync(resolved) && statSync(resolved).isFile()) {
              const content = readFileSync(resolved);
              const ext = extname(resolved);
              const contentType = this.mimeTypes[ext] ?? "application/octet-stream";
              res.writeHead(200, { "content-type": contentType, "x-content-type-options": "nosniff" });
              res.end(content);
              return;
            }
          } catch {
            // Fall through to 404
          }
        }
        return send(404, { error: "not found" });
      }
    }
  }

  private healthyTurns = 0;
  private clientSeq = 0;
  /** Phase 3: tracks room ownership (first client to connect = owner). */
  private readonly roomOwners = new Map<string, string>();

  /** Record a healthy turn (for the /functional probe). */
  recordHealthyTurn(): void {
    this.healthyTurns++;
  }

  private handleWs(ws: WebSocket, url: URL, hasOrigin: boolean): void {
    const since = parseInt(url.searchParams.get("since") ?? "0", 10);
    // HIGH-2 fix: each subscriber binds to ONE session (query param `session`).
    // Live events + replay are filtered to that session only (no cross-session leak).
    const session = url.searchParams.get("session") ?? "default";
    const room = url.searchParams.get("room") ?? undefined;
    const clientId = `ws-${++this.clientSeq}`;
    this.subscribers.set(ws, { session, since, room, clientId });
    const retained = this.retainedBySession.get(session) ?? [];
    // §25.6 replay-from-cursor: deliver this session's retained events > since.
    for (const env of retained) {
      if (env.seq > since) ws.send(JSON.stringify(env));
    }
    // Phase 3: auto-join collab room if specified. First connector = owner.
    if (room && this.collab) {
      const isOwner = !this.roomOwners.has(room);
      if (isOwner) this.roomOwners.set(room, clientId);
      const role: "owner" | "guest" = isOwner ? "owner" : "guest";
      const clientObj = { id: clientId, room, role, send: (e: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e)); } };
      try {
        if (isOwner) this.collab.openRoom(room, clientObj);
        else this.collab.join(room, clientObj, "guest");
      } catch { /* room already open or rejoin — best-effort */ }
    }
    ws.on("close", () => {
      this.subscribers.delete(ws);
      // Phase 3: leave collab room on disconnect.
      if (room && this.collab) this.collab.leave(room, clientId);
    });
    ws.on("message", (raw: Buffer) => {
      try {
        const session = this.subscribers.get(ws)?.session ?? "default";
        const msg = JSON.parse(raw.toString()) as { kind?: string; text?: string; room?: string; event?: unknown; role?: string };
        // Phase 3: collab WS protocol.
        if (msg.kind === "collab-publish" && msg.room && this.collab) {
          // Relay handles broadcast via registered send callbacks (no double delivery).
          const isOwner = this.roomOwners.get(msg.room) === clientId;
          const role: "owner" | "guest" = isOwner ? "owner" : "guest";
          this.collab.publish(msg.room, { id: clientId, room: msg.room, role, send: () => {} }, msg.event as RuntimeEvent);
          return;
        }
        if (msg.kind === "collab-snapshot" && msg.room && this.collab) {
          ws.send(JSON.stringify({ kind: "collab-snapshot-result", room: msg.room, events: this.collab.snapshot(msg.room) }));
          return;
        }
        /* Phase 15: forward to onWsMessage (default text prompt). */
        // Controller enforcement: only controller can send prompts; abort is controller-free
        if (msg.kind === "prompt") {
          const controller = this.sessionController.get(session);
          if (controller && controller !== clientId) {
            ws.send(JSON.stringify({ error: "not_controller" }));
            return;
          }
        }
        if (this.onWsMessage) {
          this.onWsMessage(session, msg);
        }
      } catch { /* malformed — ignore */ }
    });
  }

  /** SSE endpoint: GET /sessions/:id/events — Server-Sent Events stream for
   * mobile clients. One-way (no CSRF risk), no Origin check needed. */
  private handleSse(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "connection": "keep-alive",
    });

    const clientId = `sse-${++this.clientSeq}`;
    const since = 0; // SSE clients get live events from connection point
    this.sseSubscribers.set(res, { session: sessionId, since, clientId });

    // Send init event with client ID + current controller
    const controller = this.sessionController.get(sessionId) ?? null;
    const initEvent = { kind: "init", yourClientId: clientId, controllerClientId: controller };
    res.write(`data: ${JSON.stringify(initEvent)}\n\n`);

    // Replay retained events for this session
    const retained = this.retainedBySession.get(sessionId) ?? [];
    for (const env of retained) {
      if (env.seq > since) {
        res.write(`data: ${JSON.stringify(env)}\n\n`);
      }
    }

    // Keep-alive ping every 5s
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* connection closed */ }
    }, 5_000);
    ping.unref?.();

    // Cleanup on close
    res.on("close", () => {
      clearInterval(ping);
      this.sseSubscribers.delete(res);
    });
  }

  /** Broadcast a RuntimeEvent to that session's WS subscribers only (HIGH-2). */
  broadcast(sessionId: string, event: unknown): WireEnvelope {
    const envelope = frame({ sessionId, seq: ++this.seq, event });
    // H-2 fix: notify push subscribers when notable events occur
    if (this.voiceCall) {
      const kind = (event as { kind?: string })?.kind ?? "event";
      const summary = JSON.stringify(event).slice(0, 100);
      import("./push.js").then(({ notifyEvent }) =>
        notifyEvent({ kind, sessionId, summary }),
      ).catch(() => {});
    }
    // retain per-session (bounded)
    const buf = this.retainedBySession.get(sessionId) ?? [];
    buf.push(envelope);
    if (buf.length > this.retainBound) this.retainedBySession.set(sessionId, buf.slice(-this.retainBound));
    else this.retainedBySession.set(sessionId, buf);
    for (const [ws, sub] of this.subscribers) {
      if (sub.session === sessionId && envelope.seq > sub.since && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(envelope));
      }
    }
    // SSE subscribers
    for (const [res, sub] of this.sseSubscribers) {
      if (sub.session === sessionId && envelope.seq > sub.since) {
        try { res.write(`data: ${JSON.stringify(envelope)}\n\n`); } catch { /* closed */ }
      }
    }
    return envelope;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Path to the repos registry file (~/.mya/repos.json). */
  private get reposPath(): string {
    return join(homedir(), ".mya", "repos.json");
  }

  /** List known repo directories from ~/.mya/repos.json. */
  private listRepos(): string[] {
    const repos = new Set<string>();
    try {
      const raw = readFileSync(this.reposPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (typeof r === "string" && r.trim()) repos.add(r.trim());
        }
      }
    } catch { /* file doesn't exist or invalid */ }
    return [...repos].sort();
  }

  /** Add a repo directory — validate exists, normalize to absolute, persist. */
  private addRepo(cwd: string): string {
    const normalized = pathResolve(cwd.trim());
    if (!existsSync(normalized) || !statSync(normalized).isDirectory()) {
      throw new Error(`cwd does not exist or is not a directory: ${normalized}`);
    }
    const repos = new Set(this.listRepos());
    repos.add(normalized);
    const dir = dirname(this.reposPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.reposPath, JSON.stringify([...repos].sort(), null, 2), "utf-8");
    return normalized;
  }

  /** §12 hook registry getter (Phase 2). The Agent wiring should pass this
   * SAME instance via AgentConfig.hooks so hook events emitted by the agent
   * run turn through the gateway's listeners. */
  get hookRegistry(): HookRegistry {
    return this.hooks;
  }

  /** §12.3 cron scheduler getter. Named `cronScheduler` (not `cron`) to avoid
   * clashing with the `cron` field. */
  get cronScheduler(): CronScheduler | undefined {
    return this.cron;
  }

  /** §12 sync server getter (stored only — no auto-start; Tier-2 follow-up). */
  get syncServer(): SyncServer | undefined {
    return this.sync;
  }

  /** §12 collaboration relay getter (stored only — no auto-start; Tier-2). */
  get collabRelay(): CollabRelay | undefined {
    return this.collab;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Phase 3 wiring: clear the cron sweep interval BEFORE terminating WS,
      // otherwise the timer keeps the event loop alive and http.close() hangs.
      if (this.cronTimer) {
        clearInterval(this.cronTimer);
        this.cronTimer = undefined;
      }
      // G2: terminate open WS clients first so http.close() doesn't hang.
      for (const ws of this.subscribers.keys()) {
        try {
          ws.terminate();
        } catch {
          /* best-effort */
        }
      }
      this.subscribers.clear();
      // SSE cleanup
      for (const res of this.sseSubscribers.keys()) {
        try { res.end(); } catch { /* best-effort */ }
      }
      this.sseSubscribers.clear();
      this.wss?.close();
      this.http?.close(() => resolve());
    });
  }
}
export * from "./hooks.js";
export * from "./mcp-lifecycle.js";
export * from "./mcp-client.js";
export * from "./channels.js";
export * from "./channel-adapters.js";
export * from "./channel-setup.js";
export * from "./channel-session.js";

/** Parse a channel webhook payload into a ChannelMessage. */
function parseChannelWebhook(channelId: string, body: string): ChannelMessage | null {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    // Telegram: { message: { chat: { id }, from: { first_name }, text } }
    if (channelId === "telegram" && data.message) {
      const msg = data.message as { chat?: { id?: number }; from?: { first_name?: string }; text?: string };
      return {
        channelId: "telegram",
        from: msg.from?.first_name ?? "unknown",
        text: msg.text ?? "",
        ts: nowWallclock(),
        replyTarget: String(msg.chat?.id ?? ""),
      };
    }
    // Discord: { content, author: { username }, channel_id }
    if (channelId === "discord" && data.content) {
      const d = data as { content?: string; author?: { username?: string }; channel_id?: string };
      return {
        channelId: "discord",
        from: d.author?.username ?? "unknown",
        text: d.content ?? "",
        ts: nowWallclock(),
        replyTarget: d.channel_id ?? "",
      };
    }
    // Slack: { event: { type: "message", text, user, channel } }
    if (channelId === "slack" && data.event) {
      const ev = data.event as { type?: string; text?: string; user?: string; channel?: string };
      if (ev.type !== "message") return null;
      return {
        channelId: "slack",
        from: ev.user ?? "unknown",
        text: ev.text ?? "",
        ts: nowWallclock(),
        replyTarget: ev.channel ?? "",
      };
    }
    // Generic webhook: { from, text, target }
    if (data.from && data.text) {
      return {
        channelId,
        from: String(data.from),
        text: String(data.text),
        ts: nowWallclock(),
        replyTarget: String(data.target ?? data.from),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Model metadata: known context window, max tokens, reasoning capability.
 * Values sourced from vendored/pi-ai/dist/models.generated.js. Covers all
 * providers in PROVIDER_REGISTRY with known values. */
const MODEL_METADATA: Record<string, { contextWindow?: number; maxTokens?: number; reasoning?: boolean }> = {
  anthropic:         { contextWindow: 200000,  maxTokens: 128000, reasoning: true  },
  google:            { contextWindow: 1048576, maxTokens: 8192,   reasoning: false },
  "google-vertex":   { contextWindow: 1048576, maxTokens: 8192,   reasoning: false },
  openai:            { contextWindow: 128000,  maxTokens: 16384,  reasoning: false },
  "openai-codex":    { contextWindow: 128000,  maxTokens: 16384,  reasoning: true  },
  "azure-openai-responses": { contextWindow: 128000, maxTokens: 16384, reasoning: false },
  deepseek:          { contextWindow: 64000,   maxTokens: 8192,   reasoning: false },
  groq:              { contextWindow: 131072,  maxTokens: 32768,  reasoning: false },
  mistral:           { contextWindow: 128000,  maxTokens: 8192,   reasoning: false },
  xai:               { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  together:          { contextWindow: 131072,  maxTokens: 131072, reasoning: false },
  fireworks:         { contextWindow: 131072,  maxTokens: 131072, reasoning: false },
  moonshotai:        { contextWindow: 131072,  maxTokens: 16384,  reasoning: false },
  openrouter:        { contextWindow: 200000,  maxTokens: 8192,   reasoning: false },
  minimax:           { contextWindow: 1000000, maxTokens: 128000, reasoning: true  },
  "minimax-cn":      { contextWindow: 24576,  maxTokens: 24576,  reasoning: false },
  cerebras:          { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  nvidia:            { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  huggingface:       { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  "github-copilot":  { contextWindow: 128000,  maxTokens: 16384,  reasoning: false },
  "cloudflare-workers-ai": { contextWindow: 131072, maxTokens: 8192, reasoning: false },
  "cloudflare-ai-gateway": { contextWindow: 128000, maxTokens: 16384, reasoning: false },
  zai:               { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  "zai-coding-cn":   { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  "ant-ling":        { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  xiaomi:            { contextWindow: 131072,  maxTokens: 8192,   reasoning: false },
  "vercel-ai-gateway": { contextWindow: 128000, maxTokens: 16384, reasoning: false },
  "kimi-coding":      { contextWindow: 131072, maxTokens: 8192,   reasoning: false },
  opencode:          { contextWindow: 128000,  maxTokens: 16384,  reasoning: false },
  "opencode-go":     { contextWindow: 128000,  maxTokens: 16384,  reasoning: false },
  "amazon-bedrock":  { contextWindow: 200000,  maxTokens: 8192,   reasoning: false },
};

/** Full provider registry: ALL 37 pi-ai providers with env var mapping. */
const PROVIDER_REGISTRY: Array<{ id: string; envKey: string; defaultModel: string }> = [
  { id: "minimax", envKey: "MINIMAX_API_KEY", defaultModel: "MiniMax-M3" },
  { id: "minimax-cn", envKey: "MINIMAX_CN_API_KEY", defaultModel: "abab6.5s-chat" },
  { id: "openai", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "openai-codex", envKey: "OPENAI_API_KEY", defaultModel: "codex-mini-latest" },
  { id: "anthropic", envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-20250514" },
  { id: "google", envKey: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash" },
  { id: "google-vertex", envKey: "GOOGLE_CLOUD_API_KEY", defaultModel: "gemini-2.0-flash" },
  { id: "amazon-bedrock", envKey: "AWS_ACCESS_KEY_ID", defaultModel: "anthropic.claude-3-sonnet" },
  { id: "azure-openai-responses", envKey: "AZURE_OPENAI_API_KEY", defaultModel: "gpt-4o" },
  { id: "deepseek", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat" },
  { id: "groq", envKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
  { id: "mistral", envKey: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest" },
  { id: "xai", envKey: "XAI_API_KEY", defaultModel: "grok-3" },
  { id: "together", envKey: "TOGETHER_API_KEY", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", envKey: "FIREWORKS_API_KEY", defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
  { id: "moonshotai", envKey: "MOONSHOT_API_KEY", defaultModel: "moonshot-v1-auto" },
  { id: "moonshotai-cn", envKey: "MOONSHOT_API_KEY", defaultModel: "moonshot-v1-auto" },
  { id: "openrouter", envKey: "OPENROUTER_API_KEY", defaultModel: "anthropic/claude-3.5-sonnet" },
  { id: "openrouter-images", envKey: "OPENROUTER_API_KEY", defaultModel: "openai/dall-e-3" },
  { id: "cerebras", envKey: "CEREBRAS_API_KEY", defaultModel: "llama3.1-70b" },
  { id: "github-copilot", envKey: "GITHUB_COPILOT_TOKEN", defaultModel: "gpt-4o" },
  { id: "huggingface", envKey: "HF_TOKEN", defaultModel: "meta-llama/Llama-3.1-70B-Instruct" },
  { id: "nvidia", envKey: "NVIDIA_API_KEY", defaultModel: "meta/llama-3.1-70b-instruct" },
  { id: "kimi-coding", envKey: "KIMI_API_KEY", defaultModel: "moonshot-v1-auto" },
  { id: "opencode", envKey: "OPENCODE_API_KEY", defaultModel: "gpt-4o" },
  { id: "opencode-go", envKey: "OPENCODE_API_KEY", defaultModel: "gpt-4o" },
  { id: "cloudflare-workers-ai", envKey: "CLOUDFLARE_API_KEY", defaultModel: "@cf/meta/llama-3.1-70b-instruct" },
  { id: "cloudflare-ai-gateway", envKey: "CLOUDFLARE_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "cloudflare-auth", envKey: "CLOUDFLARE_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "vercel-ai-gateway", envKey: "AI_GATEWAY_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "zai", envKey: "ZAI_API_KEY", defaultModel: "glm-4" },
  { id: "zai-coding-cn", envKey: "ZAI_CODING_CN_API_KEY", defaultModel: "glm-4" },
  { id: "xiaomi", envKey: "XIAOMI_API_KEY", defaultModel: "mimo-7b" },
  { id: "xiaomi-token-plan-cn", envKey: "XIAOMI_TOKEN_PLAN_CN_API_KEY", defaultModel: "mimo-7b" },
  { id: "xiaomi-token-plan-ams", envKey: "XIAOMI_TOKEN_PLAN_AMS_API_KEY", defaultModel: "mimo-7b" },
  { id: "xiaomi-token-plan-sgp", envKey: "XIAOMI_TOKEN_PLAN_SGP_API_KEY", defaultModel: "mimo-7b" },
  { id: "ant-ling", envKey: "ANT_LING_API_KEY", defaultModel: "ant-ling-1" },
];

/** Detect ALL providers from environment (shows configured + unconfigured). */
function detectProviderSummary(): Array<{ id: string; envKey: string; model: string; configured: boolean }> {
  return PROVIDER_REGISTRY.map((e) => ({
    id: e.id,
    envKey: e.envKey,
    model: process.env[`${e.envKey.replace(/_API_KEY$|_TOKEN$|_KEY$/, "_MODEL")}`] ?? e.defaultModel,
    configured: !!process.env[e.envKey],
  }));
}
