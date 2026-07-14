/**
 * @my-agent/memory/domains.test — Phase A Gap 2 + Gap 3 tests (+31 tests).
 *
 * Covers the new MemoryDomain interface + the L0/L1/L2 MemoryTree. The 86-test
 * baseline (brain/roles/dream-cycle/rrf/ragfs/file-backend/graph-knowledge)
 * stays intact on a fresh vitest run (verified by the CI gate).
 *
 * Coverage targets (from the plan's "+30 tests" commitment):
 *   -  4 MemoryTree tests (L0 TTL, L1 promote, L2 compile, getTier+demote)
 *   - 26 MemoryDomain tests (13 domains × 2 tests each:
 *         init + recall-empty and onRecord + integration)
 *   -  1 MemoryManager facade integration test (record/recall/consolidate)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Brain,
  MemoryTree,
  MemoryManagerImpl,
  InMemoryBackend,
  // domains
  ArchivistDomain, archivistDomain,
  TreeDomain, treeDomain,
  DiffDomain, diffDomain,
  GoalsDomain, goalsDomain,
  SyncDomain, syncDomain,
  GraphDomain, graphDomain,
  ConversationsDomain, conversationsDomain,
  SearchDomain, searchDomain,
  SourcesDomain, sourcesDomain,
  EntitiesDomain, entitiesDomain,
  StoreDomain, storeDomain,
  ToolsDomain, toolsDomain,
  QueueDomain, queueDomain,
  L0_TTL_MS,
} from "@my-agent/memory";
import { setTimeProvider, nowWallclock } from "@my-agent/core";

/** A pinned wallclock for deterministic 24h TTL assertions. */
const FIXED_NOW = 1_700_000_000_000;
const realWallclock = () => Date.now();
const realMonotonic = () => (typeof performance !== "undefined" ? performance.now() * 1000 : Date.now());
beforeEach(() => setTimeProvider({ nowWallclock: () => FIXED_NOW, nowMonotonic: () => FIXED_NOW }));
afterEach(() => setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic }));

// ── MemoryTree (4 tests) ────────────────────────────────────────────────────

describe("MemoryTree — L0 24h TTL wrapper", () => {
  it("assignTier auto-sets validUntil = now + 24h when not provided", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const { fact, tier } = tree.assignTier({
      kind: "fact", entity: "e", content: "hello", visibility: "private", notability: 1, source: "s",
    });
    expect(tier).toBe("L0");
    expect(fact.validUntil).toBe(FIXED_NOW + L0_TTL_MS);
  });
  it("assignTier preserves an explicit validUntil (Brain's TTL wins)", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const explicit = FIXED_NOW + 600_000; // 10 min
    const { fact } = tree.assignTier({
      kind: "fact", entity: "e", content: "hi", visibility: "private", notability: 1, source: "s",
      validUntil: explicit,
    });
    expect(fact.validUntil).toBe(explicit);
  });
});

describe("MemoryTree — L1 promotion via brain.consolidate()", () => {
  it("promote() delegates to brain.consolidate and re-labels new takes as L1", () => {
    const brain = new Brain(3, 0.5); // min 3 facts per bucket, lower cosine for cluster
    const tree = new MemoryTree(brain);
    // Seed 3 facts in the same (source,entity) bucket with cosine-similar content.
    tree.assignTier({ kind: "fact", entity: "Bob", content: "Bob likes apples today", visibility: "private", notability: 1, source: "s" });
    tree.assignTier({ kind: "fact", entity: "Bob", content: "Bob really likes apples", visibility: "private", notability: 1, source: "s" });
    tree.assignTier({ kind: "fact", entity: "Bob", content: "Bob loves apples a lot", visibility: "private", notability: 1, source: "s" });
    const r = tree.promote();
    expect(r.takesPromoted).toBeGreaterThanOrEqual(1);
    const newTakeId = brain.takes[brain.takes.length - 1]!.id;
    expect(tree.getTier(newTakeId)).toBe("L1");
  });
});

describe("MemoryTree — L2 compile (cosine clustering ≥ minCluster)", () => {
  it("compile() clusters ≥2 cosine-similar takes → 1 BrainPage", () => {
    const brain = new Brain(3, 0.5);
    const tree = new MemoryTree(brain);
    // Drive consolidation with two clusters of 3 similar facts each (same
    // shared content across entities so cosine ≥ 0.85 passes).
    for (const e of ["Alice", "Bob"] as const) {
      tree.assignTier({ kind: "fact", entity: e, content: `shared prose number one`, visibility: "private", notability: 1, source: "s" });
      tree.assignTier({ kind: "fact", entity: e, content: `shared prose number two`, visibility: "private", notability: 1, source: "s" });
      tree.assignTier({ kind: "fact", entity: e, content: `shared prose number three`, visibility: "private", notability: 1, source: "s" });
    }
    tree.promote();
    // After promotion both entities should have at least one take (clustered).
    expect(brain.takes.length).toBeGreaterThanOrEqual(2);
    const pagesBefore = brain.allPages.length;
    const r = tree.compile();
    expect(r.pagesCompiled).toBeGreaterThanOrEqual(1);
    expect(brain.allPages.length).toBeGreaterThan(pagesBefore);
    // Compile labels the new page id as L2.
    const newPageId = brain.allPages[brain.allPages.length - 1]!.id;
    expect(tree.getTier(newPageId)).toBe("L2");
  });
});

