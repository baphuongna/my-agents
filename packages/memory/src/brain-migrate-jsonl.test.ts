/**
 * @my-agent/memory/brain-migrate-jsonl.test — JSONL→SQLite migration tests (Dig 3 Phase D).
 *
 * Coverage (per Dig 3 Phase D gates):
 *   D-GATE-1: full field fidelity across facts/takes/pages/tombstones
 *   D-GATE-2: idempotency — non-empty brain_facts → no-op (no clobber)
 *   D-GATE-3: no brain.jsonl → graceful no-op (no throw)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { BrainStore } from "./brain-store.js";
import { SqliteBrainStore } from "./brain-sqlite-store.js";
import { Brain } from "./brain.js";
import { migrateBrainJsonlToSqlite } from "./brain-migrate-jsonl.js";
import type { Fact, Take, BrainPage } from "./brain.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mya-migrate-"));
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

// ── D-GATE-1: Full field fidelity migration ──────────────────────────────

describe("migrateBrainJsonlToSqlite — D-GATE-1: full field fidelity", () => {
  it("migrates facts/takes/pages/tombstones from JSONL to SQLite with exact fields", async () => {
    // ── JSONL source: write a BrainStore with a full-field Fact + Take + Page + Tombstone ──
    const jsonlDir = join(tmpDir, "jsonl");
    const store = new BrainStore(jsonlDir);

    const fullFact: Fact = {
      id: "fact-full",
      kind: "belief",
      entity: "FullEntity",
      content: "complete fact with all fields for migration",
      visibility: "world",
      notability: 8,
      source: "migration-test",
      createdAt: 42_000,
      validFrom: 41_000,
      validUntil: 99_000,
      consolidatedAt: 50_000,
      consolidatedInto: "take-migrated",
      embedded: true,
      accessCount: 7,
      lastAccessedAt: 88_000,
      strength: 0.65,
      hlc: { wall: 42_000, counter: 3, node: "node-migrate" },
    };
    await store.persistFact(fullFact, "L0");

    const take: Take = {
      id: "take-migrated",
      sources: ["fact-full"],
      entity: "FullEntity",
      text: "synthesized take",
      synthesizedAt: 50_000,
    };
    await store.persistTake(take, "L1");

    const page: BrainPage = {
      id: "page-1",
      slug: "test-page",
      compiledTruth: "compiled truth text",
      source: "migration-test",
      createdAt: 60_000,
      version: 2,
    };
    await store.persistPage(page, "L2");

    // Persist a fact then tombstone it (tombstones reference an existing fact)
    const tombFact = makeFact({
      id: "tomb-fact",
      entity: "TombEntity",
      content: "this fact will be tombstoned",
      createdAt: 70_000,
    });
    await store.persistFact(tombFact, "L0");
    await store.persistTombstone("tomb-fact", 77_000);

    // ── Durable target: SqliteBrainStore + Brain (empty) ──
    const dbPath = join(tmpDir, "brain.db");
    const sqliteStore = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, sqliteStore);
    expect(brain.factCount).toBe(0); // pre-condition: empty brain

    // ── Migrate ──
    const result = await migrateBrainJsonlToSqlite(brain, jsonlDir);
    expect(result.migrated).toBe(1); // only "fact-full" survives (tomb-fact is in tombstones)

    // ── Assert full Fact field fidelity ──
    const got = brain.allFacts.get("fact-full");
    expect(got).toBeDefined();
    expect(got!.kind).toBe("belief");
    expect(got!.entity).toBe("FullEntity");
    expect(got!.content).toBe("complete fact with all fields for migration");
    expect(got!.visibility).toBe("world");
    expect(got!.notability).toBe(8);
    expect(got!.source).toBe("migration-test");
    expect(got!.createdAt).toBe(42_000);
    expect(got!.validFrom).toBe(41_000);
    expect(got!.validUntil).toBe(99_000);
    expect(got!.consolidatedAt).toBe(50_000);
    expect(got!.consolidatedInto).toBe("take-migrated");
    expect(got!.embedded).toBe(true);
    expect(got!.accessCount).toBe(7);
    expect(got!.lastAccessedAt).toBe(88_000);
    expect(got!.strength).toBe(0.65);
    expect(got!.hlc).toEqual({ wall: 42_000, counter: 3, node: "node-migrate" });

    // ── Assert Take migrated ──
    expect(brain.takeCount).toBe(1);
    const gotTake = brain.takes.find((t) => t.id === "take-migrated");
    expect(gotTake).toBeDefined();
    expect(gotTake!.entity).toBe("FullEntity");
    expect(gotTake!.text).toBe("synthesized take");
    expect(gotTake!.synthesizedAt).toBe(50_000);
    expect(gotTake!.sources).toEqual(["fact-full"]);

    // ── Assert Page migrated ──
    expect(brain.allPages).toHaveLength(1);
    const gotPage = brain.allPages.find((p) => p.id === "page-1");
    expect(gotPage).toBeDefined();
    expect(gotPage!.slug).toBe("test-page");
    expect(gotPage!.compiledTruth).toBe("compiled truth text");
    expect(gotPage!.source).toBe("migration-test");
    expect(gotPage!.createdAt).toBe(60_000);
    expect(gotPage!.version).toBe(2);

    // ── Assert Tombstone migrated ──
    expect(brain.tombstoneCount).toBe(1);
    const tomb = brain.tombstonesList().find((t) => t.id === "tomb-fact");
    expect(tomb).toBeDefined();
    expect(tomb!.deletedAt).toBe(77_000);
    expect(tomb!.fact.entity).toBe("TombEntity");
    expect(tomb!.fact.content).toBe("this fact will be tombstoned");

    sqliteStore.close();
  });
});

// ── D-GATE-2: Idempotency (no clobber) ───────────────────────────────────

describe("migrateBrainJsonlToSqlite — D-GATE-2: idempotency (no clobber)", () => {
  it("skips migration when brain already has data (no clobber)", async () => {
    // ── Durable target with existing data ──
    const dbPath = join(tmpDir, "brain.db");
    const sqliteStore = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, sqliteStore);
    const existingFact = brain.recordFact({
      kind: "fact",
      entity: "ExistingEntity",
      content: "already in sqlite before migration",
      visibility: "private",
      notability: 5,
      source: "sqlite-src",
    });
    expect(brain.factCount).toBe(1);

    // ── JSONL source with a DIFFERENT fact ──
    const jsonlDir = join(tmpDir, "jsonl");
    const store = new BrainStore(jsonlDir);
    await store.persistFact(
      makeFact({ id: "jsonl-only", entity: "JsonlOnly", content: "should not clobber existing data" }),
      "L0",
    );

    // ── Migrate — should be a no-op (brain already has data) ──
    const result = await migrateBrainJsonlToSqlite(brain, jsonlDir);
    expect(result.migrated).toBe(0);

    // ── Original fact preserved, JSONL fact NOT added ──
    expect(brain.factCount).toBe(1);
    expect(brain.allFacts.get(existingFact.id)).toBeDefined();
    expect(brain.allFacts.get("jsonl-only")).toBeUndefined();

    sqliteStore.close();
  });
});

// ── D-GATE-3: No brain.jsonl → graceful no-op ────────────────────────────

describe("migrateBrainJsonlToSqlite — D-GATE-3: no brain.jsonl → graceful no-op", () => {
  it("returns migrated:0 and does not throw when no brain.jsonl exists", async () => {
    const emptyDir = join(tmpDir, "empty-no-jsonl");
    const dbPath = join(tmpDir, "brain.db");
    const sqliteStore = new SqliteBrainStore(dbPath);
    const brain = new Brain(3, 0.85, sqliteStore);
    expect(brain.factCount).toBe(0);

    // Should not throw — BrainStore.load() catches file-read errors internally.
    const result = await migrateBrainJsonlToSqlite(brain, emptyDir);
    expect(result.migrated).toBe(0);
    expect(brain.factCount).toBe(0);

    sqliteStore.close();
  });
});
