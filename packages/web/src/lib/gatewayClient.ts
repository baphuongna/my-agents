/**
 * mya WebSocket client — event streaming over /events.
 *
 * mya's gateway uses simple WebSocket event streaming (not JSON-RPC).
 * The gateway authenticates via the HttpOnly mya_ws cookie (same-origin).
 * Events are wrapped in envelopes: { sessionId, seq, event: { type, ... } }
 *
 * Replaces Hermes' JSON-RPC GatewayClient with a simpler event subscriber.
 */

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

export interface GatewayEvent {
  type: string;
  sessionId?: string;
  [key: string]: unknown;
}

type EventHandler = (ev: GatewayEvent) => void;
type StateHandler = (state: ConnectionState) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private eventListeners = new Map<string, Set<EventHandler>>();
  private stateListeners = new Set<StateHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: ConnectionState = "idle";

  get connectionState(): ConnectionState {
    return this._state;
  }

  async connect(session = "*"): Promise<void> {
    if (this._state === "open" || this._state === "connecting") return;

    this.setState("connecting");

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/events?session=${encodeURIComponent(session)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.setState("error");
      this.scheduleReconnect(session);
      return;
    }

    this.ws.onopen = () => this.setState("open");

    this.ws.onmessage = (ev) => {
      try {
        const envelope = JSON.parse(ev.data as string);
        // Unwrap gateway envelope: { sessionId, seq, event: { type, ... } }
        const inner = envelope.event ?? envelope;
        const eventType = inner.type ?? inner.kind ?? "unknown";
        const handlers = this.eventListeners.get(eventType);
        if (handlers) {
          for (const fn of handlers) {
            try { fn(inner); } catch { /* ignore */ }
          }
        }
        // Also notify wildcard listeners
        const wildcardHandlers = this.eventListeners.get("*");
        if (wildcardHandlers) {
          for (const fn of wildcardHandlers) {
            try { fn(inner); } catch { /* ignore */ }
          }
        }
      } catch { /* non-JSON */ }
    };

    this.ws.onclose = () => {
      this.setState("closed");
      this.scheduleReconnect(session);
    };

    this.ws.onerror = () => this.setState("error");
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.setState("idle");
  }

  on(eventName: string, handler: EventHandler): () => void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(handler);
    return () => this.eventListeners.get(eventName)?.delete(handler);
  }

  onState(handler: StateHandler): () => void {
    this.stateListeners.add(handler);
    handler(this._state);
    return () => this.stateListeners.delete(handler);
  }

  private setState(s: ConnectionState): void {
    this._state = s;
    for (const fn of this.stateListeners) {
      try { fn(s); } catch { /* ignore */ }
    }
  }

  private scheduleReconnect(session: string): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(session);
    }, 3000);
  }
}

// Re-export for compatibility with Hermes imports
export type GatewayEventName = string;
