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
import { WebSocketServer, type WebSocket } from "ws";

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
  return { version: 1, sessionId: opts.sessionId, runId: opts.runId, laneId: opts.laneId, seq: opts.seq, event: opts.event, ts: opts.ts ?? Date.now() };
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
}

/** A minimal HTTP + WS gateway. HTTP serves readiness probes + a control stub;
 * WS subscribes clients to the RuntimeEvent bus with replay-from-cursor. */
export class Gateway {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly subscribers = new Map<WebSocket, number>(); // ws → last delivered seq
  private seq = 0;
  /** Bounded retained-event buffer for replay-from-cursor (§25.6). */
  private retained: WireEnvelope[] = [];
  private readonly retainBound = 10_000;
  readonly readiness: ReadinessRegistry;
  readonly host: string;
  readonly port: number;

  constructor(opts: GatewayOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 0;
    this.readiness = opts.readiness ?? new ReadinessRegistry();
    this.rootHtml = opts.rootHtml;
  }

  private rootHtml?: string;

  /** Start listening. Resolves with the bound port (0 = ephemeral). */
  start(): Promise<{ port: number; wsPath: string }> {
    return new Promise((resolve, reject) => {
      this.http = createServer((req, res) => this.handleHttp(req, res));
      this.wss = new WebSocketServer({ noServer: true });
      this.http.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", `http://${this.host}`);
        if (url.pathname === "/events") {
          this.wss!.handleUpgrade(req, socket, head, (ws) => this.handleWs(ws, url));
        } else {
          socket.destroy();
        }
      });
      this.http.on("error", reject);
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
    switch (url.pathname) {
      case "/health/live": {
        const p = this.readiness.liveness();
        return send(p.ok ? 200 : 503, p);
      }
      case "/ready": {
        const p = this.readiness.readiness();
        return send(p.ok ? 200 : 503, p, p.ok ? {} : { "retry-after": String(p.retryAfterS ?? 2) });
      }
      case "/functional": {
        const p = this.readiness.functional(this.healthyTurns);
        return send(p.ok ? 200 : 503, p);
      }
      case "/":
      case "/index.html": {
        if (this.rootHtml) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(this.rootHtml);
          return;
        }
        return send(404, { error: "no dashboard configured" });
      }
      default:
        return send(404, { error: "not found" });
    }
  }

  private healthyTurns = 0;

  /** Record a healthy turn (for the /functional probe). */
  recordHealthyTurn(): void {
    this.healthyTurns++;
  }

  private handleWs(ws: WebSocket, url: URL): void {
    const since = parseInt(url.searchParams.get("since") ?? "0", 10);
    this.subscribers.set(ws, since);
    // §25.6 replay-from-cursor: deliver retained events with seq > since.
    // ws.send() buffers until the socket opens, so this is safe at upgrade time.
    for (const env of this.retained) {
      if (env.seq > since) ws.send(JSON.stringify(env));
    }
    ws.on("close", () => this.subscribers.delete(ws));
    ws.on("message", () => {
      /* control messages (subscribe/cancel) — Tier-2+ */
    });
  }

  /** Broadcast a RuntimeEvent to all WS subscribers (replay-from-cursor). */
  broadcast(sessionId: string, event: unknown): WireEnvelope {
    const envelope = frame({ sessionId, seq: ++this.seq, event });
    // retain for late-subscriber replay (bounded)
    this.retained.push(envelope);
    if (this.retained.length > this.retainBound) {
      this.retained = this.retained.slice(-this.retainBound);
    }
    for (const [ws, since] of this.subscribers) {
      if (envelope.seq > since && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(envelope));
      }
    }
    return envelope;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
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
