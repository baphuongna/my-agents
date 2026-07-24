/**
 * Integration tests for Item 17: wiring @my-agent/channels into the gateway.
 *
 * Verifies that:
 *   - ChannelAdapterBridge correctly wraps a @my-agent/channels adapter into
 *     the gateway's local Channel interface.
 *   - registerChannelsPackageAdapters() instantiates WhatsApp/Matrix adapters
 *     when config enables them, and skips when disabled.
 *   - The Gateway constructor wires channelsConfig → registry (bridged adapters
 *     appear in the local ChannelRegistry).
 *   - The /status HTTP endpoint lists the bridged channels (launcher reads this).
 *   - Bridge send() delegates to adapter.send().
 *   - Bridge health() reflects adapter connection state.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  Gateway,
  ChannelRegistry,
  ChannelAdapterBridge,
  registerChannelsPackageAdapters,
  type ChannelsPackageConfig,
  type ChannelTransportFactories,
} from "./index.js";
import {
  WhatsAppAdapter,
  MatrixAdapter,
  type WhatsAppConfig,
  type WhatsAppTransportFactory,
  type MatrixConfig,
  type MatrixTransportFactory,
  type TransportHandle,
  type ChannelMessage,
} from "@my-agent/channels";

afterEach(() => {
  // Clean up any stray timers from Gateway instances.
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A mock WhatsApp transport that records sent messages. */
function mockWhatsAppTransport(): {
  factory: WhatsAppTransportFactory;
  sent: Array<{ chatId: string; text: string }>;
} {
  const sent: Array<{ chatId: string; text: string }> = [];
  const factory: WhatsAppTransportFactory = async (
    _config: WhatsAppConfig,
    _onMessage: (msg: ChannelMessage) => void,
  ): Promise<TransportHandle> => ({
    sendMessage: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return { messageId: `wa-msg-${sent.length}` };
    },
    close: async () => {},
  });
  return { factory, sent };
}

/** A mock Matrix transport that records sent messages. */
function mockMatrixTransport(): {
  factory: MatrixTransportFactory;
  sent: Array<{ chatId: string; text: string }>;
} {
  const sent: Array<{ chatId: string; text: string }> = [];
  const factory: MatrixTransportFactory = async (
    _config: MatrixConfig,
    _onMessage: (msg: ChannelMessage) => void,
  ): Promise<TransportHandle> => ({
    sendMessage: async (chatId: string, text: string) => {
      sent.push({ chatId, text });
      return { messageId: `mx-msg-${sent.length}` };
    },
    close: async () => {},
  });
  return { factory, sent };
}

// ── ChannelAdapterBridge ─────────────────────────────────────────────────────

describe("[unit] ChannelAdapterBridge", () => {
  it("wraps a WhatsApp adapter into the local Channel interface", async () => {
    const { factory } = mockWhatsAppTransport();
    const adapter = new WhatsAppAdapter({ phoneNumber: "+1234" }, factory);
    const bridge = new ChannelAdapterBridge(adapter);

    expect(bridge.id).toBe("whatsapp");
    expect(bridge.type).toBe("whatsapp");
    expect(bridge.label).toBe("WhatsApp");
    expect(bridge.isConfigured()).toBe(true);
    expect(() => bridge.validateConfig()).not.toThrow();
    expect(bridge.health()).toBe("Degraded"); // not connected yet
    expect(await bridge.receive()).toEqual([]);
  });

  it("wraps a Matrix adapter into the local Channel interface", () => {
    const { factory } = mockMatrixTransport();
    const adapter = new MatrixAdapter(
      { homeserverUrl: "https://matrix.org", accessToken: "tok" },
      factory,
    );
    const bridge = new ChannelAdapterBridge(adapter);

    expect(bridge.id).toBe("matrix");
    expect(bridge.type).toBe("matrix");
    expect(bridge.label).toBe("Matrix");
    expect(bridge.isConfigured()).toBe(true);
    expect(bridge.health()).toBe("Degraded");
  });

  it("send() delegates to the underlying adapter (after connect)", async () => {
    const { factory, sent } = mockWhatsAppTransport();
    const adapter = new WhatsAppAdapter({ phoneNumber: "+1234" }, factory);
    await adapter.connect();
    const bridge = new ChannelAdapterBridge(adapter);

    // After connect, health is Healthy.
    expect(bridge.health()).toBe("Healthy");

    const result = await bridge.send("1234567890@s.whatsapp.net", "hello");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("hello");
  });

  it("send() returns ok:false when adapter is not connected", async () => {
    const { factory } = mockWhatsAppTransport();
    const adapter = new WhatsAppAdapter({ phoneNumber: "+1234" }, factory);
    // Not connected
    const bridge = new ChannelAdapterBridge(adapter);

    const result = await bridge.send("jid", "text");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not connected");
  });

  it("health() reflects connection state after connect/disconnect", async () => {
    const { factory } = mockMatrixTransport();
    const adapter = new MatrixAdapter(
      { homeserverUrl: "https://matrix.org", accessToken: "tok" },
      factory,
    );
    const bridge = new ChannelAdapterBridge(adapter);

    expect(bridge.health()).toBe("Degraded");
    await adapter.connect();
    expect(bridge.health()).toBe("Healthy");
    await adapter.disconnect();
    expect(bridge.health()).toBe("Degraded");
  });

  it("exposes the underlying adapter via .adapter getter", () => {
    const { factory } = mockWhatsAppTransport();
    const adapter = new WhatsAppAdapter({ phoneNumber: "+1234" }, factory);
    const bridge = new ChannelAdapterBridge(adapter);
    expect(bridge.adapter).toBe(adapter);
  });
});

