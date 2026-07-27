import { describe, it, expect } from "vitest";
import { InMemoryBrainStorage } from "./brain-storage.js";
import { Brain } from "./brain.js";
import { LifecycleManager } from "./lifecycle.js";
import { SyncDomain } from "./domains/sync.js";
import type { Fact, Take, BrainPage } from "./brain.js";

/** Helper: create a minimal Fact for testing. */
function makeFact(id: string, content = "test content"): Fact {
  return {
    id,
    kind: "fact",
    entity: "TestEntity",
    content,
    visibility: "private",
    notability: 1,
    source: "test",
    createdAt: 1000,
  };
}

function makeTake(id: string): Take {
  return {
    id,
    sources: ["fact1"],
    entity: "TestEntity",
    text: "synthesized take",
    synthesizedAt: 1000,
  };
}

function makePage(id: string): BrainPage {
  return {
    id,
    slug: "test-slug",
    compiledTruth: "compiled truth",
    source: "test",
    createdAt: 1000,
    version: 1,
  };
}

// ── Facts CRUD ────────────────────────────────────────────────────────────

describe("InMemoryBrainStorage — Facts CRUD", () => {
  it("putFact → getFact returns the same fact", () => {
    const storage = new InMemoryBrainStorage();
    const f = makeFact("f1");
    storage.putFact(f);
    expect(storage.getFact("f1")).toBe(f);
  });

  it("getFact returns undefined for unknown id", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.getFact("nope")).toBeUndefined();
  });

  it("deleteFact removes the fact and returns true", () => {
    const storage = new InMemoryBrainStorage();
    storage.putFact(makeFact("f1"));
    expect(storage.deleteFact("f1")).toBe(true);
    expect(storage.getFact("f1")).toBeUndefined();
  });

  it("deleteFact returns false for unknown id", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.deleteFact("nope")).toBe(false);
  });

  it("factCount reflects puts and deletes", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.factCount).toBe(0);
    storage.putFact(makeFact("f1"));
    storage.putFact(makeFact("f2"));
    expect(storage.factCount).toBe(2);
    storage.deleteFact("f1");
    expect(storage.factCount).toBe(1);
  });

  it("allFacts iterates all facts", () => {
    const storage = new InMemoryBrainStorage();
    storage.putFact(makeFact("f1", "alpha"));
    storage.putFact(makeFact("f2", "beta"));
    const ids = [...storage.allFacts()].map((f) => f.id).sort();
    expect(ids).toEqual(["f1", "f2"]);
  });
});

// ── Takes CRUD ────────────────────────────────────────────────────────────

describe("InMemoryBrainStorage — Takes CRUD", () => {
  it("putTake → getTake returns it", () => {
    const storage = new InMemoryBrainStorage();
    const t = makeTake("t1");
    storage.putTake(t);
    expect(storage.getTake("t1")).toBe(t);
  });

  it("getTake returns undefined for unknown id", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.getTake("nope")).toBeUndefined();
  });

  it("takeCount is correct", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.takeCount).toBe(0);
    storage.putTake(makeTake("t1"));
    storage.putTake(makeTake("t2"));
    expect(storage.takeCount).toBe(2);
  });

  it("allTakes iterates all takes", () => {
    const storage = new InMemoryBrainStorage();
    storage.putTake(makeTake("t1"));
    storage.putTake(makeTake("t2"));
    const ids = [...storage.allTakes()].map((t) => t.id).sort();
    expect(ids).toEqual(["t1", "t2"]);
  });
});

// ── Pages CRUD ────────────────────────────────────────────────────────────

describe("InMemoryBrainStorage — Pages CRUD", () => {
  it("putPage → getPage returns it", () => {
    const storage = new InMemoryBrainStorage();
    const p = makePage("p1");
    storage.putPage(p);
    expect(storage.getPage("p1")).toBe(p);
  });

  it("getPage returns undefined for unknown id", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.getPage("nope")).toBeUndefined();
  });

  it("allPages iterates all pages", () => {
    const storage = new InMemoryBrainStorage();
    storage.putPage(makePage("p1"));
    storage.putPage(makePage("p2"));
    const ids = [...storage.allPages()].map((p) => p.id).sort();
    expect(ids).toEqual(["p1", "p2"]);
  });
});

// ── Tombstones CRUD ───────────────────────────────────────────────────────

