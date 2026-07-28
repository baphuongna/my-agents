/**
 * @my-agent/memory/sqlite-manager — tests for the unified SQLite memory manager.
 *
 * Covers the security-sensitive surface touched by cold-review findings:
 *   - S2: stats() must use hardcoded SQL (no table-name interpolation / injection)
 *   - S3: findByHash() must escape LIKE metacharacters (%, _, \) in the hash
 *
 * Tagged [unit] — pure logic against an in-memory SQLite database.
 */
import { describe, it, expect } from "vitest";
import { SqliteMemoryManager } from "./sqlite-manager.js";
import type { SqliteDatabase } from "./sqlite-db.js";

/** Build a manager backed by an in-memory database (full schema initialized). */
function makeManager(): SqliteMemoryManager {
  return new SqliteMemoryManager({ dbPath: ":memory:" });
}

/** Insert a working_memory row carrying a specific captureHash in metadata_json. */
function seedCaptureHash(mgr: SqliteMemoryManager, hash: string): string {
  return mgr.record({ content: `seed for ${hash}`, source: "test", metadata: { captureHash: hash } });
}

// ── S3: findByHash LIKE-metacharacter escaping ────────────────────────────

describe("[unit] SqliteMemoryManager.findByHash (S3)", () => {
  it("returns false when no memory with the hash exists", () => {
    const mgr = makeManager();
    expect(mgr.findByHash("nonexistent-hash-123")).toBe(false);
  });

  it("returns true when an exact captureHash match exists", () => {
    const mgr = makeManager();
    seedCaptureHash(mgr, "abc123");
    expect(mgr.findByHash("abc123")).toBe(true);
  });

  it("returns true for a captureHash that literally contains a percent sign", () => {
    const mgr = makeManager();
    seedCaptureHash(mgr, "a%c");
    // The literal "%" in the hash must be found verbatim.
    expect(mgr.findByHash("a%c")).toBe(true);
  });

  it("escapes % so a query hash containing % does NOT match unrelated rows", () => {
    const mgr = makeManager();
    seedCaptureHash(mgr, "abc"); // stored hash is "abc"
    // Without escaping, "%" is a LIKE wildcard → "a%" would match "abc".
    // With S3 escaping, "%" is literal → "a%" must NOT match "abc".
    expect(mgr.findByHash("a%")).toBe(false);
  });

  it("escapes _ so a query hash containing _ does NOT match unrelated rows", () => {
    const mgr = makeManager();
    seedCaptureHash(mgr, "abc"); // stored hash is "abc"
    // Without escaping, "_" is a LIKE single-char wildcard → "a_c" matches "abc".
    // With S3 escaping, "_" is literal → "a_c" must NOT match "abc".
    expect(mgr.findByHash("a_c")).toBe(false);
  });

  it("does not let a query % bleed across to match a different hash value", () => {
    const mgr = makeManager();
    seedCaptureHash(mgr, "abc");
    seedCaptureHash(mgr, "xyz");
    // "x%" must only be capable of matching a hash literally starting "x%" —
    // neither "abc" nor "xyz" is literally "x%".
    expect(mgr.findByHash("x%")).toBe(false);
    // Exact lookups still work for both.
    expect(mgr.findByHash("abc")).toBe(true);
    expect(mgr.findByHash("xyz")).toBe(true);
  });
});

// ── S2: stats() hardcoded SQL (no table-name interpolation) ───────────────

describe("[unit] SqliteMemoryManager.stats (S2)", () => {
  it("returns zero counts on an empty database", () => {
    const mgr = makeManager();
    expect(mgr.stats()).toEqual({ workingMemory: 0, episodic: 0, facts: 0, triples: 0 });
  });

  it("counts working_memory rows after record()", () => {
    const mgr = makeManager();
    mgr.record({ content: "hello", source: "test" });
    mgr.record({ content: "world", source: "test" });
    const s = mgr.stats();
    expect(s.workingMemory).toBe(2);
    expect(s.episodic).toBe(0);
    expect(s.facts).toBe(0);
    expect(s.triples).toBe(0);
  });

  it("counts episodic_memory rows after recordEpisodic()", () => {
    const mgr = makeManager();
    mgr.recordEpisodic({ content: "summary", source: "test" });
    expect(mgr.stats().episodic).toBe(1);
  });

  it("counts facts rows after recordFact()", () => {
    const mgr = makeManager();
    mgr.recordFact({ subject: "alice", predicate: "likes", object: "ts" });
    expect(mgr.stats().facts).toBe(1);
  });

  it("counts all four tables independently", () => {
    const mgr = makeManager();
    mgr.record({ content: "wm-1", source: "test" });
    mgr.record({ content: "wm-2", source: "test" });
    mgr.recordEpisodic({ content: "ep-1", source: "test" });
    mgr.recordEpisodic({ content: "ep-2", source: "test" });
    mgr.recordEpisodic({ content: "ep-3", source: "test" });
    mgr.recordFact({ subject: "s", predicate: "p", object: "o" });

    // Insert a triple directly (no public manager API for triples).
    const db: SqliteDatabase = mgr.getDatabase();
    db.prepare("INSERT INTO triples (subject, predicate, object) VALUES (?, ?, ?)").run("a", "b", "c");

    expect(mgr.stats()).toEqual({ workingMemory: 2, episodic: 3, facts: 1, triples: 1 });
  });
});