// ── registerChannelsPackageAdapters ──────────────────────────────────────────

describe("[unit] registerChannelsPackageAdapters", () => {
  it("registers a WhatsApp adapter when config.whatsapp.enabled = true", () => {
    const registry = new ChannelRegistry();
    const { factory } = mockWhatsAppTransport();
    const transports: ChannelTransportFactories = { whatsapp: factory };
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: true, phoneNumber: "+1234" },
    };

    const registered = registerChannelsPackageAdapters(registry, config, transports);

    expect(registered).toEqual(["whatsapp"]);
    const ch = registry.get("whatsapp");
    expect(ch).toBeDefined();
    expect(ch!.type).toBe("whatsapp");
    expect(ch!.label).toBe("WhatsApp");
    expect(ch!.isConfigured()).toBe(true);
  });

  it("registers a Matrix adapter when config.matrix.enabled = true", () => {
    const registry = new ChannelRegistry();
    const { factory } = mockMatrixTransport();
    const transports: ChannelTransportFactories = { matrix: factory };
    const config: ChannelsPackageConfig = {
      matrix: {
        enabled: true,
        homeserver: "https://matrix.org",
        accessToken: "tok",
        userId: "@bot:matrix.org",
      },
    };

    const registered = registerChannelsPackageAdapters(registry, config, transports);

    expect(registered).toEqual(["matrix"]);
    const ch = registry.get("matrix");
    expect(ch).toBeDefined();
    expect(ch!.type).toBe("matrix");
    expect(ch!.label).toBe("Matrix");
  });

  it("registers both WhatsApp and Matrix when both enabled", () => {
    const registry = new ChannelRegistry();
    const wa = mockWhatsAppTransport();
    const mx = mockMatrixTransport();
    const transports: ChannelTransportFactories = {
      whatsapp: wa.factory,
      matrix: mx.factory,
    };
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: true },
      matrix: { enabled: true, homeserver: "https://m.org", accessToken: "t" },
    };

    const registered = registerChannelsPackageAdapters(registry, config, transports);
    expect(registered).toHaveLength(2);
    expect(registered).toContain("whatsapp");
    expect(registered).toContain("matrix");
    expect(registry.list()).toHaveLength(2);
  });

  it("registers nothing when config has neither enabled", () => {
    const registry = new ChannelRegistry();
    const config: ChannelsPackageConfig = {};

    const registered = registerChannelsPackageAdapters(registry, config);

    expect(registered).toEqual([]);
    expect(registry.list()).toHaveLength(0);
  });

  it("skips whatsapp when enabled = false", () => {
    const registry = new ChannelRegistry();
    const { factory } = mockWhatsAppTransport();
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: false, phoneNumber: "+1234" },
    };

    const registered = registerChannelsPackageAdapters(registry, config, { whatsapp: factory });
    expect(registered).toEqual([]);
    expect(registry.list()).toHaveLength(0);
  });

  it("uses placeholder transport when no factory provided", () => {
    const registry = new ChannelRegistry();
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: true, phoneNumber: "+1234" },
    };

    // No transports provided — placeholder should be used.
    const registered = registerChannelsPackageAdapters(registry, config);
    expect(registered).toEqual(["whatsapp"]);
    // The adapter is registered; sending without connect returns not-connected.
    const ch = registry.get("whatsapp");
    expect(ch).toBeDefined();
  });

  it("does not duplicate-register when a channel id already exists", () => {
    const registry = new ChannelRegistry();
    // Pre-register a local "whatsapp" channel (e.g. from env-var discovery).
    const { factory } = mockWhatsAppTransport();
    const adapter = new WhatsAppAdapter({ phoneNumber: "+1234" }, factory);
    registry.register(new ChannelAdapterBridge(adapter));
    expect(registry.list()).toHaveLength(1);

    // registerChannelsPackageAdapters should skip whatsapp (already exists).
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: true, phoneNumber: "+9999" },
    };
    const registered = registerChannelsPackageAdapters(registry, config, { whatsapp: factory });
    expect(registered).toEqual([]);
    expect(registry.list()).toHaveLength(1); // still just the one
  });
});

// ── Gateway /status integration ──────────────────────────────────────────────

