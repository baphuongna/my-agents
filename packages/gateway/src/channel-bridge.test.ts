import { describe, it, expect, vi } from "vitest";
import { ChannelAdapterBridge, registerChannelsPackageAdapters, type ChannelsPackageConfig } from "./channel-bridge.js";
import type { ChannelAdapter } from "@my-agent/channels";
import type { Channel } from "./channels.js";

function makeMockAdapter(type: string, connected = false): ChannelAdapter {
  return {
    type: type as never,
    isConnected: () => connected,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    send: vi.fn(async () => ({ ok: true })),
    onMessage: vi.fn(),
  } as unknown as ChannelAdapter;
}

describe("[unit] ChannelAdapterBridge", () => {
  it("id + type from adapter", () => {
    const b = new ChannelAdapterBridge(makeMockAdapter("whatsapp"));
    expect(b.id).toBe("whatsapp");
    expect(b.type).toBe("whatsapp");
    expect(b.label).toBe("WhatsApp");
  });

  it("label for matrix", () => {
    const b = new ChannelAdapterBridge(makeMockAdapter("matrix"));
    expect(b.label).toBe("Matrix");
  });

  it("isConfigured always true", () => {
    expect(new ChannelAdapterBridge(makeMockAdapter("x")).isConfigured()).toBe(true);
  });

  it("validateConfig is no-op (no throw)", () => {
    expect(() => new ChannelAdapterBridge(makeMockAdapter("x")).validateConfig()).not.toThrow();
  });

  it("send delegates to adapter", async () => {
    const adapter = makeMockAdapter("whatsapp");
    const b = new ChannelAdapterBridge(adapter);
    const r = await b.send("chat1", "hi");
    expect(r.ok).toBe(true);
    expect(adapter.send).toHaveBeenCalledWith("chat1", "hi");
  });

  it("send maps error", async () => {
    const adapter = makeMockAdapter("x");
    adapter.send = vi.fn(async () => ({ ok: false, error: "fail" })) as never;
    const b = new ChannelAdapterBridge(adapter);
    const r = await b.send("c", "t");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("fail");
  });

  it("receive returns [] (push-based)", async () => {
    const b = new ChannelAdapterBridge(makeMockAdapter("x"));
    expect(await b.receive()).toEqual([]);
  });

  it("health: connected → Healthy", () => {
    const b = new ChannelAdapterBridge(makeMockAdapter("x", true));
    expect(b.health()).toBe("Healthy");
  });

  it("health: not connected → Degraded", () => {
    const b = new ChannelAdapterBridge(makeMockAdapter("x", false));
    expect(b.health()).toBe("Degraded");
  });

  it("adapter getter exposes underlying adapter", () => {
    const a = makeMockAdapter("x");
    expect(new ChannelAdapterBridge(a).adapter).toBe(a);
  });
});

describe("[unit] registerChannelsPackageAdapters", () => {
  function makeRegistry() {
    const channels = new Map<string, Channel>();
    return {
      register: vi.fn((c: Channel) => { channels.set(c.id, c); }),
      get: (id: string) => channels.get(id),
      size: () => channels.size,
    };
  }

  it("registers whatsapp when enabled", () => {
    const reg = makeRegistry();
    const config: ChannelsPackageConfig = { whatsapp: { enabled: true } };
    const registered = registerChannelsPackageAdapters(reg, config);
    expect(registered).toContain("whatsapp");
    expect(reg.size()).toBe(1);
  });

  it("registers matrix when enabled", () => {
    const reg = makeRegistry();
    const config: ChannelsPackageConfig = { matrix: { enabled: true, homeserver: "https://m.org" } };
    const registered = registerChannelsPackageAdapters(reg, config);
    expect(registered).toContain("matrix");
    expect(reg.size()).toBe(1);
  });

  it("registers both when both enabled", () => {
    const reg = makeRegistry();
    const config: ChannelsPackageConfig = {
      whatsapp: { enabled: true },
      matrix: { enabled: true },
    };
    const registered = registerChannelsPackageAdapters(reg, config);
    expect(registered).toHaveLength(2);
    expect(reg.size()).toBe(2);
  });

  it("skips disabled channels", () => {
    const reg = makeRegistry();
    const config: ChannelsPackageConfig = { whatsapp: { enabled: false } };
    expect(registerChannelsPackageAdapters(reg, config)).toEqual([]);
    expect(reg.size()).toBe(0);
  });

  it("skips already-registered channels", () => {
    const reg = makeRegistry();
    // Pre-register a whatsapp channel
    reg.register({ id: "whatsapp" } as never as Channel);
    const config: ChannelsPackageConfig = { whatsapp: { enabled: true } };
    const registered = registerChannelsPackageAdapters(reg, config);
    expect(registered).not.toContain("whatsapp");
    expect(reg.size()).toBe(1); // only the pre-existing one
  });

  it("empty config → no registrations", () => {
    const reg = makeRegistry();
    expect(registerChannelsPackageAdapters(reg, {})).toEqual([]);
  });
});
