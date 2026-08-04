import { describe, it, expect } from "vitest";
import { streamWithFallback } from "./fallback.js";
import { ProviderRegistry } from "./registry.js";
import type { ProviderProfile, StreamEvent, LifecycleError } from "@my-agent/core";

function makeProfile(id: string, events: StreamEvent[], throwErr?: Error): ProviderProfile {
  return {
    id,
    model: id,
    health: () => "Healthy" as const,
    async stream() {
      if (throwErr) throw throwErr;
      return { events: [...events] };
    },
  } as unknown as ProviderProfile;
}

const okEvents: StreamEvent[] = [{ kind: "text", text: "hello" }, { kind: "done", usage: { input: 1, output: 1 } }];

describe("[unit] streamWithFallback", () => {
  it("returns first ok profile's events", async () => {
    const r = await streamWithFallback([makeProfile("a", okEvents)], {} as never, [] as never);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.profile.id).toBe("a");
      expect(r.events).toHaveLength(2);
    }
  });

  it("tries next profile on throw", async () => {
    const r = await streamWithFallback([
      makeProfile("a", okEvents, new Error("network down")),
      makeProfile("b", okEvents),
    ], {} as never, [] as never);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.profile.id).toBe("b");
  });

  it("tries next profile on inline stream error", async () => {
    const errEvents: StreamEvent[] = [{ kind: "error", error: { phase: "auth", recoverable: false, retries: 0, context: {} } as LifecycleError }];
    const r = await streamWithFallback([
      makeProfile("a", errEvents),
      makeProfile("b", okEvents),
    ], {} as never, [] as never);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.profile.id).toBe("b");
  });

  it("all profiles fail → error result", async () => {
    const r = await streamWithFallback([
      makeProfile("a", okEvents, new Error("boom")),
      makeProfile("b", okEvents, new Error("boom")),
    ], {} as never, [] as never);
    expect(r.kind).toBe("error");
  });

  it("empty profile list → error", async () => {
    const r = await streamWithFallback([], {} as never, [] as never);
    expect(r.kind).toBe("error");
  });

  it("with registry: taints failed profile", async () => {
    const reg = new ProviderRegistry();
    reg.register(makeProfile("a", okEvents, new Error("boom")));
    reg.register(makeProfile("b", okEvents));
    const r = await streamWithFallback(reg, {} as never, [] as never);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.profile.id).toBe("b");
    // a should be tainted
    expect(reg.eligible("a")).toBe(false);
  });

  it("with registry: auth error taints as auth", async () => {
    const reg = new ProviderRegistry();
    const authErrEvents: StreamEvent[] = [{ kind: "error", error: { phase: "auth", recoverable: false, retries: 0, context: {} } as LifecycleError }];
    reg.register(makeProfile("a", authErrEvents));
    reg.register(makeProfile("b", okEvents));
    await streamWithFallback(reg, {} as never, [] as never);
    expect(reg.eligible("a")).toBe(false);
  });

  it("with registry: all tainted → error", async () => {
    const reg = new ProviderRegistry();
    reg.register(makeProfile("a", okEvents, new Error("x")));
    const r = await streamWithFallback(reg, {} as never, [] as never);
    expect(r.kind).toBe("error");
  });
});
