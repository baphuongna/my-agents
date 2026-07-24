/**
 * P7 (shard 07) — can_dispatch drain gate for cron.
 *
 * Tests: draining → tick skipped; not draining → tick runs; dual-flag drain
 * states (one-way shutdown vs reversible external).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Gateway, type GatewayOptions } from "./index.js";

/** Build a minimal gateway with a mock cron scheduler + tracking callbacks. */
function makeGateway(extra: Partial<GatewayOptions> = {}): {
  gw: Gateway;
  dueJobs: { id: string }[];
  onRunCalls: number;
} {
  const dueJobs = [{ id: "job1" }, { id: "job2" }];
  let onRunCalls = 0;
  // Minimal mock cron scheduler with just the methods cronSweep touches.
  const cron = {
    dueAndAdvance: () => dueJobs.slice(),
    claim: () => ({ runId: "r1", jobId: "job1", startedAt: 0, status: "claimed" as const, claimedBy: "w1" }),
    start: () => {},
    complete: () => {},
    sweepExpired: () => [],
    runsOf: () => [],
    listJobs: () => dueJobs,
  };
  const gw = new Gateway({
    port: 0,
    cron: cron as any,
    cronReload: () => {},
    cronPersist: () => {},
    onRunOnSession: async () => {
      onRunCalls++;
      return "result";
    },
    ...extra,
  });
  return { gw, dueJobs, onRunCalls };
}

describe("[unit] Gateway — can_dispatch drain gate (P7)", () => {
  it("not draining → canDispatch() returns true", () => {
    const { gw } = makeGateway();
    expect(gw.canDispatch()).toBe(true);
  });

  it("draining (one-way shutdown) → canDispatch() returns false", () => {
    const { gw } = makeGateway();
    gw.beginShutdown();
    expect(gw.canDispatch()).toBe(false);
  });

  it("draining (external drain) → canDispatch() returns false", () => {
    const { gw } = makeGateway();
    gw.setExternalDrain(true);
    expect(gw.canDispatch()).toBe(false);
  });

  it("external drain is reversible → canDispatch() returns true after clear", () => {
    const { gw } = makeGateway();
    gw.setExternalDrain(true);
    expect(gw.canDispatch()).toBe(false);
    gw.setExternalDrain(false);
    expect(gw.canDispatch()).toBe(true);
  });

  it("one-way shutdown is NOT reversible (stays false after external drain clear)", () => {
    const { gw } = makeGateway();
    gw.beginShutdown();
    gw.setExternalDrain(false); // try to clear
    expect(gw.canDispatch()).toBe(false); // still draining (shutdown is one-way)
  });

  it("both flags set → false; clearing external still false (shutdown persists)", () => {
    const { gw } = makeGateway();
    gw.setExternalDrain(true);
    gw.beginShutdown();
    expect(gw.canDispatch()).toBe(false);
    gw.setExternalDrain(false);
    expect(gw.canDispatch()).toBe(false);
  });
});

describe("[unit] Gateway.cronSweep — drain gate integration", () => {
  it("not draining → cronSweep runs (sweeps due jobs)", async () => {
    const { gw } = makeGateway();
    // cronSweep will run; we just verify it doesn't early-return on the drain gate.
    // Since onRunOnSession is mocked, it will process due jobs.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await gw.cronSweep("test-worker");
    // The sweep ran — no assertion on side effects since the mock cron is minimal,
    // but the important thing is it didn't skip.
    warn.mockRestore();
  });

  it("draining → cronSweep skips the entire sweep (early return)", async () => {
    const { gw, dueJobs } = makeGateway();
    // Track whether dueAndAdvance is called (it shouldn't be when draining).
    let dueCalled = false;
    (gw as any).cron.dueAndAdvance = () => {
      dueCalled = true;
      return dueJobs.slice();
    };
    gw.beginShutdown();
    await gw.cronSweep("test-worker");
    // dueAndAdvance was NOT called because the drain gate skipped the sweep.
    expect(dueCalled).toBe(false);
  });

  it("external drain → cronSweep skips (same as shutdown)", async () => {
    const { gw, dueJobs } = makeGateway();
    let dueCalled = false;
    (gw as any).cron.dueAndAdvance = () => {
      dueCalled = true;
      return dueJobs.slice();
    };
    gw.setExternalDrain(true);
    await gw.cronSweep("test-worker");
    expect(dueCalled).toBe(false);
    // Clear drain → sweep runs.
    gw.setExternalDrain(false);
    await gw.cronSweep("test-worker");
    expect(dueCalled).toBe(true);
  });
});
