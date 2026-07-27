/**
 * @my-agent/memory/brain-sqlite-store.test — SqliteBrainStore durability tests.
 *
 * Coverage (per Dig 3 Phase B gates):
 *   B-GATE-2: write-through (putFact → cache + SQLite row via SELECT)
 *   B-GATE-3: durability (write → close → reopen → identical Fact)
 *   B-GATE-4/5: GAP-1 sites 1-2 (embed, consolidate) survive close/reopen
 *   B-GATE-4b/5b: GAP-1 sites 3-4 (recordAccess, sync.onRecord) survive close/reopen
 *   B-GATE-6: performance — 10k facts allFacts() < 50ms
 *   B-GATE-7: performance — 10k recordFact() measured
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { SqliteBrainStore } from "./brain-sqlite-store.js";
import { Brain } from "./brain.js";
import { LifecycleManager } from "./lifecycle.js";
import { SyncDomain } from "./domains/sync.js";
import { openDB, type SqliteDatabase } from "./sqlite-db.js";
import type { Fact, Take, BrainPage } from "./brain.js";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mya-brain-sqlite-"));
  dbPath = join(tmpDir, "brain.db");
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: overrides.id ?? "f1",
    kind: overrides.kind ?? "fact",
    entity: overrides.entity ?? "TestEntity",
    content: overrides.content ?? "some content",
    visibility: overrides.visibility ?? "private",
    notability: overrides.notability ?? 5,
    source: overrides.source ?? "test-src",
    createdAt: overrides.createdAt ?? 1000,
    ...overrides,
  };
}

/** Open a raw DB to verify rows exist (bypassing the store). */
function rawSelect(dbPath: string, sql: string, ...params: unknown[]): Record<string, unknown> | undefined {
  const db = openDB(dbPath);
  try {
    return db.prepare(sql).get(...params);
  } finally {
    db.close();
  }
}

// ── B-GATE-2: CRUD write-through ──────────────────────────────────────────

describe("SqliteBrainStore — B-GATE-2: CRUD write-through", () => {
  it("putFact writes to both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    const f = makeFact({ id: "crud-1", content: "hello world" });
    store.putFact(f);

    // Cache hit
    expect(store.getFact("crud-1")).toBeDefined();
    expect(store.getFact("crud-1")!.content).toBe("hello world");

    // SQLite row exists
    const row = rawSelect(dbPath, "SELECT content, entity, kind FROM brain_facts WHERE id = ?", "crud-1");
    expect(row).toBeDefined();
    expect(row!["content"]).toBe("hello world");
    expect(row!["entity"]).toBe("TestEntity");
    expect(row!["kind"]).toBe("fact");

    store.close();
  });

  it("putTake writes to both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    const t: Take = { id: "t1", sources: ["f1", "f2"], entity: "E", text: "synth", synthesizedAt: 2000 };
    store.putTake(t);

    expect(store.getTake("t1")).toBeDefined();
    const row = rawSelect(dbPath, "SELECT text, sources_json FROM brain_takes WHERE id = ?", "t1");
    expect(row!["text"]).toBe("synth");
    expect(JSON.parse(row!["sources_json"] as string)).toEqual(["f1", "f2"]);

    store.close();
  });

  it("putPage writes to both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    const p: BrainPage = { id: "p1", slug: "test", compiledTruth: "truth", source: "s", createdAt: 3000, version: 1 };
    store.putPage(p);

    expect(store.getPage("p1")).toBeDefined();
    const row = rawSelect(dbPath, "SELECT compiled_truth, version FROM brain_pages WHERE id = ?", "p1");
    expect(row!["compiled_truth"]).toBe("truth");
    expect(row!["version"]).toBe(1);

    store.close();
  });

  it("putTombstone writes to both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    const f = makeFact({ id: "ts-1" });
    store.putTombstone("ts-1", { fact: f, deletedAt: 9999 });

    expect(store.getTombstone("ts-1")).toBeDefined();
    expect(store.tombstoneCount).toBe(1);
    const row = rawSelect(dbPath, "SELECT deleted_at, fact_json FROM brain_tombstones WHERE id = ?", "ts-1");
    expect(row!["deleted_at"]).toBe(9999);
    const factObj = JSON.parse(row!["fact_json"] as string) as Fact;
    expect(factObj.id).toBe("ts-1");

    store.close();
  });

  it("deleteFact removes from both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    store.putFact(makeFact({ id: "del-1" }));
    expect(store.factCount).toBe(1);

    store.deleteFact("del-1");
    expect(store.getFact("del-1")).toBeUndefined();
    expect(store.factCount).toBe(0);
    const row = rawSelect(dbPath, "SELECT id FROM brain_facts WHERE id = ?", "del-1");
    expect(row).toBeUndefined();

    store.close();
  });

  it("deleteTombstone removes from both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    store.putTombstone("ts-del", { fact: makeFact({ id: "ts-del" }), deletedAt: 100 });
    store.deleteTombstone("ts-del");
    expect(store.getTombstone("ts-del")).toBeUndefined();
    expect(store.tombstoneCount).toBe(0);
    const row = rawSelect(dbPath, "SELECT id FROM brain_tombstones WHERE id = ?", "ts-del");
    expect(row).toBeUndefined();

    store.close();
  });

  it("update via putFact (INSERT OR REPLACE) overwrites the row", () => {
    const store = new SqliteBrainStore(dbPath);
    store.putFact(makeFact({ id: "upd-1", content: "v1" }));
    store.putFact(makeFact({ id: "upd-1", content: "v2" }));
    expect(store.factCount).toBe(1); // still one fact
    expect(store.getFact("upd-1")!.content).toBe("v2");
    const row = rawSelect(dbPath, "SELECT content FROM brain_facts WHERE id = ?", "upd-1");
    expect(row!["content"]).toBe("v2");

    store.close();
  });

  it("allFacts / getFactMap / factCount / takeCount work via cache", () => {
    const store = new SqliteBrainStore(dbPath);
    store.putFact(makeFact({ id: "a1" }));
    store.putFact(makeFact({ id: "a2" }));
    store.putTake({ id: "t1", sources: [], entity: "e", text: "x", synthesizedAt: 1 });

    expect(store.factCount).toBe(2);
    expect(store.takeCount).toBe(1);
    const ids = [...store.allFacts()].map((f) => f.id).sort();
    expect(ids).toEqual(["a1", "a2"]);
    expect(store.getFactMap().size).toBe(2);

    store.close();
  });
});

