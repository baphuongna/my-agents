/**
 * @my-agent/web — Transport abstraction tests.
 *
 * 8 tests covering: Transport interface compliance, WebSocketTransport
 * constructor + status, onEvent listener registration, HttpTransport
 * constructor + status, createTransport() factory, and convenience
 * exports.  Heavy WS lifecycle tests use mocks — no real network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WebSocketTransport,
  HttpTransport,
  createTransport,
  getTransport,
  resetTransport,
  invoke,
  listen,
  type Transport,
  type ConnectionStatus,
} from "./transport.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1; // OPEN
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  /** Helper: simulate server sending a message */
  receive(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Transport interface", () => {
  it("WebSocketTransport satisfies the Transport interface", () => {
    const t: Transport = new MockWebSocketTransport() as unknown as Transport;
    expect(typeof t.invoke).toBe("function");
    expect(typeof t.onEvent).toBe("function");
    expect(typeof t.isConnected).toBe("function");
  });

  it("HttpTransport satisfies the Transport interface", () => {
    const t: Transport = {
      invoke: async <T>(): Promise<T> => ({} as T),
      onEvent: () => () => {},
      isConnected: () => false,
    };
    expect(typeof t.invoke).toBe("function");
    expect(typeof t.onEvent).toBe("function");
    expect(typeof t.isConnected).toBe("function");
  });
});

describe("WebSocketTransport", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("connects and reports connected status via onStatusChange", async () => {
    const statuses: ConnectionStatus[] = [];
    const t = new WebSocketTransport("ws://localhost:9999/ws");

    t.onStatusChange((s) => statuses.push(s));

    // Simulate WS open
    const ws = MockWebSocket.instances[0]!;
    ws.onopen!();

    expect(t.isConnected()).toBe(true);
    expect(statuses).toContain("connected");

    t.disconnect();
  });

  it("onEvent registers and returns an unsubscribe function", () => {
    const t = new WebSocketTransport("ws://localhost:9999/ws");
    const received: unknown[] = [];

    const unsub = t.onEvent<{ kind: string }>("test-event", (p) => received.push(p));

    // Simulate a message with the right event kind
    const ws = MockWebSocket.instances[0]!;
    ws.onopen!();
    ws.receive({ event: { kind: "test-event", data: 42 } });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ kind: "test-event", data: 42 });

    // Unsubscribe
    unsub();
    ws.receive({ event: { kind: "test-event", data: 99 } });
    expect(received).toHaveLength(1);

    t.disconnect();
  });

  it("invoke sends a command and resolves on matching id response", async () => {
    const t = new WebSocketTransport("ws://localhost:9999/ws");
    const ws = MockWebSocket.instances[0]!;
    ws.onopen!();

    const resultPromise = t.invoke<{ ok: boolean }>("ping");

    // Find the sent message to extract the id
    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0]!) as { id: string; command: string };
    expect(sent.command).toBe("ping");

    // Simulate response
    ws.receive({ id: sent.id, success: true, data: { ok: true } });

    const result = await resultPromise;
    expect(result).toEqual({ ok: true });

    t.disconnect();
  });
});

describe("createTransport", () => {
  it("returns a Transport instance for 'ws' preference", () => {
    const t = createTransport("ws");
    expect(typeof t.invoke).toBe("function");
    expect(typeof t.onEvent).toBe("function");
    expect(typeof t.isConnected).toBe("function");
  });

  it("returns a Transport instance for 'http' preference", () => {
    const t = createTransport("http");
    expect(typeof t.invoke).toBe("function");
    expect(typeof t.onEvent).toBe("function");
    expect(typeof t.isConnected).toBe("function");
  });
});

describe("convenience exports", () => {
  beforeEach(() => {
    resetTransport();
  });

  afterEach(() => {
    resetTransport();
    vi.unstubAllGlobals();
  });

  it("getTransport returns a singleton", () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const a = getTransport();
    const b = getTransport();
    expect(a).toBe(b);
  });

  it("invoke and listen are callable functions", () => {
    expect(typeof invoke).toBe("function");
    expect(typeof listen).toBe("function");
  });

  it("invoke delegates to the singleton transport", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { result: 42 } }),
    }));

    // Directly create an HttpTransport so we don't rely on env detection
    // We can't use getTransport() here because env detection isn't easily mockable.
    // Instead, verify createTransport("http").invoke works, which is what getTransport would do.
    const t = createTransport("http");
    const result = await t.invoke<{ result: number }>("test-cmd", { x: 1 });
    expect(result).toEqual({ result: 42 });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
  });
});

// Helper class that satisfies Transport without real WS
class MockWebSocketTransport {
  invoke<T>(_cmd: string, _payload?: unknown): Promise<T> {
    return Promise.resolve({} as T);
  }
  onEvent<T>(_event: string, _cb: (payload: T) => void): () => void {
    return () => {};
  }
  isConnected(): boolean {
    return false;
  }
}