describe("[integration] Gateway /status with @my-agent/channels", () => {
  it("Gateway wires channelsConfig into the local ChannelRegistry", () => {
    const wa = mockWhatsAppTransport();
    const mx = mockMatrixTransport();
    const channels = new ChannelRegistry();
    const gw = new Gateway({
      port: 0,
      channels,
      channelsConfig: {
        whatsapp: { enabled: true, phoneNumber: "+1234" },
        matrix: { enabled: true, homeserver: "https://m.org", accessToken: "t" },
      },
      channelTransports: {
        whatsapp: wa.factory,
        matrix: mx.factory,
      },
    });

    // The bridged adapters should now be in the registry.
    expect(channels.get("whatsapp")).toBeDefined();
    expect(channels.get("matrix")).toBeDefined();
    expect(channels.list().map((c) => c.id)).toContain("whatsapp");
    expect(channels.list().map((c) => c.id)).toContain("matrix");

    void gw.stop();
  });

  it("Gateway does not wire channels when channelsConfig is absent", () => {
    const channels = new ChannelRegistry();
    const gw = new Gateway({ port: 0, channels });

    expect(channels.list()).toHaveLength(0);
    void gw.stop();
  });

  it("GET /status returns the bridged WhatsApp + Matrix channels", async () => {
    const wa = mockWhatsAppTransport();
    const mx = mockMatrixTransport();
    const channels = new ChannelRegistry();
    const gw = new Gateway({
      host: "127.0.0.1",
      port: 0,
      channels,
      channelsConfig: {
        whatsapp: { enabled: true, phoneNumber: "+1234" },
        matrix: { enabled: true, homeserver: "https://m.org", accessToken: "t" },
      },
      channelTransports: {
        whatsapp: wa.factory,
        matrix: mx.factory,
      },
    });
    const { port } = await gw.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      const body = (await res.json()) as {
        channels: Array<{
          id: string;
          type: string;
          label: string;
          enabled: boolean;
          configured: boolean;
          health: string;
        }>;
      };
      expect(res.status).toBe(200);
      const ids = body.channels.map((c) => c.id);
      expect(ids).toContain("whatsapp");
      expect(ids).toContain("matrix");

      const waCh = body.channels.find((c) => c.id === "whatsapp");
      expect(waCh).toBeDefined();
      expect(waCh!.type).toBe("whatsapp");
      expect(waCh!.label).toBe("WhatsApp");
      expect(waCh!.configured).toBe(true);

      const mxCh = body.channels.find((c) => c.id === "matrix");
      expect(mxCh).toBeDefined();
      expect(mxCh!.label).toBe("Matrix");
    } finally {
      await gw.stop();
    }
  });

  it("GET /status returns empty channels when config is absent", async () => {
    const channels = new ChannelRegistry();
    const gw = new Gateway({ host: "127.0.0.1", port: 0, channels });
    const { port } = await gw.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      const body = (await res.json()) as { channels: unknown[] };
      expect(res.status).toBe(200);
      expect(body.channels).toEqual([]);
    } finally {
      await gw.stop();
    }
  });

  it("launcher channel shape: /status channels match launcher's GatewayInfo type", async () => {
    // The launcher expects: { id, type, alias?, label, enabled, configured, health }
    const wa = mockWhatsAppTransport();
    const channels = new ChannelRegistry();
    const gw = new Gateway({
      host: "127.0.0.1",
      port: 0,
      channels,
      channelsConfig: {
        whatsapp: { enabled: true, phoneNumber: "+1234" },
      },
      channelTransports: { whatsapp: wa.factory },
    });
    const { port } = await gw.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      const body = (await res.json()) as { channels: Array<Record<string, unknown>> };
      const ch = body.channels[0]!;
      // Verify all fields the launcher reads are present.
      expect(typeof ch["id"]).toBe("string");
      expect(typeof ch["type"]).toBe("string");
      expect(typeof ch["label"]).toBe("string");
      expect(typeof ch["enabled"]).toBe("boolean");
      expect(typeof ch["configured"]).toBe("boolean");
      expect(typeof ch["health"]).toBe("string");
    } finally {
      await gw.stop();
    }
  });
});

// ── End-to-end send via bridge ────────────────────────────────────────────────

describe("[integration] bridge send() end-to-end", () => {
  it("sends a message via the WhatsApp bridge through the registry", async () => {
    const { factory, sent } = mockWhatsAppTransport();
    const registry = new ChannelRegistry();
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: true, phoneNumber: "+1234" },
    };
    registerChannelsPackageAdapters(registry, config, { whatsapp: factory });

    const ch = registry.get("whatsapp")!;
    expect(ch.isConfigured()).toBe(true);

    // Connect the underlying adapter (via the bridge's exposed adapter).
    const bridge = ch as unknown as { adapter: WhatsAppAdapter };
    await bridge.adapter.connect();

    const result = await ch.send("123@s.whatsapp.net", "test message");
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe("123@s.whatsapp.net");
    expect(sent[0]!.text).toBe("test message");

    await bridge.adapter.disconnect();
  });
});