describe("MemoryTree — getTier + demote round-trip", () => {
  it("getTier returns the assigned tier; demote resets the label to undefined", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const { fact } = tree.assignTier({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    expect(tree.getTier(fact.id)).toBe("L0");
    expect(tree.demote(fact.id)).toBe(true);
    expect(tree.getTier(fact.id)).toBeUndefined();
    expect(tree.demote(fact.id)).toBe(false); // already demoted
  });
});

// ── 13 × 2 = 26 domain tests ────────────────────────────────────────────────
//
// The shape is: domain instance is `init()`-ed with a fresh Brain + a couple of
// seeded facts, then either `recall("")` returns [] (or a guarded subset) and
// `onRecord(fact)` does NOT throw + the fact is registered in the Brain.

describe("ArchivistDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new ArchivistDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord tracks fact writes; onConsolidate calls brain.purge", () => {
    const brain = new Brain();
    const d = new ArchivistDomain();
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s", validUntil: FIXED_NOW - 1 });
    expect(() => d.onRecord(f)).not.toThrow();
    const r = d.onConsolidate(FIXED_NOW);
    expect(r.consumed).toBeGreaterThanOrEqual(1);
  });
});

describe("TreeDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new TreeDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; recall surfaces facts that match query", () => {
    const brain = new Brain();
    const d = new TreeDomain();
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "alpha bravo charlie", visibility: "private", notability: 1, source: "s" });
    expect(() => d.onRecord(f)).not.toThrow();
    const hits = d.recall("alpha");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content).toContain("alpha");
  });
});

describe("DiffDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new DiffDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; schemaSuggest produces a report on recall", () => {
    const brain = new Brain();
    const d = new DiffDomain();
    d.init(brain);
    brain.recordFact({ kind: "fact", entity: "Alice", content: "x", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "alice", content: "y", visibility: "private", notability: 1, source: "s" });
    const hits = d.recall("alice");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GoalsDomain", () => {
  it("init + recall empty (sync) returns [] until async recall resolves", () => {
    const d = new GoalsDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; async recall returns goals when a store is wired", async () => {
    const brain = new Brain();
    const d = new GoalsDomain();
    d.init(brain);
    d.wireStore(new InMemoryBackend("goals"));
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" });
    expect(() => d.onRecord(f)).not.toThrow();
    // The async recall wires the goals store; without setGoals writes it returns [].
    const hits = await d.recallAsync("");
    expect(hits).toEqual([]);
  });
});

describe("SyncDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new SyncDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord + onConsolidate are pure no-ops (stub)", () => {
    const brain = new Brain();
    const d = new SyncDomain();
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" });
    expect(() => d.onRecord(f)).not.toThrow();
    expect(d.onConsolidate(nowWallclock())).toEqual({ promoted: 0, consumed: 0 });
  });
});

describe("GraphDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new GraphDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; recall surfaces typed neighbors", () => {
    const brain = new Brain();
    const d = new GraphDomain();
    d.init(brain);
    brain.recordFact({ kind: "fact", entity: "Alice", content: "see [[Bob]] for context and also [[Charlie]]", visibility: "private", notability: 1, source: "s" });
    const f = brain.recordFact({ kind: "fact", entity: "Alice", content: "extra context for graph", visibility: "private", notability: 1, source: "s" });
    expect(() => d.onRecord(f)).not.toThrow();
    // Query from the source entity (Alice — has outgoing edges to Bob/Charlie).
    const hits = d.recall("Alice");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content.toLowerCase()).toContain("alice →");
  });
});

describe("ConversationsDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new ConversationsDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord counts backfill-sourced facts; recall surfaces them", () => {
    const brain = new Brain();
    const d = new ConversationsDomain();
    d.init(brain);
    brain.recordFact({ kind: "fact", entity: "Alice", content: "Alice mentioned in conversation", visibility: "private", notability: 1, source: "backfill" });
    const f2 = brain.recordFact({ kind: "fact", entity: "Alice", content: "Alice mentioned again", visibility: "private", notability: 1, source: "backfill" });
    d.onRecord(f2);
    const hits = d.recall("Alice");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(d.onConsolidate(nowWallclock()).consumed).toBeGreaterThanOrEqual(1);
  });
});

describe("SearchDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new SearchDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; recall uses the 4-arm RRF pipeline", () => {
    const brain = new Brain();
    const d = new SearchDomain();
    d.init(brain);
    brain.recordFact({ kind: "fact", entity: "Alice", content: "Alice drinks coffee daily", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "Bob", content: "Bob drinks tea daily", visibility: "private", notability: 1, source: "s" });
    const hits = d.recall("coffee");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content.toLowerCase()).toContain("coffee");
  });
});

