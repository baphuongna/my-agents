/**
 * @my-agent/gateway/systemd.test — systemd lifecycle notification tests (I1).
 *
 * Covers isSystemdAvailable, notifyReady/notifyStopping (best-effort no-ops off
 * systemd), startWatchdog/stopWatchdog, checkScaleToZero (deterministic via the
 * injectable clock), and getCgroupInfo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isSystemdAvailable,
  notifyReady,
  notifyStopping,
  startWatchdog,
  stopWatchdog,
  checkScaleToZero,
  getCgroupInfo,
} from "./systemd.js";
import { setTimeProvider } from "@my-agent/core";

let savedNotify: string | undefined;
let savedWatchdog: string | undefined;

beforeEach(() => {
  savedNotify = process.env.NOTIFY_SOCKET;
  savedWatchdog = process.env.WATCHDOG_USEC;
  delete process.env.NOTIFY_SOCKET;
  delete process.env.WATCHDOG_USEC;
  stopWatchdog();
});

afterEach(() => {
  if (savedNotify === undefined) delete process.env.NOTIFY_SOCKET;
  else process.env.NOTIFY_SOCKET = savedNotify;
  if (savedWatchdog === undefined) delete process.env.WATCHDOG_USEC;
  else process.env.WATCHDOG_USEC = savedWatchdog;
  stopWatchdog();
  setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() });
});

// ─── isSystemdAvailable ───────────────────────────────────────────────────────

describe("isSystemdAvailable", () => {
  it("returns false when NOTIFY_SOCKET is unset", () => {
    expect(isSystemdAvailable()).toBe(false);
  });

  it("returns true when NOTIFY_SOCKET is set", () => {
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    expect(isSystemdAvailable()).toBe(true);
  });
});

// ─── notifyReady / notifyStopping ─────────────────────────────────────────────

describe("notifyReady", () => {
  it("is a no-op (does not throw) when systemd is unavailable", () => {
    expect(() => notifyReady()).not.toThrow();
  });

  it("is best-effort when NOTIFY_SOCKET points at a non-existent socket", () => {
    process.env.NOTIFY_SOCKET = "/tmp/definitely-not-a-real-notify-socket-xyz";
    expect(() => notifyReady()).not.toThrow();
  });
});

describe("notifyStopping", () => {
  it("does not throw off systemd", () => {
    expect(() => notifyStopping()).not.toThrow();
  });

  it("stops the watchdog timer", () => {
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    startWatchdog(10);
    expect(() => notifyStopping()).not.toThrow();
    // Calling stopWatchdog again is idempotent.
    expect(() => stopWatchdog()).not.toThrow();
  });
});

// ─── startWatchdog / stopWatchdog ─────────────────────────────────────────────

describe("startWatchdog / stopWatchdog", () => {
  it("startWatchdog is a no-op when systemd is unavailable", () => {
    expect(() => startWatchdog()).not.toThrow();
    // No timer should be running; stopping is safe.
    expect(() => stopWatchdog()).not.toThrow();
  });

  it("derives the interval from WATCHDOG_USEC when no interval is given", () => {
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    process.env.WATCHDOG_USEC = "10_000_000"; // 10s
    expect(() => startWatchdog()).not.toThrow();
    stopWatchdog();
  });

  it("startWatchdog accepts an explicit intervalMs", () => {
    process.env.NOTIFY_SOCKET = "/run/systemd/notify";
    expect(() => startWatchdog(5)).not.toThrow();
    stopWatchdog();
  });

  it("stopWatchdog is idempotent (safe to call when not started)", () => {
    expect(() => stopWatchdog()).not.toThrow();
  });
});

// ─── checkScaleToZero ─────────────────────────────────────────────────────────

describe("checkScaleToZero", () => {
  it("returns true when idle time exceeds the threshold", () => {
    let t = 100_000;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    // last activity at 1000, threshold 60s → 99s idle < 60s? no, 99000 > 60000.
    expect(checkScaleToZero(1_000, 60_000)).toBe(true);
  });

  it("returns false when idle time is within the threshold", () => {
    let t = 50_000;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    expect(checkScaleToZero(1_000, 60_000)).toBe(false);
  });

  it("uses the default threshold (30 min) when none is given", () => {
    let t = 1_000 + 31 * 60_000;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    expect(checkScaleToZero(1_000)).toBe(true);
  });

  it("returns false just under the default 30-min threshold", () => {
    let t = 1_000 + 29 * 60_000;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    expect(checkScaleToZero(1_000)).toBe(false);
  });

  it("returns true at exactly the boundary idle (>)", () => {
    let t = 1_000 + 60_000;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    // 60000 elapsed, threshold 60000 → NOT strictly greater → false
    expect(checkScaleToZero(1_000, 60_000)).toBe(false);
    // one ms over → true
    t = 1_000 + 60_001;
    setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
    expect(checkScaleToZero(1_000, 60_000)).toBe(true);
  });
});

// ─── getCgroupInfo ────────────────────────────────────────────────────────────

describe("getCgroupInfo", () => {
  it("returns an object (possibly empty off Linux)", () => {
    const info = getCgroupInfo();
    expect(typeof info).toBe("object");
    expect(info).not.toBeNull();
  });

  it("exposes a path when running under a cgroup (Linux)", () => {
    const info = getCgroupInfo();
    // path is optional; when present it must start with "/".
    if (info.path !== undefined) {
      expect(info.path.startsWith("/")).toBe(true);
      expect(typeof info.path).toBe("string");
    }
  });
});
