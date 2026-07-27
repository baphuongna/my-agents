/**
 * @my-agent/memory/phase-c-dual-path — Dig 3 Phase C gate tests.
 *
 * Coverage:
 *   C-GATE-1: dream-cycle with a durable Brain runs the Brain analysis path
 *             (not skipped by the old dreamSQLite early-return).
 *   C-GATE-2: lifecycle.tick() does NOT call brainStore.persist* when Brain is
 *             durable; DOES call them when InMemory (backward compat).
 *   C-GATE-3: dream()/consolidate() idempotency across restart (close/reopen
 *             durable Brain → already-consolidated facts not re-processed).
 *
 * Design decision (dreamSQLite):
 *   When Brain is durable AND sqliteMemory is present, BOTH paths run:
 *   Brain's analysis phases run first, then dreamSQLite runs for SMM's
 *   working_memory data (a complementary, disjoint data source). Skill review
 *   is deduplicated via the skipSkills parameter. See dig3 plan §6 note.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { Brain } from "./brain.js";
import { SqliteBrainStore } from "./brain-sqlite-store.js";
import { DreamCycle } from "./dream-cycle.js";
import { LifecycleManager } from "./lifecycle.js";
import { SqliteMemoryManager } from "./sqlite-manager.js";
import { MemoryManagerImpl } from "./manager.js";
import type { BrainStore } from "./brain-store.js";

// ── C-GATE-1: Durable Brain runs the Brain analysis path ──────────────────

describe("[C-GATE-1] dream-cycle with durable Brain runs Brain analysis path", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mya-phase-c-"));
    dbPath = join(tmpDir, "brain.db");
  });
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("durable Brain: Brain.isDurable returns true; InMemory returns false", () => {
    const store = new SqliteBrainStore(dbPath);
    const durableBrain = new Brain(3, 0.85, store);
    expect(durableBrain.isDurable).toBe(true);

    const inMemoryBrain = new Brain();
    expect(inMemoryBrain.isDurable).toBe(false);

    store.close();
  });

  it("durable Brain: dream() records a dream-summary fact (Brain path ran, not skipped)", async () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);

    // Add recent facts so collectRecentFacts returns them.
    brain.recordFact({
      kind: "event", entity: "Alice", content: "met Bob",
      visibility: "private", notability: 1, source: "session-1",
    });
    brain.recordFact({
      kind: "event", entity: "Alice", content: "likes tea",
      visibility: "private", notability: 1, source: "session-1",
    });

    // intervalMs: 60s — facts just created are within window.
    const dc = new DreamCycle({ brain, intervalMs: 60_000, allowPrivateInPrompt: true });
    const result = await dc.dream();

    // Brain path ran: collectRecentFacts found 2 facts.
    expect(result.memoriesConsolidated).toBe(2);

    // A dream-summary fact was recorded by the Brain path.
    expect(brain.factsByEntity("dream-summary").length).toBe(1);

    // Verify it persisted to SQLite (durable) via the dream source.
    const dreamFacts = [...brain.allFacts.values()].filter((f) => f.source === "dream");
    expect(dreamFacts.length).toBe(1);

    store.close();
  });

  it("durable Brain without sqliteMemory: only Brain path runs (no crash)", async () => {
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    brain.recordFact({
      kind: "event", entity: "Bob", content: "built a house",
      visibility: "private", notability: 1, source: "session-2",
    });

    // No sqliteMemory wired — Brain path must run (not "No memory backend").
    const dc = new DreamCycle({ brain, intervalMs: 60_000, allowPrivateInPrompt: true });
    const result = await dc.dream();

    expect(result.memoriesConsolidated).toBe(1);
    expect(result.summary).not.toBe("No memory backend.");
    expect(brain.factsByEntity("dream-summary").length).toBe(1);

    store.close();
  });
});

// ── C-GATE-2: lifecycle.tick() persistence guard ──────────────────────────

describe("[C-GATE-2] lifecycle.tick() persistence guard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mya-phase-c-lifecycle-"));
  });
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A minimal fake BrainStore that tracks persist calls via vi.fn spies. */
  function makeFakeBrainStore() {
    return {
      persistTakes: vi.fn().mockResolvedValue(undefined),
      persistFact: vi.fn().mockResolvedValue(undefined),
      persistPage: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrainStore;
  }

  /** Add 3 similar facts + consolidate so the persist block has data to write. */
  function seedAndConsolidate(brain: Brain): void {
    for (let i = 0; i < 3; i++) {
      brain.recordFact({
        kind: "fact", entity: "E", content: "alpha beta gamma",
        visibility: "private", notability: 1, source: "s",
      });
    }
    brain.consolidate();
  }

  it("durable Brain: tick() does NOT call brainStore.persist*", () => {
    const dbPath = join(tmpDir, "brain.db");
    const store = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, store);
    const lm = new LifecycleManager(brain, undefined);

    const fakeStore = makeFakeBrainStore();
    lm.wireBrainStore(fakeStore);

    seedAndConsolidate(brain);
    lm.tick();

    expect(fakeStore.persistTakes).not.toHaveBeenCalled();
    expect(fakeStore.persistFact).not.toHaveBeenCalled();
    expect(fakeStore.persistPage).not.toHaveBeenCalled();

    store.close();
  });

  it("InMemory Brain: tick() DOES call brainStore.persist* (backward compat)", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);

    const fakeStore = makeFakeBrainStore();
    lm.wireBrainStore(fakeStore);

    seedAndConsolidate(brain);
    lm.tick();

    // Consolidation created a take → persistTakes fires.
    expect(fakeStore.persistTakes).toHaveBeenCalled();
    // Consolidated facts have consolidatedAt set → persistFact fires.
    expect(fakeStore.persistFact).toHaveBeenCalled();
  });
});

