/**
 * Phase 2 (conflict.rs re-adopt) — acceptance tests.
 * Covers: jaccardSimilarity, findTextConflicts, checkAndResolveConflicts
 * (supersede on conflict), identical=update-not-conflict, non-brain-type skip,
 * recall excludes superseded.
 *
 * Verifies the re-adopted mya-v1 conflict.rs semantics (fixes Dig 2-3:
 * immortal contradictions).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDB, closeDB, initSchema, storeWorking, recall, checkAndResolveConflicts, jaccardSimilarity, isBrainType, type DatabasePath } from "@my-agent/memory";

let dbPath: DatabasePath;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function freshDb() {
  db = openDB(dbPath);
  initSchema(db);
  return db;
}

describe("Phase 2 — conflict.rs re-adopt", () => {
  beforeEach(() => {
    dbPath = ":memory:";
    freshDb();
  });

  // ── Pure functions ────────────────────────────────────────────────────
  it("jaccardSimilarity: identical=1, disjoint=0, partial=intersection/union", () => {
    expect(jaccardSimilarity("hello world", "hello world")).toBe(1);
    expect(jaccardSimilarity("hello world", "foo bar")).toBe(0);
    // {the, brown} ∩ / ∪ → 2/6
    expect(jaccardSimilarity("the quick brown fox", "the slow brown dog")).toBeCloseTo(2 / 6, 2);
  });

  it("isBrainType: only long-term types are conflict-checked", () => {
    expect(isBrainType("preference")).toBe(true);
    expect(isBrainType("decision")).toBe(true);
    expect(isBrainType("fact")).toBe(true);
    expect(isBrainType("context")).toBe(false); // session-scoped, ephemeral
    expect(isBrainType("event")).toBe(false);
    expect(isBrainType(undefined)).toBe(false);
  });

  // ── checkAndResolveConflicts: supersede on conflict ───────────────────
  it("storing a conflicting preference supersedes the old one (newest wins)", () => {
    const oldId = storeWorking(db, { content: "User prefers tabs for code indentation", memoryType: "preference" });
    const newId = storeWorking(db, { content: "User prefers spaces for code indentation", memoryType: "preference" });
    // Call explicitly (manager.record() wires it in production).
    // jaccard("tabs for code indentation" vs "spaces for code indentation") = 5/6 ≈ 0.83 > 0.7 threshold
    const superseded = checkAndResolveConflicts(db, newId, "User prefers spaces for code indentation", "preference");
    expect(superseded).toContain(oldId);
    const oldRow = db.prepare("SELECT superseded_by FROM working_memory WHERE id = ?").get(oldId) as { superseded_by: string | null };
    expect(oldRow.superseded_by).toBe(newId);
  });

  it("identical content = update, NOT conflict (no supersede)", () => {
    const aId = storeWorking(db, { content: "User prefers tabs", memoryType: "preference" });
    const bId = storeWorking(db, { content: "User prefers tabs", memoryType: "preference" });
    const superseded = checkAndResolveConflicts(db, bId, "User prefers tabs", "preference");
    expect(superseded).not.toContain(aId); // identical → not a conflict
  });

  it("case-only difference = update, NOT conflict (HIGH-1 fix)", () => {
    const aId = storeWorking(db, { content: "User prefers TYPESCRIPT", memoryType: "preference" });
    const bId = storeWorking(db, { content: "user prefers typescript", memoryType: "preference" });
    const superseded = checkAndResolveConflicts(db, bId, "user prefers typescript", "preference");
    expect(superseded).not.toContain(aId); // case-only diff → not a conflict
  });

  it("non-brain type (event) is NOT conflict-checked", () => {
    const e1 = storeWorking(db, { content: "deployed version 2 to production today", memoryType: "event" });
    storeWorking(db, { content: "deployed version 3 to production today", memoryType: "event" });
    const superseded = checkAndResolveConflicts(db, e1, "deployed version 3 to production today", "event");
    expect(superseded).toEqual([]); // events are ephemeral — no conflict check
  });

  it("recall excludes superseded memories (superseded_by IS NULL filter)", () => {
    const oldId = storeWorking(db, { content: "User prefers tabs for indentation now", memoryType: "preference" });
    const newId = storeWorking(db, { content: "User prefers spaces for indentation now", memoryType: "preference" });
    checkAndResolveConflicts(db, newId, "User prefers spaces for indentation now", "preference");
    // recall for "indentation preference" should NOT return the superseded old row
    const hits = recall(db, "indentation preference", { topK: 10 });
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain(oldId); // superseded → filtered
    expect(ids).toContain(newId); // active → present
  });

  it("low-similarity memory is NOT superseded (no false conflict)", () => {
    const aId = storeWorking(db, { content: "User prefers tabs", memoryType: "preference" });
    storeWorking(db, { content: "The database runs on port 5432", memoryType: "fact" });
    const superseded = checkAndResolveConflicts(db, aId, "The database runs on port 5432", "fact");
    // No word overlap → jaccard 0 → not a conflict
    expect(superseded).toEqual([]);
  });

  afterEach(() => {
    if (db) { try { closeDB(db); } catch { /* */ } }
  });
});
