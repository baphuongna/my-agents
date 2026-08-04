import { describe, it, expect, vi } from "vitest";
import { ChannelRegistry, type Channel, type ChannelConfig } from "./channels.js";

function makeChannel(id: string, opts: { configured?: boolean; health?: "Healthy" | "Degraded" | "Failed" } = {}): Channel {
  const configured = opts.configured ?? true;
  return {
    id, type: id.split(":")[0]!, label: id,
    isConfigured: () => configured,
    validateConfig: () => { if (!configured) throw new Error("not configured"); },
    send: vi.fn(async () => ({ ok: true })),
    health: () => opts.health ?? "Healthy",
  };
}
function makeConfig(id: string, enabled = true): ChannelConfig {
  return { id, enabled, credentials: {}, targets: {} };
}

describe("[unit] ChannelRegistry", () => {
  it("register + get", () => {
    const r = new ChannelRegistry();
    const ch = makeChannel("tg");
    r.register(ch);
    expect(r.get("tg")).toBe(ch);
    expect(r.get("nope")).toBeUndefined();
  });

  it("list returns all registered", () => {
    const r = new ChannelRegistry();
    r.register(makeChannel("a"));
    r.register(makeChannel("b"));
    expect(r.list()).toHaveLength(2);
  });

  it("active filters by enabled + configured", () => {
    const r = new ChannelRegistry();
    r.register(makeChannel("a", { configured: true }));
    r.register(makeChannel("b", { configured: false }));
    r.register(makeChannel("c", { configured: true }));
    r.configure("a", makeConfig("a", true));
    r.configure("b", makeConfig("b", true));
    r.configure("c", makeConfig("c", false)); // disabled
    expect(r.active().map(c => c.id)).toEqual(["a"]);
  });

  it("send via registered + configured channel", async () => {
    const r = new ChannelRegistry();
    const ch = makeChannel("tg");
    r.register(ch);
    r.configure("tg", makeConfig("tg"));
    const result = await r.send("tg", "chat1", "hello");
    expect(result.ok).toBe(true);
    expect(ch.send).toHaveBeenCalledWith("chat1", "hello");
  });

  it("send unregistered channel → error", async () => {
    const r = new ChannelRegistry();
    const result = await r.send("nope", "x", "y");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not registered/);
  });

  it("send unconfigured channel → error", async () => {
    const r = new ChannelRegistry();
    r.register(makeChannel("tg", { configured: false }));
    const result = await r.send("tg", "x", "y");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/);
  });

  it("health: no active channels → Healthy", () => {
    expect(new ChannelRegistry().health).toBe("Healthy");
  });

  it("health: all active Healthy → Healthy", () => {
    const r = new ChannelRegistry();
    r.register(makeChannel("a"));
    r.configure("a", makeConfig("a"));
    expect(r.health).toBe("Healthy");
  });

  it("health: some Degraded → Degraded", () => {
    const r = new ChannelRegistry();
    r.register(makeChannel("a", { health: "Healthy" }));
    r.register(makeChannel("b", { health: "Degraded" }));
    r.configure("a", makeConfig("a"));
    r.configure("b", makeConfig("b"));
    expect(r.health).toBe("Degraded");
  });

  it("health: all Failed → Failed", () => {
    const r = new ChannelRegistry();
    r.register(makeChannel("a", { health: "Failed" }));
    r.configure("a", makeConfig("a"));
    expect(r.health).toBe("Failed");
  });

  it("getConfig returns stored config", () => {
    const r = new ChannelRegistry();
    const cfg = makeConfig("x");
    r.configure("x", cfg);
    expect(r.getConfig("x")).toBe(cfg);
  });
});
