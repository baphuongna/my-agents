/**
 * @my-agent/web — polymorphic Transport abstraction.
 *
 * Ported from pi-session-manager: provides `WebSocketTransport` (id-correlated
 * req/res, 30 s timeout, reconnect with backoff, heartbeat ping) and
 * `HttpTransport` (POST for commands, WS for events — mobile fallback).
 * `createTransport()` auto-selects based on environment / query params.
 *
 * This is a pure library module — dashboard.ts integration is a follow-up.
 *
 * Source: §25.6 UI↔Runtime event contract; pi-session-manager transport.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionStatus = "connected" | "connecting" | "disconnected";
export type StatusListener = (status: ConnectionStatus) => void;

export interface Transport {
  invoke<T>(cmd: string, payload?: unknown): Promise<T>;
  onEvent<T>(event: string, cb: (payload: T) => void): () => void;
  isConnected(): boolean;
  onStatusChange?(listener: StatusListener): () => void;
  disconnect?(): void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readConfig(): { wsUrl: string; httpBaseUrl: string; token?: string } {
  const host = typeof location !== "undefined" ? location.hostname : "localhost";
  const proto = typeof location !== "undefined" ? location.protocol : "http:";
  const port = typeof location !== "undefined" ? location.port : "";
  const isSecure = proto === "https:";
  const origin = port ? `${host}:${port}` : host;
  const defaultHttp = `${proto}//${origin}`;
  const defaultWs = `${isSecure ? "wss" : "ws"}://${origin}/ws`;

  if (typeof window === "undefined") {
    return {
      wsUrl: (import.meta as { env?: Record<string, string> }).env?.VITE_WS_URL ?? defaultWs,
      httpBaseUrl: (import.meta as { env?: Record<string, string> }).env?.VITE_HTTP_BASE_URL ?? defaultHttp,
      token: (import.meta as { env?: Record<string, string> }).env?.VITE_API_TOKEN,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const qServer = params.get("server");
  const qWs = params.get("ws");
  const qHttp = params.get("http");
  const qToken = params.get("token");

  const wsUrl = qWs ?? (qServer ? toWsUrl(normalizeHttpBase(qServer)) : defaultWs);
  const httpBaseUrl = qHttp ?? (qServer ? normalizeHttpBase(qServer) : defaultHttp);
  const token = qToken ?? (import.meta as { env?: Record<string, string> }).env?.VITE_API_TOKEN;

  return { wsUrl, httpBaseUrl, token: token ?? undefined };
}

function normalizeHttpBase(url: string): string {
  let out = url.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(out)) out = `http://${out}`;
  if (out.endsWith("/api")) out = out.slice(0, -4);
  return out;
}

function toWsUrl(input: string): string {
  const trimmed = input.trim();
  if (/^wss?:\/\//iu.test(trimmed)) return trimmed;
  const normalized = normalizeHttpBase(trimmed);
  const wsBase = normalized.startsWith("https://")
    ? `wss://${normalized.slice(8)}`
    : normalized.startsWith("http://")
      ? `ws://${normalized.slice(7)}`
      : `ws://${normalized}`;
  return wsBase.endsWith("/ws") ? wsBase : `${wsBase}/ws`;
}

function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/iu.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
  );
}

// ─── WebSocketTransport ──────────────────────────────────────────────────────

const enum WsState {
  Disconnected,
  Connecting,
  Connected,
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private state: WsState = WsState.Disconnected;
  private messageId = 0;
  private retryCount = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly url: string;
  private readonly token?: string;
  private disposed = false;
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private statusListeners = new Set<StatusListener>();

  constructor(url?: string, token?: string) {
    const cfg = readConfig();
    this.url = url ?? cfg.wsUrl;
    this.token = token ?? cfg.token;
    this.emitStatus("connecting");
    this.connect();
  }

  // ── Status ──

  private emitStatus(status: ConnectionStatus): void {
    for (const fn of this.statusListeners) fn(status);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.state === WsState.Connected ? "connected" : this.state === WsState.Connecting ? "connecting" : "disconnected");
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // ── Connection lifecycle ──

  private connect(): void {
    if (this.disposed || this.state === WsState.Connecting) return;
    this.state = WsState.Connecting;
    this.emitStatus("connecting");
    this.cleanupSocket();

    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        if (ws !== this.ws) return;
        this.state = WsState.Connected;
        this.retryCount = 0;
        this.startPing();
        if (this.token) ws.send(JSON.stringify({ auth: this.token }));
        for (const w of this.connectWaiters) w.resolve();
        this.connectWaiters = [];
        this.emitStatus("connected");
      };

      ws.onmessage = (event) => {
        if (ws !== this.ws) return;
        try {
          const data: Record<string, unknown> = JSON.parse(event.data as string) as Record<string, unknown>;
          if (data.pong) return;
          this.handleMessage(data);
        } catch {
          // ignore parse errors on pong or malformed
        }
      };

      ws.onclose = () => {
        if (ws !== this.ws) return;
        this.handleDisconnect();
      };

      ws.onerror = () => {
        /* onclose fires after onerror */
      };
    } catch {
      this.state = WsState.Disconnected;
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(): void {
    this.state = WsState.Disconnected;
    this.stopPing();
    this.rejectAllPending("WebSocket disconnected");
    for (const w of this.connectWaiters) w.reject(new Error("WebSocket disconnected"));
    this.connectWaiters = [];
    this.emitStatus("disconnected");
    if (!this.disposed) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.retryCount), 10_000);
    this.retryCount++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Heartbeat ──

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('{"ping":true}');
      }
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ── Socket cleanup ──

  private cleanupSocket(): void {
    if (this.ws) {
      const old = this.ws;
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) {
        old.close();
      }
      this.ws = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  // ── Message dispatch ──

  private handleMessage(data: Record<string, unknown>): void {
    const id = data.id as string | undefined;
    if (id && this.pendingRequests.has(id)) {
      const request = this.pendingRequests.get(id)!;
      clearTimeout(request.timer);
      this.pendingRequests.delete(id);
      if (data.success) {
        request.resolve(data.data);
      } else {
        request.reject(new Error((data.error as string) ?? "Command failed"));
      }
      return;
    }

    // §25.6 wire envelope: dispatch event by event field inside the envelope's event object
    const envEvent = data.event as Record<string, unknown> | undefined;
    const eventKind = envEvent?.kind as string | undefined;
    if (eventKind) {
      const listeners = this.eventListeners.get(eventKind);
      if (listeners) {
        for (const cb of listeners) cb(envEvent);
      }
    }
  }

  // ── Public API ──

  private waitForConnection(timeoutMs = 10_000): Promise<void> {
    if (this.state === WsState.Connected) return Promise.resolve();
    if (this.disposed) return Promise.reject(new Error("Transport disposed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.connectWaiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.connectWaiters.splice(idx, 1);
        reject(new Error("WebSocket connection timeout"));
      }, timeoutMs);
      this.connectWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  async invoke<T>(cmd: string, payload?: unknown): Promise<T> {
    if (this.state !== WsState.Connected) await this.waitForConnection();

    const id = `ws-${++this.messageId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command ${cmd} timeout`));
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      if (this.disposed || !this.ws || this.ws.readyState !== 1) throw new Error("WS not connected"); this.ws.send(JSON.stringify({ id, command: cmd, payload: payload ?? {} }));
    });
  }

  onEvent<T>(event: string, cb: (payload: T) => void): () => void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    const wrapped = (payload: unknown) => cb(payload as T);
    this.eventListeners.get(event)!.add(wrapped);
    return () => {
      this.eventListeners.get(event)?.delete(wrapped);
    };
  }

  isConnected(): boolean {
    return this.state === WsState.Connected;
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.rejectAllPending("Transport disposed");
    for (const w of this.connectWaiters) w.reject(new Error("Transport disposed"));
    this.connectWaiters = [];
    this.cleanupSocket();
  }
}

