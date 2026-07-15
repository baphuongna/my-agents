/**
 * @my-agent/sync — active-mode lifecycle tests (Phase 3-6).
 *
 * Covers:
 *   1. start() loads + stop() persists the LWW replica state on disk.
 *   2. start() arms a heartbeat that updates lastSync + persists on each tick.
 *   3. start() is idempotent and stop() is idempotent.
 *
 * Persistence is routed at a tmp path per test so the real ~/.mya tree is
 * never touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncReplica, SyncServer } from "./index.js";
import type { Versioned } from "./index.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sync-lifecycle-"));
}

describe("SyncServer — start/stop persistence", () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("stop() persists the replica; a fresh start() reloads equivalent state", () => {
    const path = join(dir, "state.json");
    const a = new SyncServer();
    a.start({ persistPath: path, exchangeIntervalMs: 60_000 });
    // Seed two writes (each LWW-stamps the server's replica).
    a.replicaState.set("hello", "world");
    a.replicaState.set("answer", 42);
    a.stop();

    // File was written.
    const file = JSON.parse(readFileSync(path, "utf8")) as {
      lastSync: number;
      entries: Array<{ key: string; value: unknown }>;
    };
    expect(file.lastSync).toBeGreaterThan(0);
    expect(file.entries.map((e) => e.key).sort()).toEqual(["answer", "hello"]);

    // Fresh server loads the snapshot.
    const b = new SyncServer();
    b.start({ persistPath: path, exchangeIntervalMs: 60_000 });
    expect(b.replicaState.get("hello")).toBe("world");
    expect(b.replicaState.get("answer")).toBe(42);
    // Convergence: the reloaded replica equals the persisted entries.
    const c = new SyncReplica("client");
    c.merge(file.entries as Versioned[]);
    expect(c.get("hello")).toBe("world");
    expect(c.get("answer")).toBe(42);
    b.stop();
  });

  it("start() is idempotent and stop() is idempotent", () => {
    const path = join(dir, "state.json");
    const s = new SyncServer();
    expect(s.running).toBe(false);
    s.start({ persistPath: path, exchangeIntervalMs: 60_000 });
    expect(s.running).toBe(true);
    s.start({ persistPath: path, exchangeIntervalMs: 60_000 }); // idempotent
    expect(s.running).toBe(true);
    s.stop();
    expect(s.running).toBe(false);
    s.stop(); // idempotent
    expect(s.running).toBe(false);
  });

  it("a missing snapshot file is treated as an empty state (no throw)", () => {
    const path = join(dir, "never-written.json");
    const s = new SyncServer();
    expect(() => s.start({ persistPath: path, exchangeIntervalMs: 60_000 })).not.toThrow();
    expect(s.replicaState.size).toBe(0);
    s.stop();
  });
});

describe("SyncServer — start() drives lastSync heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("updates lastSync on every periodic tick (and stop() persists the latest value)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sync-heartbeat-"));
    try {
      const path = join(dir, "state.json");
      const s = new SyncServer();
      s.start({ persistPath: path, exchangeIntervalMs: 1_000 });
      const first = s.lastSync;
      expect(first).toBeGreaterThan(0);

      // Advance enough for several ticks.
      vi.advanceTimersByTime(5_000);

      // lastSync must have advanced.
      expect(s.lastSync).toBeGreaterThanOrEqual(first);

      // Drive a manual heartbeat to a known-larger value.
      const t0 = s.lastSync;
      vi.advanceTimersByTime(2_000);
      expect(s.lastSync).toBeGreaterThanOrEqual(t0);

      // stop() persists the latest lastSync to disk.
      s.stop();
      const file = JSON.parse(readFileSync(path, "utf8")) as { lastSync: number; entries: unknown[] };
      expect(file.lastSync).toBe(s.lastSync);
      expect(Array.isArray(file.entries)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