describe("InMemoryBrainStorage — Tombstones CRUD", () => {
  it("putTombstone → getTombstone returns it", () => {
    const storage = new InMemoryBrainStorage();
    const f = makeFact("f1");
    storage.putTombstone("f1", { fact: f, deletedAt: 5000 });
    expect(storage.getTombstone("f1")?.fact).toBe(f);
    expect(storage.getTombstone("f1")?.deletedAt).toBe(5000);
  });

  it("getTombstone returns undefined for unknown id", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.getTombstone("nope")).toBeUndefined();
  });

  it("deleteTombstone removes and returns true", () => {
    const storage = new InMemoryBrainStorage();
    storage.putTombstone("f1", { fact: makeFact("f1"), deletedAt: 5000 });
    expect(storage.deleteTombstone("f1")).toBe(true);
    expect(storage.getTombstone("f1")).toBeUndefined();
  });

  it("deleteTombstone returns false for unknown id", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.deleteTombstone("nope")).toBe(false);
  });

  it("tombstoneCount is correct", () => {
    const storage = new InMemoryBrainStorage();
    expect(storage.tombstoneCount).toBe(0);
    storage.putTombstone("f1", { fact: makeFact("f1"), deletedAt: 5000 });
    storage.putTombstone("f2", { fact: makeFact("f2"), deletedAt: 5000 });
    expect(storage.tombstoneCount).toBe(2);
  });

  it("allTombstones iterates [id, entry] pairs", () => {
    const storage = new InMemoryBrainStorage();
    storage.putTombstone("f1", { fact: makeFact("f1"), deletedAt: 5000 });
    storage.putTombstone("f2", { fact: makeFact("f2"), deletedAt: 6000 });
    const entries = [...storage.allTombstones()];
    expect(entries.length).toBe(2);
    const ids = entries.map(([id]) => id).sort();
    expect(ids).toEqual(["f1", "f2"]);
  });
});

// ── GAP-1 Persistence Tests ───────────────────────────────────────────────

describe("InMemoryBrainStorage — GAP-1 same-reference semantics", () => {
  it("GAP-1: in-place embed mutation is visible via getFact without re-putting", () => {
    const storage = new InMemoryBrainStorage();
    const f = makeFact("f1");
    storage.putFact(f);
    // Simulate Brain.embed() in-place mutation (no re-put)
    f.embedded = true;
    // Same-reference: getFact returns the SAME object
    expect(storage.getFact("f1")?.embedded).toBe(true);
  });

  it("GAP-1: in-place consolidate mutation is visible via getFact without re-putting", () => {
    const storage = new InMemoryBrainStorage();
    const f = makeFact("f1");
    storage.putFact(f);
    // Simulate Brain.consolidate() in-place mutations (no re-put)
    f.consolidatedAt = 9999;
    f.consolidatedInto = "take-xyz";
    // Same-reference: getFact returns the SAME object with mutated fields
    expect(storage.getFact("f1")?.consolidatedAt).toBe(9999);
    expect(storage.getFact("f1")?.consolidatedInto).toBe("take-xyz");
  });

  it("GAP-1: explicit putFact after mutation is idempotent (same ref re-set)", () => {
    const storage = new InMemoryBrainStorage();
    const f = makeFact("f1");
    storage.putFact(f);
    f.embedded = true;
    storage.putFact(f); // what the GAP-1 fix adds — idempotent for InMemory
    expect(storage.getFact("f1")?.embedded).toBe(true);
    expect(storage.factCount).toBe(1); // still one fact
  });
});

// ── Live Iterator Semantics ───────────────────────────────────────────────

describe("InMemoryBrainStorage — live iterator semantics", () => {
  it("allFacts() reflects in-place mutations through the iterator", () => {
    const storage = new InMemoryBrainStorage();
    storage.putFact(makeFact("f1", "alpha"));
    storage.putFact(makeFact("f2", "beta"));
    // Mutate through the iterator
    for (const f of storage.allFacts()) {
      f.embedded = true;
    }
    // Re-iterate — mutations must be visible (live iterator, not a copy)
    const all = [...storage.allFacts()];
    expect(all.every((f) => f.embedded === true)).toBe(true);
  });

  it("allFacts() is a live iterator (not a snapshot copy)", () => {
    const storage = new InMemoryBrainStorage();
    storage.putFact(makeFact("f1"));
    const iter1 = [...storage.allFacts()];
    expect(iter1.length).toBe(1);
    // Add another fact and re-iterate
    storage.putFact(makeFact("f2"));
    const iter2 = [...storage.allFacts()];
    expect(iter2.length).toBe(2);
  });

  it("allTombstones() is a live iterator", () => {
    const storage = new InMemoryBrainStorage();
    storage.putTombstone("f1", { fact: makeFact("f1"), deletedAt: 5000 });
    const first = [...storage.allTombstones()];
    expect(first.length).toBe(1);
    storage.putTombstone("f2", { fact: makeFact("f2"), deletedAt: 5000 });
    const second = [...storage.allTombstones()];
    expect(second.length).toBe(2);
  });
});

