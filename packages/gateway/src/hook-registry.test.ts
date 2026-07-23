/**
 * HookRegistry + ReadinessRegistry tests (§12 + §13 R31).
 *
 * Source of truth:
 *   - packages/gateway/src/hooks.ts:   HookRegistry (extension lifecycle hooks)
 *   - packages/gateway/src/index.ts:   ReadinessRegistry (3-phase readiness probes)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookRegistry } from "./hooks.js";
import type { HookRecord } from "./hooks.js";
import { ReadinessRegistry } from "./index.js";

// ─── HookRegistry ──────────────────────────────────────────────────────────

describe("HookRegistry — registration", () => {
  it("list() returns all registered hooks when no name is given", () => {
    const hr = new HookRegistry();
    hr.register({ name: "session_start", source: "a", priority: 0, handler: vi.fn() });
    hr.register({ name: "pre_tool", source: "b", priority: 0, handler: vi.fn() });
    expect(hr.list()).toHaveLength(2);
  });

  it("list(name) filters to a single hook name", () => {
    const hr = new HookRegistry();
    hr.register({ name: "session_start", source: "a", priority: 0, handler: vi.fn() });
    hr.register({ name: "pre_tool", source: "b", priority: 0, handler: vi.fn() });
    expect(hr.list("pre_tool")).toHaveLength(1);
    expect(hr.list("session_end")).toHaveLength(0);
  });
});

describe("HookRegistry — fire (execution order + isolation)", () => {
  it("fires handlers in priority order (higher first)", async () => {
    const hr = new HookRegistry();
    const order: string[] = [];
    hr.register({ name: "pre_tool", source: "low", priority: 0, handler: () => { order.push("low"); } });
    hr.register({ name: "pre_tool", source: "high", priority: 10, handler: () => { order.push("high"); } });
    hr.register({ name: "pre_tool", source: "mid", priority: 5, handler: () => { order.push("mid"); } });
    await hr.fire("pre_tool", { x: 1 });
    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("a throwing handler is isolated (caught) and does not break later handlers", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hr = new HookRegistry();
    let ran = false;
    hr.register({ name: "post_tool", source: "boom", priority: 10, handler: () => { throw new Error("nope"); } });
    hr.register({ name: "post_tool", source: "ok", priority: 0, handler: () => { ran = true; } });
    await hr.fire("post_tool", {});
    expect(ran).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("fires nothing when no handlers are registered for the name", async () => {
    const hr = new HookRegistry();
    await expect(hr.fire("session_end", {})).resolves.toBeUndefined();
  });

  it("fire deep-freezes the payload so a handler cannot mutate it", async () => {
    const hr = new HookRegistry();
    const seen: unknown[] = [];
    hr.register({
      name: "pre_tool",
      source: "tamper",
      priority: 0,
      handler: (payload) => {
        seen.push(payload);
        // attempt to mutate the (frozen) payload
        try {
          (payload as Record<string, unknown>)["injected"] = true;
          (payload as Record<string, unknown>)["nested"] = { mutated: true };
        } catch {
          // frozen → throws in strict mode, which is expected
        }
      },
    });
    await hr.fire("pre_tool", { a: { b: 1 } });
    // the payload object + nested object are frozen
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it("awaits async handlers", async () => {
    const hr = new HookRegistry();
    let done = false;
    hr.register({
      name: "session_start",
      source: "async",
      priority: 0,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 5));
        done = true;
      },
    });
    await hr.fire("session_start", {});
    expect(done).toBe(true);
  });
});

// ─── ReadinessRegistry (3-phase probes) ────────────────────────────────────

describe("ReadinessRegistry — liveness", () => {
  it("liveness is always ok=true once the registry exists", () => {
    const rr = new ReadinessRegistry();
    const r = rr.liveness();
    expect(r.state).toBe("live");
    expect(r.ok).toBe(true);
  });
});

describe("ReadinessRegistry — readiness", () => {
  it("is not ready before markBooted()", () => {
    const rr = new ReadinessRegistry();
    const r = rr.readiness();
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("booting");
  });

  it("becomes ready after markBooted() with all passing checks", () => {
    const rr = new ReadinessRegistry();
    rr.register("db", () => true);
    rr.register("cache", () => true);
    rr.markBooted();
    const r = rr.readiness();
    expect(r.ok).toBe(true);
  });

  it("is not ready when a registered check returns false", () => {
    const rr = new ReadinessRegistry();
    rr.register("db", () => true);
    rr.register("broken", () => false);
    rr.markBooted();
    const r = rr.readiness();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("broken");
  });

  it("a throwing check counts as failed", () => {
    const rr = new ReadinessRegistry();
    rr.register("throws", () => { throw new Error("boom"); });
    rr.markBooted();
    expect(rr.readiness().ok).toBe(false);
  });
});

describe("ReadinessRegistry — functional", () => {
  it("is not functional before ready (booting)", () => {
    const rr = new ReadinessRegistry();
    const r = rr.functional(5);
    expect(r.state).toBe("functional");
    expect(r.ok).toBe(false);
  });

  it("is not functional when ready but no healthy turn yet", () => {
    const rr = new ReadinessRegistry();
    rr.markBooted();
    const r = rr.functional(0);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("no healthy turn yet");
  });

  it("is functional once ready with >= 1 healthy turn", () => {
    const rr = new ReadinessRegistry();
    rr.markBooted();
    expect(rr.functional(1).ok).toBe(true);
    expect(rr.functional(42).ok).toBe(true);
  });
});

// keep the unused import type referenced for clarity in some toolchains
void (null as unknown as HookRecord);
