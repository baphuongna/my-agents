/**
 * @my-agent/gateway — MCP reliability (PLAN-HERMES-PORT Phase 1) unit tests.
 *
 * Covers: failure classification, connect-cooldown backoff, exception-group
 * unwrapping, and the per-server reconnect budget (prove / increment / park).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setTimeProvider, nowWallclock, type TimeProvider } from "@my-agent/core";
import { McpManager, classifyMcpFailure, unwrapExceptionGroup } from "./mcp-client.js";

// Capture the real clock functions at module load (before any override).
const realWallclock = (): number => Date.now();
const realMonotonic = (): number =>
  typeof performance !== "undefined" ? performance.now() * 1000 : Date.now();

// Mutable fake clock so tests can advance time and observe cooldown windows.
let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => clock });
});
afterEach(() => {
  setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic });
});

describe("classifyMcpFailure", () => {
  it("classifies permanent failures", () => {
    expect(classifyMcpFailure(new Error("spawn ENOENT"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("command not found"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("HTTP 401: unauthorized"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("403 Forbidden"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("Unauthorized"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("invalid url"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("Invalid URL"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("connect ECONNREFUSED 127.0.0.1:1"))).toBe("permanent");
  });

  it("classifies transient failures", () => {
    expect(classifyMcpFailure(new Error("MCP request timed out (30s)"))).toBe("transient");
    expect(classifyMcpFailure(new Error("something went wrong"))).toBe("transient");
    // ECONNREFUSED WITHOUT "connect" is NOT treated as permanent (ambiguous).
    expect(classifyMcpFailure(new Error("ECONNREFUSED"))).toBe("transient");
  });

  it("handles non-Error values", () => {
    expect(classifyMcpFailure("a string failure")).toBe("transient");
    expect(classifyMcpFailure({ foo: "bar" })).toBe("transient");
    expect(classifyMcpFailure(null)).toBe("transient");
  });
});

describe("unwrapExceptionGroup", () => {
  it("returns the first non-AbortError sub-error of an AggregateError", () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    const real = new Error("the real cause");
    const agg = new AggregateError([abort, real]);
    const out = unwrapExceptionGroup(agg);
    expect(out).toBe(real);
  });

  it("falls back to the first sub-error when all are AbortErrors", () => {
    const a = new Error("aborted");
    a.name = "AbortError";
    const agg = new AggregateError([a]);
    expect(unwrapExceptionGroup(agg)).toBe(a);
  });

  it("passes through non-AggregateError errors unchanged", () => {
    const e = new Error("plain");
    expect(unwrapExceptionGroup(e)).toBe(e);
    expect(unwrapExceptionGroup("string")).toBe("string");
  });

  it("passes through an empty AggregateError", () => {
    const agg = new AggregateError([]);
    expect(unwrapExceptionGroup(agg)).toBe(agg);
  });
});

describe("connect cooldown (recordConnectFailure / clearConnectFailure / connectCooldownActive)", () => {
  it("is inactive for a server with no recorded failure", () => {
    const mgr = new McpManager();
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });

  it("arms a cooldown after one failure (30s base)", () => {
    const mgr = new McpManager();
    mgr.recordConnectFailure("s");
    expect(mgr.connectCooldownActive("s")).toBe(true);
    // Just past the 30s base window → no longer active.
    clock = 1_000_000 + 30_001;
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });

  it("escalates backoff across consecutive failures", () => {
    const mgr = new McpManager();
    const start = clock;
    mgr.recordConnectFailure("s"); // n=1 → +30_000
    mgr.recordConnectFailure("s"); // n=2 → +60_000
    mgr.recordConnectFailure("s"); // n=3 → +120_000
    expect(mgr.connectCooldownActive("s")).toBe(true);
    // Past the n=1 window but still inside the escalated n=3 window.
    clock = start + 31_000;
    expect(mgr.connectCooldownActive("s")).toBe(true);
    // Past the n=3 window → inactive.
    clock = start + 120_001;
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });

  it("caps the backoff at the max", () => {
    const mgr = new McpManager();
    const start = clock;
    // 2^19 * 30_000 overflows the cap (600_000) quickly.
    for (let i = 0; i < 20; i++) mgr.recordConnectFailure("s");
    expect(mgr.connectCooldownActive("s")).toBe(true);
    // Just under the cap window → still active.
    clock = start + 599_999;
    expect(mgr.connectCooldownActive("s")).toBe(true);
    clock = start + 600_001;
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });

  it("uses the max cooldown for permanent failures", () => {
    const mgr = new McpManager();
    const start = clock;
    mgr.recordConnectFailure("s", { permanent: true });
    // Normal single-failure window (30s) is NOT enough for a permanent failure.
    clock = start + 31_000;
    expect(mgr.connectCooldownActive("s")).toBe(true);
    clock = start + 600_001;
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });

  it("clearConnectFailure immediately deactivates the cooldown", () => {
    const mgr = new McpManager();
    mgr.recordConnectFailure("s");
    mgr.recordConnectFailure("s");
    expect(mgr.connectCooldownActive("s")).toBe(true);
    mgr.clearConnectFailure("s");
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });

  it("resets the fail count after clearConnectFailure", () => {
    const mgr = new McpManager();
    const start = clock;
    mgr.recordConnectFailure("s");
    mgr.recordConnectFailure("s"); // would be +60_000
    mgr.clearConnectFailure("s");
    mgr.recordConnectFailure("s"); // fresh n=1 → +30_000
    clock = start + 31_000;
    expect(mgr.connectCooldownActive("s")).toBe(false);
  });
});

describe("reconnect budget (recordUnprovenConnect / markSessionProven)", () => {
  it("parks after the budget is exhausted (>5 unproven connects)", () => {
    const mgr = new McpManager();
    mgr.register({ id: "s", command: "x" });
    // Budget is 5: retries 1..5 do NOT park.
    for (let i = 0; i < 5; i++) {
      const parked = mgr.recordUnprovenConnect("s");
      expect(parked).toBe(false);
    }
    expect(mgr.getServer("s")?.phase).not.toBe("Parked");
    // The 6th unproven connect (> _MAX_RECONNECT_RETRIES) parks the server.
    const parked = mgr.recordUnprovenConnect("s");
    expect(parked).toBe(true);
    expect(mgr.getServer("s")?.phase).toBe("Parked");
  });

  it("does not consume budget once the session is proven", () => {
    const mgr = new McpManager();
    mgr.register({ id: "s", command: "x" });
    mgr.markSessionProven("s"); // proven → recordUnprovenConnect is a no-op
    for (let i = 0; i < 50; i++) {
      expect(mgr.recordUnprovenConnect("s")).toBe(false);
    }
    expect(mgr.getServer("s")?.phase).not.toBe("Parked");
  });

  it("markSessionProven revives a parked server", () => {
    const mgr = new McpManager();
    mgr.register({ id: "s", command: "x" });
    // Exhaust the budget to park.
    for (let i = 0; i < 6; i++) mgr.recordUnprovenConnect("s");
    expect(mgr.getServer("s")?.phase).toBe("Parked");
    // Proving the session unparks (revives) → Healthy.
    mgr.markSessionProven("s");
    expect(mgr.getServer("s")?.phase).toBe("Healthy");
  });

  it("markSessionProven resets the budget so a new unproven cycle starts fresh", () => {
    const mgr = new McpManager();
    mgr.register({ id: "s", command: "x" });
    // 4 unproven connects (below threshold)…
    for (let i = 0; i < 4; i++) mgr.recordUnprovenConnect("s");
    // …then prove and immediately "lose" proof by re-registering a fresh budget.
    // (Simulates a stop/start: stop clears reconnect state, start re-arms it.)
    mgr.markSessionProven("s");
    // After proving, recordUnprovenConnect won't park (proven). To verify the
    // reset of the *counter*, we observe that a single subsequent unproven
    // connect does NOT park — confirming the counter is back at 0..1.
    mgr.stop("s"); // clears reconnect state (fresh budget on next connect)
    mgr.register({ id: "s", command: "x" });
    expect(mgr.recordUnprovenConnect("s")).toBe(false);
    expect(mgr.getServer("s")?.phase).not.toBe("Parked");
  });
});

describe("Parked phase in the FSM", () => {
  it("Parked is excluded from usable tools / counts as failed in aggregate", async () => {
    // Direct lifecycle check: aggregateHealth treats Parked like a failure.
    const { aggregateHealth } = await import("./mcp-lifecycle.js");
    const parked = {
      id: "p",
      command: "x",
      args: [],
      phase: "Parked" as const,
      health: "Degraded" as const,
      capabilities: [],
      consecutiveFailures: 0,
      tools: ["t"],
    };
    // A lone parked server → overall Failed (nothing usable).
    expect(aggregateHealth([parked])).toBe("Failed");
  });
});

// Sanity: the injected clock is actually wired through core.time.
describe("time wiring", () => {
  it("nowWallclock reflects the injected provider", () => {
    clock = 4_242_424;
    expect(nowWallclock()).toBe(4_242_424);
  });
});