// ── B-GATE-3: Durability (close → reopen → identical) ─────────────────────

describe("SqliteBrainStore — B-GATE-3: durability across restart", () => {
  it("all Fact fields survive close/reopen", () => {
    const store = new SqliteBrainStore(dbPath);
    const f: Fact = {
      id: "dur-full",
      kind: "belief",
      entity: "FullEntity",
      content: "complete fact with all fields",
      visibility: "world",
      notability: 7.5,
      source: "durability-test",
      createdAt: 42_000,
      validFrom: 41_000,
      validUntil: 99_000,
      consolidatedAt: 50_000,
      consolidatedInto: "take-dur",
      embedded: true,
      accessCount: 3,
      lastAccessedAt: 88_000,
      strength: 0.42,
      hlc: { wall: 42_000, counter: 2, node: "node-x" },
    };
    store.putFact(f);
    store.putTake({ id: "take-dur", sources: ["dur-full"], entity: "FullEntity", text: "take", synthesizedAt: 50_000 });
    store.putPage({ id: "pg-1", slug: "s", compiledTruth: "ct", source: "s", createdAt: 60_000, version: 2 });
    store.putTombstone("tomb-1", { fact: makeFact({ id: "tomb-1" }), deletedAt: 77_000 });
    store.close();

    // Reopen on same file
    const store2 = new SqliteBrainStore(dbPath);

    // Fact — every field must match
    const got = store2.getFact("dur-full")!;
    expect(got).toBeDefined();
    expect(got.kind).toBe("belief");
    expect(got.entity).toBe("FullEntity");
    expect(got.content).toBe("complete fact with all fields");
    expect(got.visibility).toBe("world");
    expect(got.notability).toBe(7.5);
    expect(got.source).toBe("durability-test");
    expect(got.createdAt).toBe(42_000);
    expect(got.validFrom).toBe(41_000);
    expect(got.validUntil).toBe(99_000);
    expect(got.consolidatedAt).toBe(50_000);
    expect(got.consolidatedInto).toBe("take-dur");
    expect(got.embedded).toBe(true);
    expect(got.accessCount).toBe(3);
    expect(got.lastAccessedAt).toBe(88_000);
    expect(got.strength).toBe(0.42);
    expect(got.hlc).toEqual({ wall: 42_000, counter: 2, node: "node-x" });

    // Take
    expect(store2.getTake("take-dur")).toBeDefined();
    expect(store2.takeCount).toBe(1);

    // Page
    expect(store2.getPage("pg-1")).toBeDefined();
    expect([...store2.allPages()]).toHaveLength(1);

    // Tombstone
    expect(store2.getTombstone("tomb-1")).toBeDefined();
    expect(store2.tombstoneCount).toBe(1);

    store2.close();
  });

  it("optional fields that are undefined round-trip as undefined (not null)", () => {
    const store = new SqliteBrainStore(dbPath);
    const f = makeFact({ id: "dur-min" }); // only required fields
    store.putFact(f);
    store.close();

    const store2 = new SqliteBrainStore(dbPath);
    const got = store2.getFact("dur-min")!;
    expect(got.validFrom).toBeUndefined();
    expect(got.validUntil).toBeUndefined();
    expect(got.consolidatedAt).toBeUndefined();
    expect(got.consolidatedInto).toBeUndefined();
    expect(got.accessCount).toBeUndefined();
    expect(got.lastAccessedAt).toBeUndefined();
    expect(got.strength).toBeUndefined();
    expect(got.hlc).toBeUndefined();
    // embedded defaults to false in DDL but undefined in Fact → rowToFact maps to undefined
    expect(got.embedded).toBeUndefined();
    store2.close();
  });

  it("empty store reopens empty", () => {
    const store = new SqliteBrainStore(dbPath);
    expect(store.factCount).toBe(0);
    store.close();

    const store2 = new SqliteBrainStore(dbPath);
    expect(store2.factCount).toBe(0);
    expect(store2.takeCount).toBe(0);
    expect(store2.tombstoneCount).toBe(0);
    store2.close();
  });
});

