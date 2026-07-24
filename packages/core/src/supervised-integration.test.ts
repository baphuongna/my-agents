/**
 * Integration test for supervisedTask — imports from @my-agent/core (the
 * package export) to prove it's publicly reachable, then exercises both modes:
 * restart-loop (crash → restart, max restarts cap, exponential backoff,
 * long-run reset) and interval (fixed-interval ticking, error resilience,
 * no leading execution, stop/unref).
 */
import { describe, it, expect } from "vitest";
import { supervisedTask, nowWallclock, type SupervisedTaskHandle } from "@my-agent/core";

describe("[unit] supervisedTask — exported from @my-agent/core", () => {
  it("is a callable function exported from the package", () => {
    expect(typeof supervisedTask).toBe("function");
  });

  it("returns a SupervisedTaskHandle with stop/unref/restartCount/gaveUp/running", () => {
    const handle = supervisedTask(async () => {}, "export-check", { sleep: async () => {} });
    expect(typeof handle.stop).toBe("function");
    expect(typeof handle.unref).toBe("function");
    expect(typeof handle.restartCount).toBe("number");
    expect(typeof handle.gaveUp).toBe("boolean");
    expect(typeof handle.running).toBe("boolean");
    handle.stop();
  });
});

describe("[unit] supervisedTask — restart-loop mode (via package export)", () => {
  /** Factory that crashes N times then succeeds. */
  function makeCrashFactory(crashTimes: number): {
    factory: () => Promise<void>;
    calls: { count: number };
  } {
    const calls = { count: 0 };
    return {
      factory: async () => {
        calls.count++;
        if (calls.count <= crashTimes) throw new Error(`crash #${calls.count}`);
      },
      calls,
    };
  }

  it("crash → restart: task recovers after one crash", async () => {
    const { factory, calls } = makeCrashFactory(1);
    const handle = supervisedTask(factory, "recover", { sleep: async () => {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.count).toBe(2);
    expect(handle.restartCount).toBe(1);
    expect(handle.gaveUp).toBe(false);
  });

  it("max restarts cap: gives up after maxRestarts consecutive crashes", async () => {
    const { factory, calls } = makeCrashFactory(100);
    const handle = supervisedTask(factory, "doomed", {
      maxRestarts: 3,
      sleep: async () => {},
      logger: () => {},
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.count).toBe(4); // initial + 3 restarts
    expect(handle.gaveUp).toBe(true);
  });

  it("exponential backoff: delays double each restart", async () => {
    const sleeps: number[] = [];
    const { factory } = makeCrashFactory(100);
    supervisedTask(factory, "backoff", {
      maxRestarts: 4,
      baseBackoffMs: 100,
      maxBackoffMs: 10_000,
      sleep: async (ms) => { sleeps.push(ms); },
      logger: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(sleeps).toEqual([100, 200, 400, 800]);
  });

  it("long-run reset: task that ran ≥ longRunMs before crashing resets counter", async () => {
    let callCount = 0;
    const startTime = 1_000_000;
    let fakeNow = startTime;
    const factory = async () => {
      callCount++;
      if (callCount === 1) {
        fakeNow = startTime + 400_000;
        throw new Error("long-run crash");
      }
      if (callCount === 2) {
        fakeNow = startTime + 400_000 + 1000;
        throw new Error("short crash");
      }
    };
    const handle = supervisedTask(factory, "longrun", {
      longRunMs: 300_000,
      sleep: async () => {},
      now: () => fakeNow,
      logger: () => {},
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(handle.restartCount).toBe(2);
    expect(handle.gaveUp).toBe(false);
  });
});

describe("[unit] supervisedTask — interval mode (via package export)", () => {
  it("ticks at fixed interval with no leading execution", async () => {
    const ticks: number[] = [];
    const t0 = nowWallclock();
    const handle = supervisedTask(() => { ticks.push(nowWallclock() - t0); }, "interval-basic", {
      intervalMs: 50,
    });
    // Wait for ~3 ticks (150ms) + margin.
    await new Promise((r) => setTimeout(r, 180));
    handle.stop();
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(4);
    // No leading execution: first tick should be at ~50ms, not ~0ms.
    expect(ticks[0]!).toBeGreaterThanOrEqual(40);
  });

  it("stop() halts further ticks", async () => {
    let count = 0;
    const handle = supervisedTask(() => { count++; }, "interval-stop", { intervalMs: 30 });
    await new Promise((r) => setTimeout(r, 100));
    handle.stop();
    const countAtStop = count;
    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(countAtStop);
  });

  it("errors in the callback are caught and logged (interval continues)", async () => {
    const logs: string[] = [];
    let successCount = 0;
    let throwNext = true;
    const handle = supervisedTask(() => {
      if (throwNext) {
        throwNext = false;
        throw new Error("tick error");
      }
      successCount++;
    }, "interval-error", {
      intervalMs: 30,
      logger: (msg) => logs.push(msg),
    });
    await new Promise((r) => setTimeout(r, 120));
    handle.stop();
    // The error was logged.
    expect(logs.some((m) => m.includes("tick error"))).toBe(true);
    // The interval continued after the error (successCount > 0).
    expect(successCount).toBeGreaterThan(0);
  });

  it("unref() is callable and does not throw", () => {
    const handle = supervisedTask(() => {}, "interval-unref", { intervalMs: 1000 });
    expect(() => handle.unref()).not.toThrow();
    handle.stop();
  });

  it("handle exposes expected properties in interval mode", () => {
    const handle: SupervisedTaskHandle = supervisedTask(() => {}, "interval-props", {
      intervalMs: 1000,
    });
    expect(handle.gaveUp).toBe(false);
    expect(handle.restartCount).toBe(0);
    handle.stop();
  });
});
