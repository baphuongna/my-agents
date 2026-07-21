/**
 * WebSocket event client for the mya gateway.
 *
 * Connects to /events — the gateway authenticates via the HttpOnly
 * mya_ws cookie (automatically sent for same-origin WebSocket connections).
 * For cross-origin dev mode, the Vite proxy forwards the connection.
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

  get status(): string {
    return this._status;
  }

  /** Set the session to subscribe to. Use "*" for all sessions. Reconnects if changed. */
  setSession(session: string): void {
    if (this._session === session) return;
    this._session = session;
    this.disconnect();
    this.connect();
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Include session param if set ("*" for all sessions, specific ID for chat)
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
      this.setStatus("connected");
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as GatewayEvent;
        for (const fn of this.listeners) {
          try {
            fn(data);
          } catch {
            // ignore listener errors
          }
        }
      } catch {
        // ignore non-JSON
      }
    };

    this.ws.onclose = () => {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.setStatus("error");
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  onEvent(fn: EventHandler): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (status: string) => void): () => void {
    this.statusListeners.add(fn);
    fn(this._status);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: string): void {
    this._status = s;
    for (const fn of this.statusListeners) {
      try {
        fn(s);
      } catch {
        // ignore
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}

export const eventClient = new EventClient();
