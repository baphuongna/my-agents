import { describe, it, expect, vi } from "vitest";
import { HookRegistry, type HookRecord } from "./hooks.js";

describe("[unit] HookRegistry", () => {
  it("register + fire runs handler", async () => {
    const reg = new HookRegistry();
    const handler = vi.fn();
    reg.register({ name: "pre_turn", source: "test", priority: 0, handler });
    await reg.fire("pre_turn", { turn: 1 });
    expect(handler).toHaveBeenCalledWith({ turn: 1 });
  });

  it("higher priority runs first", async () => {
    const reg = new HookRegistry();
    const order: string[] = [];
    reg.register({ name: "pre_tool", source: "low", priority: 0, handler: () => { order.push("low"); } });
    reg.register({ name: "pre_tool", source: "high", priority: 10, handler: () => { order.push("high"); } });
    reg.register({ name: "pre_tool", source: "mid", priority: 5, handler: () => { order.push("mid"); } });
    await reg.fire("pre_tool", {});
    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("handler error is isolated (doesn't break fire)", async () => {
    const reg = new HookRegistry();
    const after = vi.fn();
    reg.register({ name: "post_turn", source: "bad", priority: 10, handler: () => { throw new Error("boom"); } });
    reg.register({ name: "post_turn", source: "good", priority: 0, handler: after });
    await reg.fire("post_turn", {});
    expect(after).toHaveBeenCalled(); // still ran despite earlier throw
  });

  it("async handlers are awaited", async () => {
    const reg = new HookRegistry();
    let resolved = false;
    reg.register({ name: "session_start", source: "t", priority: 0, handler: async () => {
      await new Promise(r => setTimeout(r, 10));
      resolved = true;
    } });
    await reg.fire("session_start", {});
    expect(resolved).toBe(true);
  });

  it("payload is frozen (handlers can't mutate)", async () => {
    const reg = new HookRegistry();
    let sawMutation: () => void = () => {};
    reg.register({ name: "pre_tool", source: "mutator", priority: 10, handler: (p) => {
      try { (p as Record<string, unknown>).x = "tampered"; } catch { /* frozen */ }
    } });
    reg.register({ name: "pre_tool", source: "observer", priority: 0, handler: (p) => {
      sawMutation = () => expect(Object.isFrozen(p)).toBe(true);
    } });
    await reg.fire("pre_tool", { x: "original" });
    sawMutation();
  });

  it("list() returns registered hooks", () => {
    const reg = new HookRegistry();
    const rec: HookRecord = { name: "session_start", source: "t", priority: 0, handler: () => {} };
    reg.register(rec);
    expect(reg.list("session_start")).toHaveLength(1);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list("post_turn")).toHaveLength(0);
  });

  it("fire with no registered hooks is a no-op", async () => {
    const reg = new HookRegistry();
    await expect(reg.fire("session_end", {})).resolves.toBeUndefined();
  });
});