// ── loadFromSnapshot ──────────────────────────────────────────────────────

describe("InMemoryBrainStorage — loadFromSnapshot", () => {
  it("clears existing state and reloads from snapshot", () => {
    const storage = new InMemoryBrainStorage();
    // Pre-populate with some data
    storage.putFact(makeFact("old-fact"));
    storage.putTake(makeTake("old-take"));

    // Load from snapshot
    storage.loadFromSnapshot({
      facts: [makeFact("f1"), makeFact("f2")],
      takes: [makeTake("t1")],
      pages: [makePage("p1")],
      tombstones: [["ts1", { fact: makeFact("ts1"), deletedAt: 5000 }]],
    });

    // Old data is gone
    expect(storage.getFact("old-fact")).toBeUndefined();
    expect(storage.getTake("old-take")).toBeUndefined();

    // New data is present
    expect(storage.factCount).toBe(2);
    expect(storage.takeCount).toBe(1);
    expect(storage.tombstoneCount).toBe(1);
    expect(storage.getPage("p1")).toBeDefined();
    expect(storage.getFact("f1")).toBeDefined();
    expect(storage.getTake("t1")).toBeDefined();
    expect(storage.getTombstone("ts1")).toBeDefined();
  });

  it("accepts Map values() and entries() as iterables", () => {
    const factsMap = new Map([["f1", makeFact("f1")], ["f2", makeFact("f2")]]);
    const takesMap = new Map([["t1", makeTake("t1")]]);
    const pagesMap = new Map([["p1", makePage("p1")]]);
    const tombstonesMap = new Map([["ts1", { fact: makeFact("ts1"), deletedAt: 5000 }]]);

    const storage = new InMemoryBrainStorage();
    storage.loadFromSnapshot({
      facts: factsMap.values(),
      takes: takesMap.values(),
      pages: pagesMap.values(),
      tombstones: tombstonesMap.entries(),
    });

    expect(storage.factCount).toBe(2);
    expect(storage.takeCount).toBe(1);
    expect(storage.tombstoneCount).toBe(1);
  });
});

// ── getFactMap ────────────────────────────────────────────────────────────

describe("InMemoryBrainStorage — getFactMap", () => {
  it("returns a live ReadonlyMap of all facts", () => {
    const storage = new InMemoryBrainStorage();
    const f1 = makeFact("f1");
    storage.putFact(f1);
    const map = storage.getFactMap();
    expect(map.get("f1")).toBe(f1);
    expect(map.has("f1")).toBe(true);
    expect(map.size).toBe(1);
  });

  it("reflects mutations made through putFact", () => {
    const storage = new InMemoryBrainStorage();
    const map = storage.getFactMap();
    expect(map.size).toBe(0);
    storage.putFact(makeFact("f1"));
    expect(map.size).toBe(1); // live map reflects the addition
  });
});

// ── Brain ↔ BrainStorage seam: GAP-1 verification (A-GATE-2/3) ─────────────
// Closes the coverage gap flagged by the post-Phase-A cold review: with
// InMemoryBrainStorage a missing putFact is INVISIBLE (same-reference no-op),
// so the GAP-1 contract (every in-place Fact mutation is persisted through the
// seam) must be verified by injecting a spy BrainStorage into a real Brain.

/** Spy BrainStorage: wraps InMemoryBrainStorage, counts putFact/putTake calls. */
class SpyBrainStorage extends InMemoryBrainStorage {
  putFactCount = 0;
  putTakeCount = 0;
  override putFact(fact: Fact): void { this.putFactCount++; super.putFact(fact); }
  override putTake(take: Take): void { this.putTakeCount++; super.putTake(take); }
  reset(): void { this.putFactCount = 0; this.putTakeCount = 0; }
}