// ── C-GATE-3: Idempotency across restart ──────────────────────────────────

describe("[C-GATE-3] dream()/consolidate() idempotency across restart", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mya-phase-c-idem-"));
    dbPath = join(tmpDir, "brain.db");
  });
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("consolidate() is idempotent: already-consolidated facts not re-processed after restart", () => {
    // Phase 1: create facts, consolidate, close.
    const store1 = new SqliteBrainStore(dbPath);
    const brain1 = new Brain(3, 0.85, store1);
    // 3 similar facts → cluster ≥ 0.85 cosine → 1 take promoted.
    brain1.recordFact({ kind: "fact", entity: "X", content: "alpha beta gamma", visibility: "private", notability: 1, source: "s" });
    brain1.recordFact({ kind: "fact", entity: "X", content: "alpha beta gamma delta", visibility: "private", notability: 1, source: "s" });
    brain1.recordFact({ kind: "fact", entity: "X", content: "alpha beta gamma epsilon", visibility: "private", notability: 1, source: "s" });

    const result1 = brain1.consolidate();
    expect(result1.takesPromoted).toBeGreaterThan(0);
    const takesAfter1 = brain1.takeCount;
    store1.close();

    // Phase 2: reopen on same DB, re-consolidate.
    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);

    // consolidatedAt persisted durably.
    const consolidatedFacts = [...brain2.allFacts.values()].filter((f) => f.consolidatedAt !== undefined);
    expect(consolidatedFacts.length).toBeGreaterThan(0);

    const result2 = brain2.consolidate();
    // No NEW takes promoted (already-consolidated facts skipped — C-GATE-3).
    expect(result2.takesPromoted).toBe(0);
    expect(result2.factsConsumed).toBe(0);
    expect(brain2.takeCount).toBe(takesAfter1);

    store2.close();
  });

  it("dream() dream-summary fact persists across restart and is idempotent", async () => {
    // Phase 1: dream() records a dream-summary fact.
    const store1 = new SqliteBrainStore(dbPath);
    const brain1 = new Brain(3, 0.85, store1);
    brain1.recordFact({ kind: "event", entity: "Alice", content: "a1", visibility: "private", notability: 1, source: "s" });

    const dc1 = new DreamCycle({ brain: brain1, intervalMs: 60_000, allowPrivateInPrompt: true });
    await dc1.dream();

    const dreamFactsBefore = [...brain1.allFacts.values()].filter((f) => f.source === "dream");
    expect(dreamFactsBefore.length).toBe(1);
    store1.close();

    // Phase 2: reopen, verify dream fact persisted.
    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);
    const dreamFactsAfter = [...brain2.allFacts.values()].filter((f) => f.source === "dream");
    expect(dreamFactsAfter.length).toBe(1);
    // The original event fact also persisted.
    expect(brain2.factCount).toBeGreaterThanOrEqual(2);

    // F3: 2nd dream() call after restart — using a tiny intervalMs (1ms) so the
    // original event fact (created in phase 1) falls outside the window.
    // collectRecentFacts returns empty → no duplicate dream-summary (true
    // idempotency). Without the recent.length > 0 guard this would create a dupe.
    const dc2 = new DreamCycle({ brain: brain2, intervalMs: 1, allowPrivateInPrompt: true });
    await dc2.dream();

    const dreamFactsAfter2 = [...brain2.allFacts.values()].filter((f) => f.source === "dream");
    expect(dreamFactsAfter2.length).toBe(1); // still 1 — no duplicate

    store2.close();
  });
});

// ── C-GATE-1b: F1 — durable Brain + sqliteMemory: BOTH paths run ──────────