// ── B-GATE-4/5: GAP-1 sites 1-2 (embed, consolidate) across restart ───────

describe("SqliteBrainStore — B-GATE-4/5: GAP-1 sites 1-2 survive restart", () => {
  it("B-GATE-4: embed mutation survives close/reopen", () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    expect(brain.embed()).toBe(1);
    store.close();

    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);
    // embed() is idempotent — count 0 because the fact is already marked.
    expect(brain2.embed()).toBe(0);
    const facts = [...brain2.allFacts.values()];
    expect(facts[0]!.embedded).toBe(true);
    store2.close();
  });

  it("B-GATE-5: consolidate mutation survives close/reopen", () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    for (let i = 0; i < 3; i++) {
      brain.recordFact({ kind: "fact", entity: "e", content: "alpha beta gamma", visibility: "private", notability: 1, source: "s" });
    }
    const result = brain.consolidate();
    expect(result.takesPromoted).toBe(1);
    expect(result.factsConsumed).toBeGreaterThanOrEqual(2);
    store.close();

    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);
    // Re-consolidate should be a no-op (all facts already consolidated).
    const result2 = brain2.consolidate();
    expect(result2.takesPromoted).toBe(0);
    // The takes survive
    expect(brain2.takeCount).toBe(1);
    // The consolidated facts survive with their consolidatedAt set
    const consolidated = [...brain2.allFacts.values()].filter((f) => f.consolidatedAt !== undefined);
    expect(consolidated.length).toBeGreaterThanOrEqual(2);
    store2.close();
  });
});

// ── B-GATE-4b/5b: GAP-1 sites 3-4 (recordAccess, sync.onRecord) across restart ──

describe("SqliteBrainStore — B-GATE-4b/5b: GAP-1 sites 3-4 survive restart", () => {
  it("B-GATE-4b: recordAccess mutation survives close/reopen", () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    const lm = new LifecycleManager(brain, undefined);
    lm.recordAccess(f.id, 55_000);
    expect(brain.allFacts.get(f.id)!.accessCount).toBe(1);
    expect(brain.allFacts.get(f.id)!.lastAccessedAt).toBe(55_000);
    store.close();

    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);
    const got = brain2.allFacts.get(f.id)!;
    expect(got.accessCount).toBe(1);
    expect(got.lastAccessedAt).toBe(55_000);
    store2.close();
  });

  it("B-GATE-5b: sync.onRecord hlc mutation survives close/reopen", () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    const d = new SyncDomain("node-restart");
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    d.onRecord(f);
    expect(brain.allFacts.get(f.id)!.hlc).toBeDefined();
    expect(brain.allFacts.get(f.id)!.hlc!.node).toBe("node-restart");
    store.close();

    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);
    const got = brain2.allFacts.get(f.id)!;
    expect(got.hlc).toBeDefined();
    expect(got.hlc!.node).toBe("node-restart");
    store2.close();
  });
});

// ── loadFromSnapshot clears + rewrites SQLite ──────────────────────────────

