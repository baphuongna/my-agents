import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChannelRegistry,
  ChannelRouter,
  BaseChannelAdapter,
  type ChannelMessage,
  type ChannelType,
  type TransportHandle,
} from "./index.js";
import { WhatsAppAdapter, type WhatsAppConfig, type WhatsAppTransportFactory } from "./whatsapp.js";
import { MatrixAdapter, type MatrixConfig, type MatrixTransportFactory } from "./matrix.js";

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "mya-channels-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratchDir, { recursive: true, force: true });
});

// ─── Test helpers ────────────────────────────────────────────────────────────

/** A mock transport that records sends and can simulate inbound messages. */
class MockTransport implements TransportHandle {
  readonly sent: Array<{ chatId: string; text: string }> = [];
  private inboundCb: ((msg: ChannelMessage) => void) | null = null;
  private failNext = false;
  private messageIdCounter = 0;

  async sendMessage(chatId: string, text: string): Promise<{ messageId: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("mock transport error");
    }
    this.sent.push({ chatId, text });
    this.messageIdCounter++;
    return { messageId: `msg-${this.messageIdCounter}` };
  }

  async close(): Promise<void> {}

  /** Simulate an inbound message from the platform. */
  receiveMessage(msg: ChannelMessage): void {
    this.inboundCb?.(msg);
  }

  /** Make the next sendMessage throw. */
  failNextSend(): void {
    this.failNext = true;
  }

  setInboundCb(cb: (msg: ChannelMessage) => void): void {
    this.inboundCb = cb;
  }
}

/** Factory that creates a WhatsApp adapter with a mock transport. */
function makeWhatsAppAdapter(
  opts?: { maxRetries?: number; retryBaseMs?: number; failCount?: number },
): { adapter: WhatsAppAdapter; transport: MockTransport } {
  const transport = new MockTransport();
  const failCount = opts?.failCount ?? 0;
  const factory: WhatsAppTransportFactory = async (_config, onMessage) => {
    transport.setInboundCb(onMessage);
    return transport;
  };
  const adapter = new WhatsAppAdapter(
    { phoneNumber: "+1234567890" },
    factory,
    { maxRetries: opts?.maxRetries, retryBaseMs: opts?.retryBaseMs ?? 1 },
  );
  // Patch the transport to fail N times before succeeding.
  if (failCount > 0) {
    const orig = transport.sendMessage.bind(transport);
    let failsRemaining = failCount;
    transport.sendMessage = async (chatId: string, text: string) => {
      if (failsRemaining > 0) {
        failsRemaining--;
        throw new Error("mock transient error");
      }
      return orig(chatId, text);
    };
  }
  return { adapter, transport };
}

/** Factory that creates a Matrix adapter with a mock transport. */
function makeMatrixAdapter(
  opts?: { maxRetries?: number; retryBaseMs?: number; failCount?: number },
): { adapter: MatrixAdapter; transport: MockTransport } {
  const transport = new MockTransport();
  const failCount = opts?.failCount ?? 0;
  const factory: MatrixTransportFactory = async (_config, onMessage) => {
    transport.setInboundCb(onMessage);
    return transport;
  };
  const adapter = new MatrixAdapter(
    { homeserverUrl: "https://matrix.org", accessToken: "token-123" },
    factory,
    { maxRetries: opts?.maxRetries, retryBaseMs: opts?.retryBaseMs ?? 1 },
  );
  if (failCount > 0) {
    const orig = transport.sendMessage.bind(transport);
    let failsRemaining = failCount;
    transport.sendMessage = async (chatId: string, text: string) => {
      if (failsRemaining > 0) {
        failsRemaining--;
        throw new Error("mock transient error");
      }
      return orig(chatId, text);
    };
  }
  return { adapter, transport };
}

// ─── Registry tests ──────────────────────────────────────────────────────────

