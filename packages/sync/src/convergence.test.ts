/**
 * @my-agent/sync — multi-replica CRDT convergence tests (§23 #5).
 *
 * Validates the core correctness property of the LWW+HLC store: replicas that
 * communicate only through a central SyncServer (star topology) eventually
 * converge to identical *live* state — including under concurrent writes,
 * network partitions, wall-clock skew, and tombstone deletes.
 *
 * The network layer is mocked by invoking push/pull/syncRound directly (no
 * HTTP). No source files are modified by this suite.
 */
import { describe, it, expect } from "vitest";
import { compareHlc, SyncReplica, SyncServer, syncRound } from "./index.js";
import type { Versioned } from "./index.js";

/**
 * Drive a set of replicas to convergence through the server (star topology).
 * Repeats full sync rounds until a round produces no changes, or maxRounds.
 * After this returns, every replica's live state equals the server's state.
 *
 * Termination/safety: merge() only accepts an entry whose HLC is *strictly*
 * greater than the local one, and HLCs include a unique node id (so two
 * entries from different replicas never tie). Once the server holds the union
 * and every replica has pulled it, no further changes occur → the loop exits.
 */
async function converge(replicas: SyncReplica[], server: SyncServer, maxRounds = 10): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    let changes = 0;
    for (const r of replicas) {
      const res = await syncRound(r, server);
      changes += res.pushed + res.pulled;
    }
    if (changes === 0) return;
  }
}

/** Fetch a single (possibly tombstoned) entry from a replica, throwing if absent. */
function entryFor(r: SyncReplica, key: string): Versioned {
  const e = r.export().find((x) => x.key === key);
  if (!e) throw new Error(`replica ${r.nodeId} has no entry for key "${key}"`);
  return e;
}

describe("multi-replica convergence", () => {
  it("two replicas writing different keys converge to the union of writes", async () => {
    const server = new SyncServer();
    const a = new SyncReplica("a");
    const b = new SyncReplica("b");

    a.set("name", "alice");
    b.set("city", "paris");

    // Pre-sync: each replica is ignorant of the other's write.
    expect(a.get("city")).toBeUndefined();
    expect(b.get("name")).toBeUndefined();

    await converge([a, b], server);

    // Post-sync: both replicas hold the union, and match the authority.
    expect(a.get("name")).toBe("alice");
    expect(a.get("city")).toBe("paris");
    expect(b.get("name")).toBe("alice");
    expect(b.get("city")).toBe("paris");
    expect(a.equals(b)).toBe(true);
    expect(server.replicaState.equals(a)).toBe(true);
  });

  it("concurrent writes to the same key resolve to the LWW winner on both replicas", async () => {
    const server = new SyncServer();
    const a = new SyncReplica("a");
    const b = new SyncReplica("b");

    // Both replicas write the SAME key "concurrently" (no sync in between).
    a.set("shared", "from-a");
    b.set("shared", "from-b");

    // Derive the deterministic LWW winner straight from the stamped HLCs.
    const aEntry = entryFor(a, "shared");
    const bEntry = entryFor(b, "shared");
    const winner = compareHlc(aEntry.hlc, bEntry.hlc) > 0 ? aEntry : bEntry;

    await converge([a, b], server);

    // CRDT correctness: both replicas agree on a single value...
    expect(a.get("shared")).toBe(b.get("shared"));
    // ...and that value is exactly the HLC-greater (last-writer-wins) write.
    expect(a.get("shared")).toBe(winner.value);
    expect(b.get("shared")).toBe(winner.value);
    expect(a.equals(b)).toBe(true);
  });

  it("writes made during a partition propagate after reconnection (heal)", async () => {
    const server = new SyncServer();
    const a = new SyncReplica("a");
    const b = new SyncReplica("b");

    // Establish a shared baseline while "connected".
    a.set("baseline", 1);
    await converge([a, b], server);
    expect(b.get("baseline")).toBe(1);

    // --- PARTITION: A mutates locally with no sync round (link down) ---
    a.set("partitioned", "only-a-knows");
    expect(b.get("partitioned")).toBeUndefined();

    // --- HEAL: link restored; run sync rounds to convergence ---
    await converge([a, b], server);

    expect(b.get("partitioned")).toBe("only-a-knows");
    expect(a.equals(b)).toBe(true);
  });

  it("clock-skewed replica still orders by HLC, not wall-clock arrival", async () => {
    const server = new SyncServer();
    // A starts from the default seed (epoch 0); first tick jumps to real now.
    const a = new SyncReplica("a");
    // B is seeded with a wall far in the future to simulate positive skew.
    // Picked well beyond any plausible real now() so the test is deterministic.
    const skewedWall = 9_999_999_999_999; // ≈ year 2286 in epoch ms
    const b = new SyncReplica("b", { wall: skewedWall, counter: 0, node: "b" });

    a.set("k", "from-a");
    b.set("k", "from-b");

    // B's write carries the skewed (much larger) wall, so by HLC order it is
    // strictly greater than A's, regardless of real-time write ordering.
    const aEntry = entryFor(a, "k");
    const bEntry = entryFor(b, "k");
    expect(compareHlc(bEntry.hlc, aEntry.hlc)).toBeGreaterThan(0);

    await converge([a, b], server);

    // LWW follows HLC: the skewed replica's value wins on both sides.
    expect(a.get("k")).toBe("from-b");
    expect(b.get("k")).toBe("from-b");
    expect(a.equals(b)).toBe(true);
  });

  it("a delete propagates as a tombstone and hides the key on the peer replica", async () => {
    const server = new SyncServer();
    const a = new SyncReplica("a");
    const b = new SyncReplica("b");

    // Seed the key on both replicas first.
    a.set("doomed", "alive");
    await converge([a, b], server);
    expect(b.get("doomed")).toBe("alive");

    // A tombstones the key with a strictly newer HLC.
    a.delete("doomed");
    const tombstone = entryFor(a, "doomed");
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.value).toBeNull();

    // Pre-sync: B still observes the live value.
    expect(b.get("doomed")).toBe("alive");

    await converge([a, b], server);

    // Post-sync: the tombstone wins on B — the key is hidden from live view.
    expect(b.get("doomed")).toBeUndefined();
    const bEntry = entryFor(b, "doomed");
    expect(bEntry.deleted).toBe(true);
    expect(bEntry.value).toBeNull();
    // Live-state size excludes the tombstoned key on both replicas.
    expect(b.size).toBe(0);
    expect(a.size).toBe(0);
    expect(a.equals(b)).toBe(true);
  });
});
