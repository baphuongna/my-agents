/**
 * @my-agent/memory/tier2-domains.test — Tier-2 M-1/M-2/M-3 domain tests (+12 tests).
 *
 * Coverage:
 *   - M-1 SyncDomain: tick monotonicity, receive merge, resolveConflict LWW,
 *     onRecord/onConsolidate pending-sync tracking (4 tests)
 *   - M-2 ToolsDomain: LRU eviction cap, TTL expiry, non-tool guard, topK limit (4 tests)
 *   - M-3 QueueDomain: BATCH_SIZE auto-flush, backpressure flush, timer flush,
 *     onConsolidate flush+count (4 tests)
 *
 * All tests use `new XDomain()` instances (not singletons) for isolation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Brain,
  SyncDomain,
  ToolsDomain,
  QueueDomain,
  compareHlc,
} from "@my-agent/memory";
import type { Fact, HlcTimestamp } from "@my-agent/memory";
import { setTimeProvider } from "@my-agent/core";

const FIXED_NOW = 1_700_000_000_000;
const realWallclock = () => Date.now();
const realMonotonic = () => (typeof performance !== "undefined" ? performance.now() * 1000 : Date.now());

const CACHE_TTL_MS = 30 * 60 * 1000; // must match tools.ts constant
const BATCH_SIZE = 20; // must match queue.ts constant
const BATCH_TIMEOUT_MS = 5000; // must match queue.ts constant
const MAX_QUEUE_DEPTH = 1000; // must match queue.ts constant

beforeEach(() => setTimeProvider({ nowWallclock: () => FIXED_NOW, nowMonotonic: () => FIXED_NOW }));
afterEach(() => setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic }));

// ── M-1: SyncDomain — HLC + LWW ─────────────────────────────────────────────

describe("SyncDomain (Tier-2 M-1) — HLC + LWW", () => {
  it("tick() returns monotonically increasing timestamps (counter bumps on tied wall)", () => {
    const d = new SyncDomain("node-a");
    d.init(new Brain());
    const t1 = d.tick();
    const t2 = d.tick();
    // Same wall clock (FIXED_NOW) → counter increments.
    expect(t2.wall).toBe(t1.wall);
    expect(t2.counter).toBe(t1.counter + 1);
    // Advance clock → wall jumps, counter resets.
    setTimeProvider({ nowWallclock: () => FIXED_NOW + 10_000, nowMonotonic: () => FIXED_NOW + 10_000 });
    const t3 = d.tick();
    expect(t3.wall).toBe(FIXED_NOW + 10_000);
    expect(t3.counter).toBe(0);
  });

  it("receive() merges remote HLC across all branches", () => {
    // Case 1: remote ahead (higher wall) → local adopts remote wall.
    const d1 = new SyncDomain("node-a");
    d1.init(new Brain());
    d1.receive({ wall: FIXED_NOW + 5000, counter: 3, node: "node-b" });
    let ts = d1.tick();
    expect(ts.wall).toBe(FIXED_NOW + 5000);
    expect(ts.counter).toBe(4); // 3 (remote) + 1 (tick)

    // Case 2: remote behind → local counter increments.
    const d2 = new SyncDomain("node-a");
    d2.init(new Brain());
    d2.receive({ wall: FIXED_NOW - 5000, counter: 0, node: "node-c" });
    ts = d2.tick();
    expect(ts.wall).toBe(FIXED_NOW);
    expect(ts.counter).toBeGreaterThanOrEqual(1);

    // Case 3: tied wall → counter = max(local, remote) + 1.
    const d3 = new SyncDomain("node-a");
    d3.init(new Brain());
    d3.receive({ wall: FIXED_NOW, counter: 5, node: "node-b" });
    ts = d3.tick();
    expect(ts.wall).toBe(FIXED_NOW);
    // receive: max(0, 5) + 1 = 6; tick: 6 + 1 = 7
    expect(ts.counter).toBe(7);
  });

  it("resolveConflict() returns the fact with the later HLC (LWW)", () => {
    const d = new SyncDomain("node-a");
    d.init(new Brain());
    const local = {
      id: "local", kind: "fact", entity: "e", content: "local version",
      visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
      hlc: { wall: FIXED_NOW, counter: 0, node: "node-a" },
    } as Fact & { hlc: HlcTimestamp };
    const remote = {
      id: "remote", kind: "fact", entity: "e", content: "remote version",
      visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
      hlc: { wall: FIXED_NOW + 1000, counter: 0, node: "node-b" },
    } as Fact & { hlc: HlcTimestamp };
    // Remote has later HLC → remote wins in both orderings.
    expect(d.resolveConflict(local, remote)).toBe(remote);
    expect(d.resolveConflict(remote, local)).toBe(remote);
    // compareHlc agrees with LWW direction.
    expect(compareHlc(remote.hlc, local.hlc)).toBeGreaterThan(0);
  });

  it("onRecord tracks pending sync + attaches HLC; onConsolidate flushes", () => {
    const brain = new Brain();
    const d = new SyncDomain("node-a");
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" });
    d.onRecord(f);
    // HLC metadata attached.
    expect((f as Fact & { hlc?: HlcTimestamp }).hlc).toBeDefined();
    // recall reports pending count.
    const hits = d.recall("");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toContain("1 pending");
    // onConsolidate flushes.
    expect(d.onConsolidate(FIXED_NOW)).toEqual({ promoted: 0, consumed: 1 });
    expect(d.recall("")).toEqual([]);
  });
});

// ── M-2: ToolsDomain — Bounded LRU Cache with TTL ───────────────────────────

describe("ToolsDomain (Tier-2 M-2) — LRU + TTL", () => {
  it("LRU eviction caps cache at MAX_CACHE_SIZE (500)", () => {
    const d = new ToolsDomain();
    d.init(new Brain());
    for (let i = 0; i < 501; i++) {
      d.onRecord({
        id: `tool-${i}`, kind: "fact", entity: "e", content: `result ${i}`,
        visibility: "private", notability: 1, source: "tool", createdAt: FIXED_NOW + i,
      });
    }
    expect(d.size()).toBe(500);
    // The oldest entry (tool-0) was evicted; the newest (tool-500) survives.
    const hits = d.recall("result 500");
    expect(hits).toHaveLength(1);
    const gone = d.recall("result 0");
    expect(gone).toHaveLength(0);
  });

  it("TTL expiry: entries older than CACHE_TTL_MS are evicted on recall + onConsolidate", () => {
    const d = new ToolsDomain();
    d.init(new Brain());
    d.onRecord({
      id: "t1", kind: "fact", entity: "e", content: "old result",
      visibility: "private", notability: 1, source: "tool", createdAt: FIXED_NOW - CACHE_TTL_MS - 1,
    });
    // recall at FIXED_NOW finds the entry expired → evicted lazily.
    expect(d.recall("old")).toEqual([]);
    expect(d.size()).toBe(0);
    // onConsolidate on a fresh expired entry also evicts.
    const d2 = new ToolsDomain();
    d2.init(new Brain());
    d2.onRecord({
      id: "t2", kind: "fact", entity: "e", content: "stale",
      visibility: "private", notability: 1, source: "tool", createdAt: FIXED_NOW - CACHE_TTL_MS - 1,
    });
    expect(d2.onConsolidate(FIXED_NOW).consumed).toBe(1);
    expect(d2.size()).toBe(0);
  });

  it("non-tool-sourced facts are ignored (no cache entry)", () => {
    const d = new ToolsDomain();
    d.init(new Brain());
    d.onRecord({
      id: "u1", kind: "fact", entity: "e", content: "user content",
      visibility: "private", notability: 1, source: "user", createdAt: FIXED_NOW,
    });
    expect(d.size()).toBe(0);
  });

  it("recall respects topK limit", () => {
    const d = new ToolsDomain();
    d.init(new Brain());
    for (let i = 0; i < 3; i++) {
      d.onRecord({
        id: `t${i}`, kind: "fact", entity: "e", content: `match ${i}`,
        visibility: "private", notability: 1, source: "tool", createdAt: FIXED_NOW + i,
      });
    }
    const hits = d.recall("match", { topK: 2 });
    expect(hits).toHaveLength(2);
  });
});

// ── M-3: QueueDomain — Batch Write Queue with Backpressure ──────────────────

describe("QueueDomain (Tier-2 M-3) — batch + backpressure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-flush when buffer reaches BATCH_SIZE", () => {
    vi.useFakeTimers();
    const d = new QueueDomain();
    d.init(new Brain());
    for (let i = 0; i < BATCH_SIZE; i++) {
      d.onRecord({
        id: `f${i}`, kind: "fact", entity: "e", content: `item ${i}`,
        visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
      });
    }
    // The BATCH_SIZE-th record triggers flush → buffer is empty.
    expect(d.bufferSize()).toBe(0);
  });

  it("backpressure flush when buffer reaches MAX_QUEUE_DEPTH", () => {
    vi.useFakeTimers();
    const d = new QueueDomain();
    d.init(new Brain());
    // Pre-fill buffer to capacity (bypassing BATCH_SIZE auto-flush).
    const internal = d as unknown as { buffer: Fact[] };
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      internal.buffer.push({
        id: `pre-${i}`, kind: "fact", entity: "e", content: `pre ${i}`,
        visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
      });
    }
    expect(d.bufferSize()).toBe(MAX_QUEUE_DEPTH);
    // Next onRecord triggers backpressure flush, then pushes the new fact.
    d.onRecord({
      id: "trigger", kind: "fact", entity: "e", content: "trigger",
      visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
    });
    expect(d.bufferSize()).toBe(1);
  });

  it("timer-based flush after BATCH_TIMEOUT_MS idle", () => {
    vi.useFakeTimers();
    const d = new QueueDomain();
    d.init(new Brain());
    d.onRecord({
      id: "f0", kind: "fact", entity: "e", content: "item 0",
      visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
    });
    expect(d.bufferSize()).toBe(1);
    // Advance past BATCH_TIMEOUT_MS → timer callback fires flush.
    vi.advanceTimersByTime(BATCH_TIMEOUT_MS);
    expect(d.bufferSize()).toBe(0);
  });

  it("onConsolidate flushes buffer and returns consumed count", () => {
    vi.useFakeTimers();
    const d = new QueueDomain();
    d.init(new Brain());
    for (let i = 0; i < 5; i++) {
      d.onRecord({
        id: `f${i}`, kind: "fact", entity: "e", content: `item ${i}`,
        visibility: "private", notability: 1, source: "s", createdAt: FIXED_NOW,
      });
    }
    // 5 < BATCH_SIZE → no auto-flush.
    expect(d.bufferSize()).toBe(5);
    const r = d.onConsolidate(FIXED_NOW);
    expect(r).toEqual({ promoted: 0, consumed: 5 });
    expect(d.bufferSize()).toBe(0);
  });
});
