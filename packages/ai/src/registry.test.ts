import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "./registry.js";
import type { ProviderProfile, StreamEvent, ComponentHealth } from "@my-agent/core";

function makeProfile(id: string, health: ComponentHealth = "Healthy", events: StreamEvent[] = [{ kind: "text", text: "ok" }]): ProviderProfile {
  return {
    id,
    model: id,
    health: () => health,
    async stream() { return { events: [...events] }; },
  } as unknown as ProviderProfile;
}

describe("[unit] ProviderRegistry", () => {
  it("register + all (ordered)", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    r.register(makeProfile("b"));
    expect(r.all().map(p => p.id)).toEqual(["a", "b"]);
  });

  it("register throws on duplicate id", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    expect(() => r.register(makeProfile("a"))).toThrow(/already registered/);
  });

  it("taint disqualifies from available", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    r.register(makeProfile("b"));
    r.taint("a", "auth");
    expect(r.available().map(p => p.id)).toEqual(["b"]);
  });

  it("clear removes taint", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    r.taint("a", "quota");
    expect(r.available()).toHaveLength(0);
    r.clear("a");
    expect(r.available()).toHaveLength(1);
  });

  it("eligible: cooldown expiry auto-clears", () => {
    const r = new ProviderRegistry({ cooldownMs: 100 });
    r.register(makeProfile("a"));
    r.taint("a", "network");
    expect(r.eligible("a", Date.now())).toBe(false);
    expect(r.eligible("a", Date.now() + 200)).toBe(true);
    // auto-cleared after expiry
    expect(r.eligible("a")).toBe(true);
  });

  it("health: all available → Healthy", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    r.register(makeProfile("b"));
    expect(r.health()).toBe("Healthy");
  });

  it("health: some tainted → Degraded", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    r.register(makeProfile("b"));
    r.taint("a", "auth");
    expect(r.health()).toBe("Degraded");
  });

  it("health: all tainted → Failed", () => {
    const r = new ProviderRegistry();
    r.register(makeProfile("a"));
    r.taint("a", "auth");
    expect(r.health()).toBe("Failed");
  });

  it("health: empty → Failed", () => {
    expect(new ProviderRegistry().health()).toBe("Failed");
  });

  it("taint unknown id → no-op (no throw)", () => {
    const r = new ProviderRegistry();
    expect(() => r.taint("nope", "auth")).not.toThrow();
  });
});