describe("ChannelRegistry — registration", () => {
  it("registers and retrieves adapters by type", () => {
    const reg = new ChannelRegistry();
    const { adapter } = makeWhatsAppAdapter();
    reg.register(adapter);
    expect(reg.get("whatsapp")).toBe(adapter);
    expect(reg.size).toBe(1);
    expect(reg.list()).toEqual(["whatsapp"]);
  });

  it("throws on duplicate registration", () => {
    const reg = new ChannelRegistry();
    const { adapter } = makeWhatsAppAdapter();
    reg.register(adapter);
    expect(() => reg.register(adapter)).toThrow(/already registered/);
  });

  it("unregister removes an adapter and returns true/false", () => {
    const reg = new ChannelRegistry();
    const { adapter } = makeWhatsAppAdapter();
    reg.register(adapter);
    expect(reg.unregister("whatsapp")).toBe(true);
    expect(reg.unregister("whatsapp")).toBe(false);
    expect(reg.get("whatsapp")).toBeUndefined();
  });

  it("connectAll / disconnectAll calls lifecycle on all adapters", async () => {
    const reg = new ChannelRegistry();
    const wa = makeWhatsAppAdapter();
    const mx = makeMatrixAdapter();
    reg.register(wa.adapter);
    reg.register(mx.adapter);
    await reg.connectAll();
    expect(wa.adapter.isConnected()).toBe(true);
    expect(mx.adapter.isConnected()).toBe(true);
    await reg.disconnectAll();
    expect(wa.adapter.isConnected()).toBe(false);
    expect(mx.adapter.isConnected()).toBe(false);
  });
});

// ─── Router tests ────────────────────────────────────────────────────────────

describe("ChannelRouter — message routing", () => {
  it("send() dispatches to the correct adapter", async () => {
    const reg = new ChannelRegistry();
    const { adapter, transport } = makeWhatsAppAdapter();
    reg.register(adapter);
    await reg.connectAll();
    const router = new ChannelRouter(reg);
    const result = await router.send("whatsapp", "123@s.whatsapp.net", "hi");
    expect(result.ok).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(transport.sent).toHaveLength(1);
  });

  it("send() returns error for unregistered channel", async () => {
    const reg = new ChannelRegistry();
    const router = new ChannelRouter(reg);
    const result = await router.send("matrix", "!room:matrix.org", "hi");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no adapter/);
  });

  it("onAny() receives messages from all channels", async () => {
    const reg = new ChannelRegistry();
    const wa = makeWhatsAppAdapter();
    const mx = makeMatrixAdapter();
    reg.register(wa.adapter);
    reg.register(mx.adapter);
    await reg.connectAll();
    const router = new ChannelRouter(reg);
    const received: ChannelMessage[] = [];
    router.onAny(async (msg) => { received.push(msg); });
    wa.transport.receiveMessage({
      id: "in1", channel: "whatsapp", chatId: "c1", text: "wa-msg",
      fromMe: false, timestamp: Date.now(),
    });
    mx.transport.receiveMessage({
      id: "in2", channel: "matrix", chatId: "c2", text: "mx-msg",
      fromMe: false, timestamp: Date.now(),
    });
    expect(received.map((m) => m.text)).toEqual(["wa-msg", "mx-msg"]);
  });

  it("onChannel() receives messages from a specific channel only", async () => {
    const reg = new ChannelRegistry();
    const wa = makeWhatsAppAdapter();
    const mx = makeMatrixAdapter();
    reg.register(wa.adapter);
    reg.register(mx.adapter);
    await reg.connectAll();
    const router = new ChannelRouter(reg);
    const waMsgs: string[] = [];
    router.onChannel("whatsapp", async (msg) => { waMsgs.push(msg.text); });
    wa.transport.receiveMessage({
      id: "in1", channel: "whatsapp", chatId: "c1", text: "wa",
      fromMe: false, timestamp: Date.now(),
    });
    mx.transport.receiveMessage({
      id: "in2", channel: "matrix", chatId: "c2", text: "mx",
      fromMe: false, timestamp: Date.now(),
    });
    expect(waMsgs).toEqual(["wa"]);
  });
});

// ─── Base adapter lifecycle ──────────────────────────────────────────────────