// ─── HttpTransport ───────────────────────────────────────────────────────────

export class HttpTransport implements Transport {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly authToken: string | undefined;
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private eventWs: WebSocket | null = null;
  private wsConnected = false;
  private statusListeners = new Set<StatusListener>();
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(baseUrl?: string, wsUrl?: string, authToken?: string) {
    const cfg = readConfig();
    this.baseUrl = (baseUrl ?? cfg.httpBaseUrl).replace(/\/+$/u, "");
    this.wsUrl = wsUrl ?? cfg.wsUrl;
    this.authToken = authToken ?? cfg.token;
    this.connectEventWs();
  }

  // ── Status ──

  private emitStatus(status: ConnectionStatus): void {
    for (const fn of this.statusListeners) fn(status);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.wsConnected ? "connected" : "connecting");
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  // ── Event WebSocket ──

  private connectEventWs(): void {
    if (this.disposed || this.eventWs) return;
    this.emitStatus("connecting");

    try {
      const ws = new WebSocket(this.wsUrl);
      this.eventWs = ws;

      ws.onopen = () => {
        if (ws !== this.eventWs) return;
        if (this.authToken) {
          ws.send(JSON.stringify({ auth: this.authToken }));
        } else {
          this.onWsReady();
        }
      };

      ws.onmessage = (event) => {
        if (ws !== this.eventWs) return;
        try {
          const data: Record<string, unknown> = JSON.parse(event.data as string) as Record<string, unknown>;
          if (!this.wsConnected) {
            if (data.auth === "ok") {
              this.onWsReady();
            } else if (data.error) {
              this.cleanupWs();
              this.scheduleReconnect();
            }
            return;
          }
          const envEvent = data.event as Record<string, unknown> | undefined;
          const eventKind = envEvent?.kind as string | undefined;
          if (eventKind) {
            const listeners = this.eventListeners.get(eventKind);
            if (listeners) for (const cb of listeners) cb(envEvent);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (ws !== this.eventWs) return;
        this.wsConnected = false;
        this.eventWs = null;
        this.emitStatus("disconnected");
        if (!this.disposed) this.scheduleReconnect();
      };

      ws.onerror = () => {
        /* onclose fires after onerror */
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private onWsReady(): void {
    this.wsConnected = true;
    this.retryCount = 0;
    this.emitStatus("connected");
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10_000);
    this.retryCount++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectEventWs();
    }, delay);
  }

  private cleanupWs(): void {
    if (this.eventWs) {
      const old = this.eventWs;
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) {
        old.close();
      }
      this.eventWs = null;
    }
    this.wsConnected = false;
  }

  // ── Public API ──

  async invoke<T>(cmd: string, payload?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;

    const resp = await fetch(`${this.baseUrl}/api`, {
      method: "POST",
      headers,
      body: JSON.stringify({ command: cmd, payload: payload ?? {} }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const body = (await resp.json()) as { success: boolean; data?: T; error?: string };
    if (!body.success) throw new Error(body.error ?? "Command failed");
    return body.data as T;
  }

  onEvent<T>(event: string, cb: (payload: T) => void): () => void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    const wrapped = (p: unknown) => cb(p as T);
    this.eventListeners.get(event)!.add(wrapped);
    return () => {
      this.eventListeners.get(event)?.delete(wrapped);
    };
  }

  isConnected(): boolean {
    return this.wsConnected;
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupWs();
    this.eventListeners.clear();
  }
}

// ─── Factory & singleton ─────────────────────────────────────────────────────

export type TransportPreference = "auto" | "ws" | "http";

export function createTransport(preference: TransportPreference = "auto"): Transport {
  if (preference === "http" || (preference === "auto" && detectMobile())) {
    return new HttpTransport();
  }
  return new WebSocketTransport();
}

let _transport: Transport | null = null;

export function getTransport(): Transport {
  if (!_transport) {
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const pref = (params?.get("transport") as TransportPreference | null)
      ?? ((import.meta as { env?: Record<string, string> }).env?.VITE_TRANSPORT as TransportPreference | undefined)
      ?? "auto";
    _transport = createTransport(pref);
  }
  return _transport;
}

export function resetTransport(): void {
  if (_transport && typeof _transport.disconnect === "function") _transport.disconnect();
  _transport = null;
}

// ─── Convenience exports ─────────────────────────────────────────────────────

export async function invoke<T>(cmd: string, payload?: unknown): Promise<T> {
  return getTransport().invoke<T>(cmd, payload);
}

export function listen<T>(event: string, cb: (payload: T) => void): () => void {
  return getTransport().onEvent<T>(event, cb);
}