describe("Brain ↔ BrainStorage seam — GAP-1 verification (A-GATE-2/3)", () => {
  it("A-GATE-3: Brain.consolidate() persists every in-place mutation via storage.putFact", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy); // minFactsPerBucket=3, cosineThreshold=0.85
    // 3 identical facts in the same (source, entity) bucket → a cosine-1.0 cluster.
    for (let i = 0; i < 3; i++) {
      brain.recordFact({ kind: "fact", entity: "e", content: "alpha beta gamma", visibility: "private", notability: 1, source: "s" });
    }
    spy.reset(); // discard recordFact's own putFact calls
    const result = brain.consolidate();
    expect(result.takesPromoted).toBe(1);
    expect(result.factsConsumed).toBeGreaterThanOrEqual(2);
    // GAP-1 contract: every consolidated fact's in-place mutation is persisted through the seam.
    expect(spy.putFactCount).toBe(result.factsConsumed);
    expect(spy.putTakeCount).toBe(1);
  });

  it("A-GATE-2: Brain.embed() persists in-place mutation via storage.putFact", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "e", content: "y", visibility: "private", notability: 1, source: "s" });
    spy.reset();
    expect(brain.embed()).toBe(2);
    // GAP-1 contract: embed persists each newly-embedded fact through the seam.
    expect(spy.putFactCount).toBe(2);
  });

  it("embed() is idempotent — no putFact when nothing new to embed", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    brain.embed(); // mark embedded
    spy.reset();
    expect(brain.embed()).toBe(0);
    expect(spy.putFactCount).toBe(0);
  });
});

// ── GAP-1 sites 3-4: touchFact seam notification (B-Phase Part 1) ───────────
// lifecycle.recordAccess (site 3) + SyncDomain.onRecord (site 4) mutate Fact
// fields in-place. Under InMemoryBrainStorage this is invisible (same ref),
// but a write-through store MUST be notified. These spy tests verify the seam.

describe("Brain.touchFact — GAP-1 sites 3-4 seam notification", () => {
  it("touchFact applies the patch and calls storage.putFact", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    spy.reset();
    expect(brain.touchFact(f.id, { accessCount: 5, lastAccessedAt: 999 })).toBe(true);
    expect(spy.putFactCount).toBe(1);
    const got = brain.allFacts.get(f.id)!;
    expect(got.accessCount).toBe(5);
    expect(got.lastAccessedAt).toBe(999);
  });

  it("touchFact with no patch re-flushes the existing fact", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    spy.reset();
    // Simulate an in-place mutation by the caller.
    f.embedded = true;
    expect(brain.touchFact(f.id)).toBe(true);
    expect(spy.putFactCount).toBe(1);
  });

  it("touchFact returns false for unknown id", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    spy.reset();
    expect(brain.touchFact("nonexistent", { accessCount: 1 })).toBe(false);
    expect(spy.putFactCount).toBe(0);
  });
});

describe("GAP-1 site 3: LifecycleManager.recordAccess notifies the seam", () => {
  it("recordAccess calls storage.putFact with incremented accessCount + lastAccessedAt", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const lm = new LifecycleManager(brain, undefined);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    spy.reset();
    lm.recordAccess(f.id, 12345);
    expect(spy.putFactCount).toBe(1);
    const got = brain.allFacts.get(f.id)!;
    expect(got.accessCount).toBe(1);
    expect(got.lastAccessedAt).toBe(12345);
  });

  it("recordAccess increments on second call (round-trip)", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const lm = new LifecycleManager(brain, undefined);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    lm.recordAccess(f.id, 100);
    spy.reset();
    lm.recordAccess(f.id, 200);
    expect(spy.putFactCount).toBe(1);
    const got = brain.allFacts.get(f.id)!;
    expect(got.accessCount).toBe(2);
    expect(got.lastAccessedAt).toBe(200);
  });

  it("recordAccess on unknown id does nothing (no putFact)", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const lm = new LifecycleManager(brain, undefined);
    spy.reset();
    lm.recordAccess("nonexistent", 100);
    expect(spy.putFactCount).toBe(0);
  });
});

describe("GAP-1 site 4: SyncDomain.onRecord notifies the seam", () => {
  it("onRecord attaches hlc and calls storage.putFact", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const d = new SyncDomain("node-a");
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    spy.reset();
    d.onRecord(f);
    expect(spy.putFactCount).toBe(1);
    const got = brain.allFacts.get(f.id)!;
    expect(got.hlc).toBeDefined();
    expect(got.hlc!.wall).toBe(f.createdAt);
    expect(got.hlc!.node).toBe("node-a");
  });

  it("onRecord without brain wired still mutates in-place (no seam notification)", () => {
    const spy = new SpyBrainStorage();
    const brain = new Brain(3, 0.85, spy);
    const d = new SyncDomain("node-a");
    // NOTE: init() not called — brain is undefined (standalone unit usage).
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    spy.reset();
    d.onRecord(f);
    // The in-place mutation still happens (hlc is set on the object).
    expect((f as Fact & { hlc?: { wall: number } }).hlc).toBeDefined();
    // No seam notification (brain not wired).
    expect(spy.putFactCount).toBe(0);
  });
});
