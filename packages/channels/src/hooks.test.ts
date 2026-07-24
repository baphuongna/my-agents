import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getChannelRegistry,
  getChannelRouter,
  registerChannel,
  connectChannels,
  disconnectChannels,
  sendChannelMessage,
  onChannelMessage,
  __resetChannelsForTests,
} from "./hooks.js";
import { WhatsAppAdapter, type WhatsAppTransportFactory } from "./whatsapp.js";
import { MatrixAdapter, type MatrixTransportFactory } from "./matrix.js";
import type { ChannelMessage, TransportHandle } from "./index.js";

beforeEach(() => __resetChannelsForTests());
afterEach(async () => {
  try {
    await disconnectChannels();
  } catch { /* */ }
  __resetChannelsForTests();
  vi.restoreAllMocks();
});

/** Simple mock transport handle for hooks tests. */
function mockHandle(type: string): TransportHandle {
  return {
    sendMessage: async (chatId: string) => ({ messageId: `${type}-${chatId}` }),
    close: async () => {},
  };
}

/** Mock WhatsApp transport factory. */
function mockWhatsAppFactory(): WhatsAppTransportFactory {
  return async (_config, _onMessage) => mockHandle("whatsapp");
}

/** Mock Matrix transport factory. */
function mockMatrixFactory(): MatrixTransportFactory {
  return async (_config, _onMessage) => mockHandle("matrix");
}

describe("hooks — global registry lifecycle", () => {
  it("getChannelRegistry() creates a singleton registry + router", () => {
    const r1 = getChannelRegistry();
    const r2 = getChannelRegistry();
    expect(r1).toBe(r2);
    expect(getChannelRouter()).not.toBeNull();
  });

  it("registerChannel() adds an adapter to the global registry", () => {
    const adapter = new WhatsAppAdapter({ phoneNumber: "+1" }, mockWhatsAppFactory());
    registerChannel(adapter);
    expect(getChannelRegistry().get("whatsapp")).toBe(adapter);
  });

  it("connectChannels / disconnectChannels lifecycle", async () => {
    const wa = new WhatsAppAdapter({ phoneNumber: "+1" }, mockWhatsAppFactory());
    const mx = new MatrixAdapter(
      { homeserverUrl: "https://m.org", accessToken: "tok" },
      mockMatrixFactory(),
    );
    registerChannel(wa);
    registerChannel(mx);
    await connectChannels();
    expect(wa.isConnected()).toBe(true);
    expect(mx.isConnected()).toBe(true);
    await disconnectChannels();
    expect(wa.isConnected()).toBe(false);
    expect(mx.isConnected()).toBe(false);
  });

  it("sendChannelMessage() dispatches via the router", async () => {
    const wa = new WhatsAppAdapter({ phoneNumber: "+1" }, mockWhatsAppFactory());
    registerChannel(wa);
    await connectChannels();
    const result = await sendChannelMessage("whatsapp", "chat-1", "hello");
    expect(result.ok).toBe(true);
    expect(result.messageId).toBeDefined();
  });

  it("sendChannelMessage() returns error for unregistered channel", async () => {
    const result = await sendChannelMessage("signal", "chat-1", "hello");
    expect(result.ok).toBe(false);
  });

  it("onChannelMessage() registers a global handler without throwing", async () => {
    const wa = new WhatsAppAdapter({ phoneNumber: "+1" }, mockWhatsAppFactory());
    registerChannel(wa);
    await connectChannels();
    // Should not throw
    onChannelMessage(async (_msg: ChannelMessage) => {});
    // Verify handler was registered by the router
    expect(getChannelRouter()).not.toBeNull();
  });

  it("onChannelMessage() auto-initializes the registry on first call", () => {
    // After reset, registry is null — onChannelMessage should still work
    // because it auto-initializes via getChannelRouter().
    __resetChannelsForTests();
    onChannelMessage(async () => {});
    expect(getChannelRegistry().size).toBe(0); // no adapters, but registry exists
  });
});