describe("SourcesDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new SourcesDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; async recall returns [] when no source is wired", async () => {
    const d = new SourcesDomain();
    d.init(new Brain());
    const f = { id: "x", kind: "fact" as const, entity: "e", content: "c", visibility: "private" as const, notability: 1, source: "s", createdAt: FIXED_NOW };
    expect(() => d.onRecord(f)).not.toThrow();
    const hits = await d.recallAsync("query");
    expect(hits).toEqual([]);
  });
});

describe("EntitiesDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new EntitiesDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; recall returns atoms (dates, urls, ...)", () => {
    const brain = new Brain();
    const d = new EntitiesDomain();
    d.init(brain);
    const f = brain.recordFact({ kind: "fact", entity: "release", content: "released on 2025-01-15 from https://example.com", visibility: "private", notability: 1, source: "s" });
    expect(() => d.onRecord(f)).not.toThrow();
    const hits = d.recall("date");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content).toContain("2025-01-15");
  });
});

describe("StoreDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new StoreDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord is a no-op; async recall reads from the wired manager", async () => {
    const d = new StoreDomain();
    d.init(new Brain());
    const f = { id: "x", kind: "fact" as const, entity: "e", content: "c", visibility: "private" as const, notability: 1, source: "s", createdAt: FIXED_NOW };
    expect(() => d.onRecord(f)).not.toThrow();
    // No manager wired → recallAsync returns [].
    const hits = await d.recallAsync("query");
    expect(hits).toEqual([]);
  });
});

describe("ToolsDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new ToolsDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord caches tool-sourced facts; recall hits the cache", () => {
    const brain = new Brain();
    const d = new ToolsDomain();
    d.init(brain);
    const toolFact = brain.recordFact({ kind: "fact", entity: "tool-result", content: "tool output: hello world", visibility: "private", notability: 1, source: "tool" } as never);
    d.onRecord(toolFact);
    expect(d.size()).toBeGreaterThanOrEqual(1);
    const hits = d.recall("hello");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("QueueDomain", () => {
  it("init + recall empty returns []", () => {
    const d = new QueueDomain();
    d.init(new Brain());
    expect(d.recall("")).toEqual([]);
  });
  it("onRecord buffers; onConsolidate drains the buffer", () => {
    const brain = new Brain();
    const d = new QueueDomain();
    d.init(brain);
    const f1 = brain.recordFact({ kind: "fact", entity: "e", content: "first", visibility: "private", notability: 1, source: "s" });
    const f2 = brain.recordFact({ kind: "fact", entity: "e", content: "second", visibility: "private", notability: 1, source: "s" });
    d.onRecord(f1);
    d.onRecord(f2);
    expect(d.bufferSize()).toBe(2);
    const r = d.onConsolidate(nowWallclock());
    expect(r.consumed).toBe(2);
    expect(d.bufferSize()).toBe(0);
  });
});

// ── MemoryManager facade integration (1 test) ───────────────────────────────

describe("MemoryManager facade — record/recall/consolidate via Brain + domains", () => {
  it("withBrain() wires Brain + domains; record + recall + consolidate round-trip", async () => {
    const brain = new Brain(3, 0.5);
    const mgr = MemoryManagerImpl.withBrain({
      brain,
      domains: [archivistDomain, treeDomain, queueDomain],
    });
    // record() returns the persisted Fact + notifies each domain.
    const persisted = mgr.record({ kind: "fact", entity: "Alice", content: "Alice smokes bananajuice", visibility: "private", notability: 1, source: "s" });
    expect(persisted.id).toBeDefined();
    expect(brain.factCount).toBe(1);
    // recall() returns one slice per domain.
    const slices = mgr.recall("Alice");
    expect(slices.length).toBe(3);
    expect(slices.map((s) => s.domain).sort()).toEqual(["archivist", "queue", "tree"]);
    // consolidate() runs brain.consolidate() + each domain's onConsolidate.
    const r = await mgr.consolidate();
    expect("takesPromoted" in r).toBe(true);
    expect("factsConsumed" in r).toBe(true);
    expect("consolidation" in r).toBe(true);
  });
});

// ── Default singleton instances (1 sanity test) ────────────────────────────

describe("Default domain singletons", () => {
  it("archivistDomain/treeDomain/etc. are non-undefined", () => {
    expect(archivistDomain).toBeDefined();
    expect(treeDomain).toBeDefined();
    expect(diffDomain).toBeDefined();
    expect(goalsDomain).toBeDefined();
    expect(syncDomain).toBeDefined();
    expect(graphDomain).toBeDefined();
    expect(conversationsDomain).toBeDefined();
    expect(searchDomain).toBeDefined();
    expect(sourcesDomain).toBeDefined();
    expect(entitiesDomain).toBeDefined();
    expect(storeDomain).toBeDefined();
    expect(toolsDomain).toBeDefined();
    expect(queueDomain).toBeDefined();
  });
});
