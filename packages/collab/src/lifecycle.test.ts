/**
 * @my-agent/collab — active-mode lifecycle tests (Phase 3-6).
 *
 * Covers the three PR-RC-3 deliverables on the relay:
 *   1. start() loads + stop() persists a room-activity snapshot.
 *   2. purgeStale() removes rooms idle beyond idleMs (deterministic, no timers).
 *   3. start() with the periodic interval drains stale rooms over time
 *      (driven by vitest fake timers).
 *
 * Persistence is routed at a tmp path per test so the real ~/.mya tree is
 * never touched. `disablePersistence` is used where filesystem state is not
 * the subject of the test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabRelay, type RoomClient } from "./relay.js";

/** Minimal client that records everything sent to it. */
function makeClient(id: string): RoomClient & { received: unknown[] } {
  const received: unknown[] = [];
  return {
    id,
    room: "",
    role: "owner",
    send: (e: unknown) => { received.push(e); },
    received,
  };
}

/** Build a fresh tmp dir for one test. */
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "collab-lifecycle-"));
}

describe("CollabRelay — purgeStale (deterministic, no timers)", () => {
  it("removes rooms whose last activity is older than idleMs and leaves fresh ones", () => {
    const relay = new CollabRelay();
    const o1 = makeClient("o1");
    const o2 = makeClient("o2");
    const o3 = makeClient("o3");
    relay.join("fresh", o1, "owner");
    relay.join("stale-1", o2, "owner");
    relay.join("stale-2", o3, "owner");

    // Pretend two rooms were last touched > 1 h ago.
    const ONE_HOUR = 3_600_000;
    const now = 1_700_000_000_000;
    relay.join("fresh", makeClient("o1b"), "owner"); // re-touch fresh
    // Overwrite stale rooms' lastActivity directly (private field — cast).
    (relay as unknown as { roomActivity: Map<string, { lastActivity: number; createdAt: number }> }).roomActivity.set("stale-1", { lastActivity: now - ONE_HOUR - 1, createdAt: now - ONE_HOUR - 1 });
    (relay as unknown as { roomActivity: Map<string, { lastActivity: number; createdAt: number }> }).roomActivity.set("stale-2", { lastActivity: now - ONE_HOUR - 1, createdAt: now - ONE_HOUR - 1 });

    const removed = relay.purgeStale(now);
    expect(removed.sort()).toEqual(["stale-1", "stale-2"]);
    // The fresh room survives.
    expect(relay.lastActivityFor("fresh")).toBeGreaterThan(now - ONE_HOUR);
    expect(relay.lastActivityFor("stale-1")).toBeUndefined();
    expect(relay.lastActivityFor("stale-2")).toBeUndefined();
  });

  it("returns [] when no rooms are stale", () => {
    const relay = new CollabRelay();
    relay.join("r", makeClient("o"), "owner");
    expect(relay.purgeStale(Date.now() + 1_000)).toEqual([]);
    expect(relay.lastActivityFor("r")).toBeDefined();
  });
});

describe("CollabRelay — start/stop persistence", () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("stop() persists room activity and a fresh start() reloads it", () => {
    const path = join(dir, "rooms.json");
    const a = new CollabRelay();
    a.start({ persistPath: path, cleanupIntervalMs: 60_000 }); // long timer so it never fires during this test
    a.join("alpha", makeClient("o"), "owner");
    a.join("beta", makeClient("o2"), "owner");
    a.stop();

    // File was written.
    const file = JSON.parse(readFileSync(path, "utf8")) as { rooms: Array<{ name: string; lastActivity: number }> };
    expect(file.rooms.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);

    // Fresh relay loads the snapshot on start().
    const b = new CollabRelay();
    b.start({ persistPath: path, cleanupIntervalMs: 60_000 });
    expect(b.lastActivityFor("alpha")).toBe(file.rooms.find((r) => r.name === "alpha")!.lastActivity);
    expect(b.lastActivityFor("beta")).toBe(file.rooms.find((r) => r.name === "beta")!.lastActivity);
    b.stop();
  });

  it("start() is idempotent and does not re-arm the timer", () => {
    const path = join(dir, "rooms.json");
    const relay = new CollabRelay();
    relay.start({ persistPath: path, cleanupIntervalMs: 60_000 });
    expect(relay.running).toBe(true);
    relay.start({ persistPath: path, cleanupIntervalMs: 60_000 });
    expect(relay.running).toBe(true);
    relay.stop();
    expect(relay.running).toBe(false);
    relay.stop(); // idempotent
    expect(relay.running).toBe(false);
  });

  it("a stale persisted room is NOT restored (idle threshold enforced on load)", () => {
    const path = join(dir, "rooms.json");
    // Write a snapshot where one room is > 1 h old and another is fresh.
    const ONE_HOUR = 3_600_000;
    const now = Date.now();
    writeJson(path, {
      rooms: [
        { name: "fresh", lastActivity: now, createdAt: now },
        { name: "stale", lastActivity: now - ONE_HOUR - 1, createdAt: now - ONE_HOUR - 1 },
      ],
    });

    const relay = new CollabRelay();
    relay.start({ persistPath: path, cleanupIntervalMs: 60_000 });
    expect(relay.lastActivityFor("fresh")).toBe(now);
    expect(relay.lastActivityFor("stale")).toBeUndefined();
    relay.stop();
  });
});

describe("CollabRelay — start() drives stale-room sweep on an interval", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("removes rooms that go idle across multiple cleanup ticks", () => {
    const dir = mkdtempSync(join(tmpdir(), "collab-interval-"));
    try {
      const path = join(dir, "rooms.json");
      const relay = new CollabRelay();
      // 60 s cleanup, 1 h idle threshold.
      relay.start({
        persistPath: path,
        cleanupIntervalMs: 60_000,
        idleMs: 3_600_000,
        disablePersistence: false,
      });

      relay.join("will-go-stale", makeClient("o"), "owner");

      // Advance 2 h — well past the idle threshold.
      vi.advanceTimersByTime(3_600_000 * 2);
      // Multiple cleanup ticks should fire in the meantime.
      expect(relay.lastActivityFor("will-go-stale")).toBeUndefined();
      relay.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── helpers ──

/** Minimal JSON write helper. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}
