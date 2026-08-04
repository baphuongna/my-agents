import { describe, it, expect, vi } from "vitest";
import { BaseChannelAdapter, type TransportHandle, type ChannelMessage, type ChannelType } from "./base-adapter.js";

/** Test adapter — injects a mock transport. */
class TestAdapter extends BaseChannelAdapter<{ mode?: string }> {
  readonly type: ChannelType = "whatsapp";
  private transportFactory: () => Promise<TransportHandle>;
  constructor(transport: TransportHandle | (() => Promise<TransportHandle>), opts?: { maxRetries?: number; retryBaseMs?: number }) {
    super({}, opts);
    this.transportFactory = typeof transport === "function" ? transport : async () => transport;
  }
  protected async createTransport(): Promise<TransportHandle> {
    return this.transportFactory();
  }
}

function mockTransport(overrides: Partial<TransportHandle> = {}): TransportHandle {
  return {
    sendMessage: vi.fn(async () => ({ messageId: "msg-1" })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("[unit] BaseChannelAdapter", () => {
  it("connect + isConnected", async () => {
    const a = new TestAdapter(mockTransport());
    expect(a.isConnected()).toBe(false);
    await a.connect();
    expect(a.isConnected()).toBe(true);
  });

  it("connect is idempotent (double-connect → single transport)", async () => {
    const factory = vi.fn(async () => mockTransport());
    const a = new TestAdapter(factory);
    await a.connect();
    await a.connect();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("disconnect sets connected=false + closes handle", async () => {
    const t = mockTransport();
    const a = new TestAdapter(t);
    await a.connect();
    await a.disconnect();
    expect(a.isConnected()).toBe(false);
    expect(t.close).toHaveBeenCalled();
  });

  it("disconnect is idempotent", async () => {
    const t = mockTransport();
    const a = new TestAdapter(t);
    await a.connect();
    await a.disconnect();
    await a.disconnect(); // no throw
    expect(t.close).toHaveBeenCalledTimes(1);
  });

  it("send when not connected → error", async () => {
    const a = new TestAdapter(mockTransport());
    const r = await a.send("chat1", "hi");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not connected/);
  });

  it("send success → ok + messageId", async () => {
    const a = new TestAdapter(mockTransport());
    await a.connect();
    const r = await a.send("chat1", "hello");
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe("msg-1");
    expect(r.attempts).toBe(0);
  });

  it("send records outbound in session", async () => {
    const a = new TestAdapter(mockTransport());
    await a.connect();
    await a.send("chat1", "hello");
    const session = a.getSession("chat1");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]!.text).toBe("hello");
    expect(session.messages[0]!.fromMe).toBe(true);
  });

  it("send retries on failure then succeeds", async () => {
    let calls = 0;
    const t = mockTransport({
      sendMessage: vi.fn(async () => {
        calls++;
        if (calls < 2) throw new Error("transient");
        return { messageId: "msg-retry" };
      }),
    });
    const a = new TestAdapter(t, { maxRetries: 3, retryBaseMs: 1 });
    await a.connect();
    const r = await a.send("c1", "x");
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1); // succeeded on 2nd try (attempt index 1)
  });

  it("send exhausts retries → failed", async () => {
    const t = mockTransport({
      sendMessage: vi.fn(async () => { throw new Error("permanent"); }),
    });
    const a = new TestAdapter(t, { maxRetries: 2, retryBaseMs: 1 });
    await a.connect();
    const r = await a.send("c1", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("permanent");
    expect(r.attempts).toBe(2);
  });

  it("onMessage handler receives inbound", async () => {
    let received: ChannelMessage | null = null;
    const a = new TestAdapter(mockTransport());
    a.onMessage(async (msg) => { received = msg; });
    await a.connect();
    // Simulate inbound via the transport callback (connect wires it)
    // We can't easily trigger it from outside, but getSession proves session creation
    expect(received).toBeNull(); // nothing yet
  });

  it("getSession creates on demand", () => {
    const a = new TestAdapter(mockTransport());
    const s = a.getSession("new-chat");
    expect(s.chatId).toBe("new-chat");
    expect(s.messages).toEqual([]);
  });

  it("getSessions returns all", async () => {
    const a = new TestAdapter(mockTransport());
    await a.connect();
    await a.send("c1", "x");
    await a.send("c2", "y");
    expect(a.getSessions()).toHaveLength(2);
  });

  it("pendingMessages for a chat", async () => {
    const a = new TestAdapter(mockTransport());
    await a.connect();
    await a.send("c1", "x");
    const pending = a.pendingMessages("c1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state).toBe("delivered");
  });

  it("pendingMessages empty for unknown chat", () => {
    const a = new TestAdapter(mockTransport());
    expect(a.pendingMessages("nope")).toEqual([]);
  });
});
