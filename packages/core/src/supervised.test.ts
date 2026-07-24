import { describe, it, expect, vi } from "vitest";
import { supervisedTask } from "./supervised.js";

/** A factory that crashes N times then succeeds. Tracks call count. */
function makeCrashFactory(crashTimes: number): {
  factory: () => Promise<void>;
  calls: number;
} {
  const calls = { count: 0 };
  return {
    factory: async () => {
      calls.count++;
      if (calls.count <= crashTimes) throw new Error(`crash #${calls.count}`);
      // After crashTimes, complete normally.
    },
    calls,
  };
}

describe("[unit] supervisedTask", () => {
  it("happy path: task completes on first try, no restarts", async () => {
    const { factory } = makeCrashFactory(0);
    const handle = supervisedTask(factory, "happy", {
      sleep: async () => {},
    });
    // Give the microtask loop a tick to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(handle.restartCount).toBe(0);
    expect(handle.gaveUp).toBe(false);
    expect(handle.running).toBe(false);
  });

  it("crash → restart (task recovers after a crash)", async () => {
    const { factory, calls } = makeCrashFactory(1);
    const handle = supervisedTask(factory, "recover", {
      sleep: async () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.count).toBe(2); // crashed once, then succeeded
    expect(handle.restartCount).toBe(1);
    expect(handle.gaveUp).toBe(false);
  });

  it("5+ consecutive crashes → give up (stops restarting)", async () => {
    const { factory, calls } = makeCrashFactory(100); // always crashes
    const logs: string[] = [];
    const handle = supervisedTask(factory, "doomed", {
      maxRestarts: 5,
      sleep: async () => {},
      logger: (msg) => logs.push(msg),
    });
    await new Promise((r) => setTimeout(r, 30));
    // Initial call + 5 restarts = 6 total attempts.
    expect(calls.count).toBe(6);
    expect(handle.gaveUp).toBe(true);
    expect(logs.some((m) => m.includes("giving up"))).toBe(true);
  });

  it("long-running reset: task that ran ≥ longRunMs before crashing resets counter", async () => {
    let callCount = 0;
    const startTime = 1_000_000;
    let fakeNow = startTime;
    const factory = async () => {
      callCount++;
      if (callCount === 1) {
        // Simulate a long run (advance time past longRunMs) then crash.
        fakeNow = startTime + 400_000; // 400s > 300s longRunMs
        throw new Error("long-run crash");
      }
      if (callCount === 2) {
        // Short crash — should increment to 1 (counter was reset).
        fakeNow = startTime + 400_000 + 1000;
        throw new Error("short crash");
      }
      // Third call succeeds.
    };
    const handle = supervisedTask(factory, "longrun", {
      longRunMs: 300_000,
      sleep: async () => {},
      now: () => fakeNow,
    });
    await new Promise((r) => setTimeout(r, 30));
    // First crash ran ≥ 300s → counter reset to 0, then incremented to 1.
    // Second crash was short → counter incremented to 2.
    expect(handle.restartCount).toBe(2);
    expect(handle.gaveUp).toBe(false);
  });

  it("exponential backoff: delays double each restart", async () => {
    const sleeps: number[] = [];
    const { factory } = makeCrashFactory(100);
    supervisedTask(factory, "backoff", {
      maxRestarts: 5,
      baseBackoffMs: 100,
      maxBackoffMs: 10_000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await new Promise((r) => setTimeout(r, 20));
    // Backoffs: 100, 200, 400, 800, 1600 (2^0 through 2^4 × base).
    expect(sleeps.length).toBe(5);
    expect(sleeps[0]).toBe(100);
    expect(sleeps[1]).toBe(200);
    expect(sleeps[2]).toBe(400);
    expect(sleeps[3]).toBe(800);
    expect(sleeps[4]).toBe(1600);
  });

  it("backoff is capped at maxBackoffMs", async () => {
    const sleeps: number[] = [];
    const { factory } = makeCrashFactory(100);
    supervisedTask(factory, "capped", {
      maxRestarts: 5,
      baseBackoffMs: 1000,
      maxBackoffMs: 3000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await new Promise((r) => setTimeout(r, 20));
    // Backoffs: 1000, 2000, 3000 (capped), 3000, 3000.
    expect(sleeps[0]).toBe(1000);
    expect(sleeps[1]).toBe(2000);
    expect(sleeps[2]).toBe(3000);
    expect(sleeps[3]).toBe(3000);
    expect(sleeps[4]).toBe(3000);
  });

  it("stop() prevents further restarts", async () => {
    const { factory, calls } = makeCrashFactory(100);
    const handle = supervisedTask(factory, "stopped", {
      sleep: async () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    handle.stop();
    const callsAtStop = calls.count;
    await new Promise((r) => setTimeout(r, 20));
    // No more calls after stop.
    expect(calls.count).toBe(callsAtStop);
  });

  it("exceptions are logged, not thrown", async () => {
    const logs: string[] = [];
    const factory = async () => {
      throw new Error("logged error");
    };
    supervisedTask(factory, "logged", {
      maxRestarts: 1,
      sleep: async () => {},
      logger: (msg) => logs.push(msg),
    });
    await new Promise((r) => setTimeout(r, 20));
    // The error was logged, not thrown as an unhandled rejection.
    expect(logs.some((m) => m.includes("logged error"))).toBe(true);
    expect(logs.some((m) => m.includes("giving up"))).toBe(true);
  });
});

describe("[smoke] supervisedTask module", () => {
  it("exports supervisedTask", () => {
    expect(typeof supervisedTask).toBe("function");
  });
});