describe("SqliteBrainStore — loadFromSnapshot clears + rewrites SQLite", () => {
  it("snapshot replaces all data in both cache and SQLite", () => {
    const store = new SqliteBrainStore(dbPath);
    // Pre-populate
    store.putFact(makeFact({ id: "old-f1", content: "old" }));
    store.putTake({ id: "old-t1", sources: [], entity: "e", text: "old-take", synthesizedAt: 1 });

    // Load snapshot
    store.loadFromSnapshot({
      facts: [makeFact({ id: "new-f1", content: "new" }), makeFact({ id: "new-f2" })],
      takes: [{ id: "new-t1", sources: ["new-f1"], entity: "e", text: "new-take", synthesizedAt: 2 }],
      pages: [{ id: "new-p1", slug: "s", compiledTruth: "ct", source: "s", createdAt: 3, version: 1 }],
      tombstones: [["ts-new", { fact: makeFact({ id: "ts-new" }), deletedAt: 99 }]],
    });

    // Old data is gone
    expect(store.getFact("old-f1")).toBeUndefined();
    expect(store.getTake("old-t1")).toBeUndefined();

    // New data is present
    expect(store.factCount).toBe(2);
    expect(store.takeCount).toBe(1);
    expect(store.tombstoneCount).toBe(1);
    expect(store.getFact("new-f1")!.content).toBe("new");

    store.close();

    // Verify SQLite was also cleared + rewritten
    const store2 = new SqliteBrainStore(dbPath);
    expect(store2.getFact("old-f1")).toBeUndefined();
    expect(store2.factCount).toBe(2);
    expect(store2.getFact("new-f1")!.content).toBe("new");
    expect(store2.takeCount).toBe(1);
    store2.close();
  });
});

// ── B-GATE-6/7: Performance smoke (10k facts) ─────────────────────────────

describe("SqliteBrainStore — B-GATE-6/7: performance smoke (10k facts)", () => {
  it("B-GATE-6: 10k facts allFacts() iteration < 50ms", () => {
    const store = new SqliteBrainStore(dbPath);
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      store.putFact(makeFact({
        id: `perf-${i}`,
        content: `content ${i}`,
        entity: `entity-${i % 100}`,
      }));
    }

    // Measure allFacts() iteration (cache-backed — no SQLite read on iteration)
    const start = performance.now();
    let count = 0;
    for (const _f of store.allFacts()) count++;
    const elapsed = performance.now() - start;

    expect(count).toBe(N);
    // B-GATE-6: must be under 50ms
    console.log(`  B-GATE-6: allFacts() iteration of ${N} facts: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(50);

    store.close();
  });

  it("B-GATE-7: 10k recordFact() via Brain measured + reported", () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    const N = 10_000;

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      brain.recordFact({
        kind: "fact",
        entity: `entity-${i % 100}`,
        content: `fact content number ${i}`,
        visibility: "private",
        notability: 1,
        source: "perf-test",
      });
    }
    const elapsed = performance.now() - start;

    console.log(`  B-GATE-7: ${N} recordFact() calls (Brain + write-through SQLite): ${elapsed.toFixed(2)}ms (${(elapsed / N).toFixed(3)}ms/fact)`);
    expect(brain.factCount).toBe(N);

    // Verify durability — a subset should survive close/reopen
    store.close();
    const store2 = new SqliteBrainStore(dbPath);
    expect(store2.factCount).toBe(N);
    store2.close();
  });
});

// ── getFactMap live semantics (cache-backed) ──────────────────────────────

describe("SqliteBrainStore — getFactMap live semantics", () => {
  it("getFactMap reflects live writes through the cache", () => {
    const store = new SqliteBrainStore(dbPath);
    const map = store.getFactMap();
    expect(map.size).toBe(0);
    store.putFact(makeFact({ id: "live-1" }));
    expect(map.size).toBe(1); // live map reflects the addition

    // In-place mutation is visible (same ref in cache)
    const f = map.get("live-1")!;
    f.embedded = true;
    store.putFact(f); // write-through
    expect(store.getFact("live-1")!.embedded).toBe(true);

    store.close();
  });
});

// ── Direct DB query for raw SQLite verification ───────────────────────────

describe("SqliteBrainStore — raw SQLite verification helpers", () => {
  let testDb: SqliteDatabase;

  afterEach(() => {
    if (testDb) { try { testDb.close(); } catch { /* */ } }
  });

  it("raw SELECT confirms the SQLite row exists independently of the store", () => {
    const store = new SqliteBrainStore(dbPath);
    store.putFact(makeFact({ id: "raw-1", entity: "RawEntity", notability: 9 }));
    store.close();

    // Open a separate connection to verify the row persisted
    testDb = openDB(dbPath);
    const row = testDb.prepare("SELECT entity, notability FROM brain_facts WHERE id = ?").get("raw-1") as Record<string, unknown>;
    expect(row["entity"]).toBe("RawEntity");
    expect(row["notability"]).toBe(9);
  });
});