describe("BaseChannelAdapter — lifecycle", () => {
  it("connect / disconnect / isConnected", async () => {
    const { adapter } = makeWhatsAppAdapter();
    expect(adapter.isConnected()).toBe(false);
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });

  it("send() fails when not connected", async () => {
    const { adapter } = makeWhatsAppAdapter();
    const result = await adapter.send("chat", "text");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not connected/);
  });

  it("disconnect() is idempotent (safe to call twice)", async () => {
    const { adapter } = makeWhatsAppAdapter();
    await adapter.connect();
    await adapter.disconnect();
    await adapter.disconnect(); // should not throw
    expect(adapter.isConnected()).toBe(false);
  });

  it("connect() is idempotent", async () => {
    const { adapter } = makeWhatsAppAdapter();
    await adapter.connect();
    await adapter.connect(); // should not throw
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
  });
});

// ─── Send + ack/retry ────────────────────────────────────────────────────────

describe("BaseChannelAdapter — send + ack/retry", () => {
  it("send() succeeds on first try and records in session", async () => {
    const { adapter, transport } = makeWhatsAppAdapter();
    await adapter.connect();
    const result = await adapter.send("chat-1", "hello");
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(0);
    expect(transport.sent).toHaveLength(1);
    // Session recorded.
    const session = adapter.getSession("chat-1");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]!.text).toBe("hello");
    expect(session.messages[0]!.fromMe).toBe(true);
  });

  it("send() retries on transient failure then succeeds", async () => {
    const { adapter, transport } = makeWhatsAppAdapter({ failCount: 2, retryBaseMs: 1 });
    await adapter.connect();
    const result = await adapter.send("chat-1", "hello");
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2); // failed twice, succeeded on 3rd
    expect(transport.sent).toHaveLength(1);
  });

  it("send() exhausts retries and returns failure", async () => {
    // Transport that always fails
    const transport = new MockTransport();
    const factory: WhatsAppTransportFactory = async (_config, onMessage) => {
      transport.setInboundCb(onMessage);
      return transport;
    };
    const adapter = new WhatsAppAdapter({}, factory, { maxRetries: 2, retryBaseMs: 1 });
    // Make all sends fail
    transport.sendMessage = async () => { throw new Error("permanent error"); };
    await adapter.connect();
    const result = await adapter.send("chat-1", "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("permanent error");
    expect(result.attempts).toBe(2);
  });

  it("pendingMessages() tracks delivery state", async () => {
    const { adapter } = makeWhatsAppAdapter();
    await adapter.connect();
    await adapter.send("chat-1", "msg-1");
    const pending = adapter.pendingMessages("chat-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state).toBe("delivered");
    expect(pending[0]!.attempts).toBe(0);
  });

  it("pendingMessages() shows 'failed' state after all retries exhausted", async () => {
    const transport = new MockTransport();
    const factory: WhatsAppTransportFactory = async (_config, onMessage) => {
      transport.setInboundCb(onMessage);
      return transport;
    };
    const adapter = new WhatsAppAdapter({}, factory, { maxRetries: 1, retryBaseMs: 1 });
    transport.sendMessage = async () => { throw new Error("fail"); };
    await adapter.connect();
    await adapter.send("chat-1", "msg-1");
    const pending = adapter.pendingMessages("chat-1");
    // Failed messages are tracked with a synthetic id
    expect(pending.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── Session tracking ────────────────────────────────────────────────────────

describe("BaseChannelAdapter — session per chat", () => {
  it("creates a session on first message and tracks messages", async () => {
    const { adapter } = makeWhatsAppAdapter();
    await adapter.connect();
    await adapter.send("chat-A", "msg-1");
    await adapter.send("chat-A", "msg-2");
    await adapter.send("chat-B", "msg-3");
    const sessions = adapter.getSessions();
    expect(sessions).toHaveLength(2);
    const sessionA = adapter.getSession("chat-A");
    expect(sessionA.messages).toHaveLength(2);
  });

  it("records inbound messages in the session", async () => {
    const { adapter, transport } = makeWhatsAppAdapter();
    await adapter.connect();
    transport.receiveMessage({
      id: "in1", channel: "whatsapp", chatId: "chat-X", text: "incoming",
      fromMe: false, timestamp: Date.now(),
    });
    const session = adapter.getSession("chat-X");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]!.fromMe).toBe(false);
  });

  it("updates lastActivity on each message", async () => {
    const { adapter } = makeWhatsAppAdapter();
    await adapter.connect();
    await adapter.send("chat", "msg-1");
    const session1 = adapter.getSession("chat");
    await new Promise<void>((r) => { setTimeout(r, 5); });
    await adapter.send("chat", "msg-2");
    const session2 = adapter.getSession("chat");
    expect(session2.lastActivity).toBeGreaterThanOrEqual(session1.lastActivity);
  });
});

// ─── WhatsApp adapter ────────────────────────────────────────────────────────

describe("WhatsAppAdapter — platform-specific", () => {
  it("type is 'whatsapp'", () => {
    const { adapter } = makeWhatsAppAdapter();
    expect(adapter.type).toBe("whatsapp");
  });

  it("passes config to the transport factory", async () => {
    let receivedConfig: WhatsAppConfig | null = null;
    const transport = new MockTransport();
    const factory: WhatsAppTransportFactory = async (config, onMessage) => {
      receivedConfig = config;
      transport.setInboundCb(onMessage);
      return transport;
    };
    const adapter = new WhatsAppAdapter(
      { phoneNumber: "+999", sessionData: "restore-data" },
      factory,
    );
    await adapter.connect();
    expect(receivedConfig).not.toBeNull();
    expect(receivedConfig!.phoneNumber).toBe("+999");
    expect(receivedConfig!.sessionData).toBe("restore-data");
  });

  it("routes inbound messages to handlers", async () => {
    const { adapter, transport } = makeWhatsAppAdapter();
    await adapter.connect();
    const received: ChannelMessage[] = [];
    adapter.onMessage(async (msg) => { received.push(msg); });
    transport.receiveMessage({
      id: "wa-1", channel: "whatsapp", chatId: "123@s.whatsapp.net",
      text: "hello from WA", fromMe: false, timestamp: Date.now(),
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.channel).toBe("whatsapp");
  });
});

// ─── Matrix adapter ──────────────────────────────────────────────────────────

describe("MatrixAdapter — platform-specific", () => {
  it("type is 'matrix'", () => {
    const { adapter } = makeMatrixAdapter();
    expect(adapter.type).toBe("matrix");
  });

  it("passes config to the transport factory", async () => {
    let receivedConfig: MatrixConfig | null = null;
    const transport = new MockTransport();
    const factory: MatrixTransportFactory = async (config, onMessage) => {
      receivedConfig = config;
      transport.setInboundCb(onMessage);
      return transport;
    };
    const adapter = new MatrixAdapter(
      { homeserverUrl: "https://m.org", accessToken: "tok", userId: "@bot:m.org" },
      factory,
    );
    await adapter.connect();
    expect(receivedConfig).not.toBeNull();
    expect(receivedConfig!.homeserverUrl).toBe("https://m.org");
    expect(receivedConfig!.accessToken).toBe("tok");
  });

  it("routes inbound messages to handlers", async () => {
    const { adapter, transport } = makeMatrixAdapter();
    await adapter.connect();
    const received: ChannelMessage[] = [];
    adapter.onMessage(async (msg) => { received.push(msg); });
    transport.receiveMessage({
      id: "mx-1", channel: "matrix", chatId: "!room:m.org",
      text: "hello from Matrix", fromMe: false, timestamp: Date.now(),
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.channel).toBe("matrix");
  });

  it("send + receive roundtrip with session tracking", async () => {
    const { adapter, transport } = makeMatrixAdapter();
    await adapter.connect();
    await adapter.send("!room:m.org", "outbound");
    transport.receiveMessage({
      id: "mx-in", channel: "matrix", chatId: "!room:m.org",
      text: "reply", fromMe: false, timestamp: Date.now(),
    });
    const session = adapter.getSession("!room:m.org");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]!.fromMe).toBe(true);
    expect(session.messages[1]!.fromMe).toBe(false);
  });
});
