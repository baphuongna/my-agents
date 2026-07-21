/**
 * WebSocket event client for the mya gateway.
 * Connects to /events — cookie-based auth for same-origin.
 * Exponential backoff reconnect. Intentional close guard.
 */

export interface GatewayEvent {
  type: string;
  sessionId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

type EventHandler = (ev: GatewayEvent) => void;

export class EventClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<EventHandler>();
  private statusListeners = new Set<(status: string) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _status = "disconnected";
  private _session: string | null = null;
  private intentionalClose = false;
  private reconnectAttempts = 0;

  get status(): string { return this._status; }

  setSession(session: string): void {
    if (this._session === session) return;
    this._session = session;
    this.disconnect();
    this.connect();
  }

  connect(): void {
    if (this.intentionalClose) this.intentionalClose = false;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const sessionParam = this._session ? `?session=${encodeURIComponent(this._session)}` : "";
    const url = `${proto}//${location.host}/events${sessionParam}`;

    this.setStatus("connecting");
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as GatewayEvent;
        for (const fn of this.listeners) { try { fn(data); } catch { /* ignore */ } }
      } catch { /* non-JSON */ }
    };

    this.ws.onclose = () => {
      this.setStatus("disconnected");
      if (this.intentionalClose) { this.intentionalClose = false; return; }
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.setStatus("error");
      // Force close to trigger onclose → reconnect
      try { this.ws?.close(); } catch { /* already closed */ }
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  onEvent(fn: EventHandler): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  onStatus(fn: (status: string) => void): () => void {
    this.statusListeners.add(fn);
    fn(this._status);
    return () => { this.statusListeners.delete(fn); };
  }

  private setStatus(s: string): void {
    this._status = s;
    for (const fn of this.statusListeners) { try { fn(s); } catch { /* ignore */ } }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export const eventClient = new EventClient();