describe("[C-GATE-1b] durable Brain + sqliteMemory: complementary dual-path", () => {
  let tmpDir: string;
  let brainStore: SqliteBrainStore;
  let smm: SqliteMemoryManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mya-phase-c-complement-"));
    brainStore = new SqliteBrainStore(join(tmpDir, "brain.db"));
    smm = new SqliteMemoryManager({ dbPath: join(tmpDir, "smm.db") });
  });
  afterEach(() => {
    brainStore.close();
    smm.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dream() runs Brain path AND dreamSQLite (complementary data sources)", async () => {
    const brain = new Brain(3, 0.85, brainStore);

    // Seed Brain with a recent fact (Brain analysis path input).
    brain.recordFact({
      kind: "event", entity: "Alice", content: "met Bob",
      visibility: "private", notability: 1, source: "session-1",
    });

    // Seed SMM working_memory (dreamSQLite path input). Default scope='global'.
    smm.record({ content: "Alice discussed the plan", source: "session-1" });

    const dc = new DreamCycle({
      brain, sqliteMemory: smm, intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    const result = await dc.dream();

    // (a) Brain path ran: a dream-summary fact was recorded in Brain.
    expect(brain.factsByEntity("dream-summary").length).toBe(1);

    // (b) dreamSQLite ran: SMM episodic_memory has a dream entry.
    const episodicDreams = smm.getDatabase()
      .prepare("SELECT COUNT(*) as c FROM episodic_memory WHERE source = 'dream'")
      .get() as { c: number };
    expect(episodicDreams.c).toBeGreaterThanOrEqual(1);

    // F6: memoriesConsolidated merges BOTH paths (Brain=1 + SMM=1 = 2).
    expect(result.memoriesConsolidated).toBe(2);
  });
});

// ── C-GATE-4: F2 — withBrain does not clobber durable Brain ───────────────

describe("[C-GATE-4] withBrain does not clobber durable Brain on restart", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mya-phase-c-noclobber-"));
  });
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("withBrain({ brain: durableBrain, persistenceDir }) preserves SQLite data (no JSONL clobber)", () => {
    const dbPath = join(tmpDir, "brain.db");

    // Phase 1: create durable Brain, record a fact, close.
    const store1 = new SqliteBrainStore(dbPath);
    const brain1 = new Brain(3, 0.85, store1);
    brain1.recordFact({
      kind: "event", entity: "Alice", content: "likes tea",
      visibility: "private", notability: 1, source: "session-1",
    });
    expect(brain1.factCount).toBe(1);
    store1.close();

    // Phase 2: reopen + withBrain — must NOT clobber SQLite.
    // Before the fix, loadFromBrainStore would call SqliteBrainStore.loadFromSnapshot
    // which DELETEs all brain_facts and rewrites from empty JSONL → data loss.
    const store2 = new SqliteBrainStore(dbPath);
    const brain2 = new Brain(3, 0.85, store2);
    const m = MemoryManagerImpl.withBrain({
      brain: brain2,
      persistenceDir: tmpDir,
    });

    // The durable Brain's SQLite data survives (loadFromBrainStore was skipped).
    expect(brain2.factCount).toBe(1);
    expect([...brain2.allFacts.values()].filter((f) => f.entity === "Alice").length).toBe(1);

    // Recording a new fact through the manager still works (no brainStore JSONL path).
    m.record({
      kind: "event", entity: "Bob", content: "likes coffee",
      visibility: "private", notability: 1, source: "session-2",
    });
    // brain2 still has Alice's fact (not clobbered).
    expect([...brain2.allFacts.values()].filter((f) => f.entity === "Alice").length).toBe(1);
    expect(brain2.factCount).toBe(2);

    store2.close();
  });
});

// ── C-GATE-5: F4 — InMemory Brain + sqliteMemory: early-return (backward compat) ─

describe("[C-GATE-5] InMemory Brain + sqliteMemory: early-return (backward compat)", () => {
  let tmpDir: string;
  let smm: SqliteMemoryManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mya-phase-c-bc-"));
    smm = new SqliteMemoryManager({ dbPath: join(tmpDir, "smm.db") });
  });
  afterEach(() => {
    smm.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("InMemory Brain + sqliteMemory: dreamSQLite runs, Brain analysis SKIPPED", async () => {
    const brain = new Brain(); // InMemory — isDurable === false
    expect(brain.isDurable).toBe(false);

    // Seed SMM working_memory.
    smm.record({ content: "Alice likes TypeScript", source: "session-1" });

    const dc = new DreamCycle({
      brain, sqliteMemory: smm, intervalMs: 60_000,
    });
    const result = await dc.dream();

    // Brain analysis phases SKIPPED: no dream-summary fact recorded.
    expect(brain.factsByEntity("dream-summary").length).toBe(0);

    // dreamSQLite ran: SMM episodic_memory has a dream entry.
    const episodicDreams = smm.getDatabase()
      .prepare("SELECT COUNT(*) as c FROM episodic_memory WHERE source = 'dream'")
      .get() as { c: number };
    expect(episodicDreams.c).toBeGreaterThanOrEqual(1);

    // Result is from dreamSQLite path.
    expect(result.summary).toMatch(/Consolidated|No new/);
    expect(result.memoriesConsolidated).toBe(1);
  });
});
