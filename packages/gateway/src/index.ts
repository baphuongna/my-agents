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
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname, resolve as pathResolve, sep as pathSep } from "node:path";
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
  /** Optional: trigger an immediate run of a cron job. */
  cronRunNow?: (jobId: string) => void | Promise<void>;
  /** Optional: remove a job from the underlying cron scheduler. */
  cronRemove?: (jobId: string) => boolean;
  cronAdd?: (job: ControlCronJob) => void;
  /** Optional: returns current queue depth for a session. */
  poolQueueDepth?: (sessionId: string) => number;
  /** Optional: returns WS connection info (token) for GET /ws-info. */
  wsInfo?: () => unknown;
}

/** A minimal HTTP + WS gateway. HTTP serves readiness probes + a control stub;
 * WS subscribes clients to the RuntimeEvent bus with replay-from-cursor. */
export class Gateway {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly subscribers = new Map<WebSocket, { session: string; since: number; room?: string }>(); // ws → subscribed session + cursor
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
  private readonly cronRunNow?: (jobId: string) => void | Promise<void>;
  private readonly cronRemove?: (jobId: string) => boolean;
  private readonly cronAdd?: (job: ControlCronJob) => void;
  private readonly poolQueueDepth?: (sessionId: string) => number;
  /** Optional WS info callback. */
  private readonly wsInfo?: () => unknown;
  /** One-shot delivery-channel warning flag. */
  private cronDeliveredWarned = false;
  /** Static file directory (optional — Phase 25.2 build pipeline). */
  private readonly staticDir?: string;
  /** MIME type map for common static file extensions. */
  private readonly mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
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
    this.cronRunNow = opts.cronRunNow;
    this.cronRemove = opts.cronRemove;
    this.cronAdd = opts.cronAdd;
    this.poolQueueDepth = opts.poolQueueDepth;
    this.wsInfo = opts.wsInfo;
    // Phase 3: if cron is configured but no delivery channel exists, log once.
    if (this.cron && !this.onWsMessage && !this.cronDeliveredWarned) {
      console.warn("[gateway] cron is configured but no onWsMessage channel exists; due jobs will be claimed + completed but not delivered.");
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
          // Phase 15 M2: check the local WS token (if configured) — blocks other local processes.
          if (this.wsToken) {
            const token = url.searchParams.get("token");
            if (token !== this.wsToken) {
              socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
              socket.destroy();
              return;
            }
          }
          // HIGH-1 fix: enforce the Origin allowlist (defends against cross-site
          // WebSocket hijacking — a visited website could otherwise read all events).
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
        this.cronTimer = setInterval(() => {
          try {
            const due = this.cron!.due();
            for (const job of due) {
              const run = this.cron!.claim(job.id, workerId);
              if (!run) continue;
              // Minimal delivery: forward to WS as a prompt event via the existing
              // onWsMessage channel (one-way fire-and-forget). A richer Protocol
              // lands Tier-2.
              if (this.onWsMessage) {
                this.onWsMessage("_cron", { kind: "cron-fire", jobId: job.id, runId: run.runId, prompt: job.prompt });
              }
              this.cron!.start(run.runId);
              this.cron!.complete(run.runId, "succeeded");
            }
            this.cron!.sweepExpired();
          } catch (e) {
            // cron loop must NEVER crash the gateway.
            console.warn("[gateway] cron sweep failed (non-fatal):", (e as Error).message);
          }
        }, this.cronIntervalMs);
        // Don't keep the process alive solely for the cron sweep.
        this.cronTimer.unref?.();
      }
      this.http.listen(this.port, this.host, () => {
        const addr = this.http!.address();
        const port = addr && typeof addr === "object" ? addr.port : this.port;
        resolve({ port, wsPath: `ws://${this.host}:${port}/events` });
      });
    });
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
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
          model: process.env["MYA_MODEL"] ?? "MiniMax-M3",
          uptime: Math.floor(process.uptime()),
          pid: process.pid,
          version: process.env["MYA_VERSION"] ?? "0.1.0",
          channels,
          providers,
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
      case "/":
      case "/index.html": {
        // Serve static files from dist/web/ if available
        if (this.staticDir) {
          const indexPath = join(this.staticDir, "index.html");
          if (existsSync(indexPath)) {
            try {
              const content = readFileSync(indexPath, "utf-8");
              res.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "x-frame-options": "DENY",
                "x-content-type-options": "nosniff",
                "content-security-policy": "frame-ancestors 'none'; default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:*",
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
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
            "content-security-policy": "frame-ancestors 'none'; default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:*",
          });
          res.end(this.rootHtml);
          return;
        }
        return send(404, { error: "no dashboard configured" });
      }
      // ── Channel webhooks: POST /channel/:id/webhook ───────────────────
      // Each channel adapter parses its own webhook payload format.
      default: {
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
          if (req.method === "GET") return send(200, this.control.listCronJobs());
          if (req.method === "POST") {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => {
              try {
                const job = JSON.parse(body || "{}") as { id?: string; name?: string; schedule?: string; prompt?: string; trigger?: string };
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
          const job = this.control.getCronJob(cronJobMatch[1]!);
          return job ? send(200, job) : send(404, { error: "not found" });
        }
        const cronPatchMatch = url.pathname.match(/^\/cron\/jobs\/([^/]+)\/patch$/);
        if (cronPatchMatch && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const patch = JSON.parse(body || "{}") as Record<string, unknown>;
              const updated = this.control.updateCronJob(cronPatchMatch[1]!, patch);
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
        // WS connection info (for launcher to get token)
        if (url.pathname === "/ws-info" && this.wsInfo) {
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
    this.subscribers.set(ws, { session, since, room });
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
        if (this.onWsMessage) {
          this.onWsMessage(session, msg);
        }
      } catch { /* malformed — ignore */ }
    });
  }

  /** Broadcast a RuntimeEvent to that session's WS subscribers only (HIGH-2). */
  broadcast(sessionId: string, event: unknown): WireEnvelope {
    const envelope = frame({ sessionId, seq: ++this.seq, event });
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
    return envelope;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
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

/** Full provider registry: ALL 37 pi-ai providers with env var mapping. */
const PROVIDER_REGISTRY: Array<{ id: string; envKey: string; defaultModel: string }> = [
  { id: "minimax", envKey: "MINIMAX_API_KEY", defaultModel: "MiniMax-M3" },
  { id: "minimax-cn", envKey: "MINIMAX_CN_API_KEY", defaultModel: "abab6.5s-chat" },
  { id: "openai", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "openai-codex", envKey: "OPENAI_API_KEY", defaultModel: "codex-mini-latest" },
  { id: "anthropic", envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-20250514" },
  { id: "google", envKey: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash" },
  { id: "google-vertex", envKey: "GOOGLE_CLOUD_API_KEY", defaultModel: "gemini-2.0-flash" },
  { id: "amazon-bedrock", envKey: "AWS_SECRET_ACCESS_KEY", defaultModel: "anthropic.claude-3-sonnet" },
  { id: "azure-openai-responses", envKey: "AZURE_OPENAI_API_KEY", defaultModel: "gpt-4o" },
  { id: "deepseek", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat" },
  { id: "groq", envKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
  { id: "mistral", envKey: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest" },
  { id: "xai", envKey: "XAI_API_KEY", defaultModel: "grok-3" },
  { id: "together", envKey: "TOGETHER_API_KEY", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", envKey: "FIREWORKS_API_KEY", defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
  { id: "moonshotai", envKey: "MOONSHOT_API_KEY", defaultModel: "moonshot-v1-auto" },
  { id: "moonshotai-cn", envKey: "MOONSHOT_CN_API_KEY", defaultModel: "moonshot-v1-auto" },
  { id: "openrouter", envKey: "OPENROUTER_API_KEY", defaultModel: "anthropic/claude-3.5-sonnet" },
  { id: "openrouter-images", envKey: "OPENROUTER_API_KEY", defaultModel: "openai/dall-e-3" },
  { id: "cerebras", envKey: "CEREBRAS_API_KEY", defaultModel: "llama3.1-70b" },
  { id: "github-copilot", envKey: "COPILOT_GITHUB_TOKEN", defaultModel: "gpt-4o" },
  { id: "huggingface", envKey: "HF_TOKEN", defaultModel: "meta-llama/Llama-3.1-70B-Instruct" },
  { id: "nvidia", envKey: "NVIDIA_API_KEY", defaultModel: "meta/llama-3.1-70b-instruct" },
  { id: "kimi-coding", envKey: "KIMI_API_KEY", defaultModel: "moonshot-v1-auto" },
  { id: "opencode", envKey: "OPENCODE_API_KEY", defaultModel: "gpt-4o" },
  { id: "opencode-go", envKey: "OPENCODE_API_KEY", defaultModel: "gpt-4o" },
  { id: "cloudflare-workers-ai", envKey: "CF_API_TOKEN", defaultModel: "@cf/meta/llama-3.1-70b-instruct" },
  { id: "cloudflare-ai-gateway", envKey: "CF_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "cloudflare-auth", envKey: "CF_API_TOKEN", defaultModel: "gpt-4o-mini" },
  { id: "vercel-ai-gateway", envKey: "AI_GATEWAY_API_KEY", defaultModel: "gpt-4o-mini" },
  { id: "zai", envKey: "ZAI_API_KEY", defaultModel: "glm-4" },
  { id: "zai-coding-cn", envKey: "ZAI_API_KEY", defaultModel: "glm-4" },
  { id: "xiaomi", envKey: "XIAOMI_API_KEY", defaultModel: "mimo-7b" },
  { id: "xiaomi-token-plan-cn", envKey: "XIAOMI_API_KEY", defaultModel: "mimo-7b" },
  { id: "xiaomi-token-plan-ams", envKey: "XIAOMI_API_KEY", defaultModel: "mimo-7b" },
  { id: "xiaomi-token-plan-sgp", envKey: "XIAOMI_API_KEY", defaultModel: "mimo-7b" },
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
