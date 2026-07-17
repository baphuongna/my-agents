/**
 * Regression tests for the mem0 deep-dive fixes (docs/mem0-comparison-deepdive.md).
 *
 * Covers:
 *   - Finding A (CRITICAL): recall BM25 scoring inversion — best match now ranks first.
 *   - Finding A (L2 facts): facts recall inversion fixed.
 *   - Finding 1: conflict threshold stays 0.7 (NOT 0.80 — verified true-positive
 *     tabs/spaces = jaccard ≈ 0.714, so 0.80 would lose it) + supersession audit.
 *   - Finding 5: consolidation propagates max trust to episodic (was reset to 0.5).
 *   - Finding 7: autoCapture writes skipped captures to capture_audit.
 *   - Audit retention (security review): lifecycleTick purges stale audit rows.
 *   - SQLITE_BUSY retry (Finding 8): transaction() retries on contention.
 */
import { describe, it, expect } from "vitest";
import {
  SqliteMemoryManager,
  recall,
  recallFacts,
  checkAndResolveConflicts,
  consolidate,
  autoCapture,
  jaccardSimilarity,
  purgeStaleAuditLogs,
  transaction,
  openDB,
  initSchema,
  closeDB,
} from "@my-agent/memory";

describe("mem0 deep-dive fixes", () => {
  // ── Finding A (CRITICAL): recall scoring inversion ─────────────────────
  it("recall() ranks the BEST BM25 match first (was inverted before fix)", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const contents = [
      "typescript typescript typescript configuration and tsconfig options", // BEST (term freq 3)
      "the project uses typescript for all source files",                   // medium
      "javascript is also supported but typescript preferred",              // weaker
      "the database uses postgres with sql migrations",                     // no match (excluded)
    ];
    for (const c of contents) mgr.record({ content: c, memoryType: "fact", source: "tui" });

    const hits = mgr.recall("typescript", { topK: 5, internal: true });
    // Only the 3 typescript docs match the FTS5 query; best must be rank 1.
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content.startsWith("typescript typescript typescript")).toBe(true);
    // Scores must DISCRIMINATE (pre-fix they tied because BM25 contributed ~0).
    const best = hits[0]!.score;
    const others = hits.slice(1).map((h) => h.score);
    expect(others.every((s) => s < best)).toBe(true);
  });

  it("recall() with a single candidate gives it full relevance (not 0)", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    mgr.record({ content: "the project uses rust for the kernel", memoryType: "fact", source: "tui" });
    const hits = mgr.recall("rust", { topK: 5, internal: true });
    expect(hits.length).toBe(1);
    // Single candidate → relevance 1.0; score should be well above 0 (pre-fix
    // exp(bm25) of a strong match ≈ 0, so it would've scored near floor).
    expect(hits[0]!.score).toBeGreaterThan(0.4);
  });

  // ── Finding A (L2 facts): facts recall inversion ───────────────────────
  it("recallFacts() scores the best-matching fact highest (was inverted)", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    // Insert 3 facts with differing relevance to "alice".
    db.prepare(
      "INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)",
    ).run("f1", "alice", "loves", "typescript typescript typescript");
    db.prepare(
      "INSERT INTO facts (fact_id, subject, predicate, object) VALUES (?,?,?,?)",
    ).run("f2", "bob", "likes", "typescript sometimes");
    // Rebuild FTS index for the manually-inserted facts.
    db.exec("INSERT INTO fts_facts (fts_facts) VALUES('rebuild')");

    const facts = recallFacts(db, "typescript", { topK: 5 });
    expect(facts.length).toBeGreaterThanOrEqual(1);
    // f1 (3× typescript) must score highest.
    expect(facts[0]!.fact_id).toBe("f1");
    expect(facts[0]!.score).toBeCloseTo(1.0, 1); // best candidate → 1.0
  });

  // ── Finding 1: conflict threshold 0.80 + audit ─────────────────────────
  it("conflict: TRUE positive (jaccard ≈ 0.714) supersedes at threshold 0.7", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const oldId = mgr.record({ content: "User prefers tabs for code indentation", memoryType: "preference", source: "tui" });
    // jaccard("User prefers tabs for code indentation" vs "...spaces...") = 5/7 ≈ 0.714 > 0.7
    const superseded = checkAndResolveConflicts(mgr.getDatabase(), "new", "User prefers spaces for code indentation", "preference");
    expect(superseded).toContain(oldId);
  });

  it("conflict: KNOWN jaccard limitation — distinct 1-word-swap facts (≈0.75) DO supersede at 0.7 (semantic similarity deferred)", () => {
    // Documents the known false-positive: backend vs frontend share 6/8 tokens
    // (jaccard ≈ 0.75 > 0.7) so they supersede. Raising the threshold to 0.80 would
    // fix this but ALSO drop the canonical true-positive (tabs/spaces ≈ 0.714).
    // jaccard cannot separate them → the fix is semantic similarity (Finding 3,
    // embed_text wiring), tracked separately. Until then the conflict_audit table
    // makes this observable.
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const oldId = mgr.record({
      content: "The team uses TypeScript for the backend service",
      memoryType: "fact", source: "tui",
    });
    expect(jaccardSimilarity("The team uses TypeScript for the backend service",
      "The team uses TypeScript for the frontend service")).toBeGreaterThan(0.7);
    const superseded = checkAndResolveConflicts(mgr.getDatabase(), "new",
      "The team uses TypeScript for the frontend service", "fact");
    // Known limitation: supersede fires (would NOT with semantic similarity).
    expect(superseded).toContain(oldId);
  });

  it("conflict audit: supersession writes a row to conflict_audit", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    const oldId = mgr.record({ content: "User prefers tabs for code indentation", memoryType: "preference", source: "tui" });
    const newId = "new-audit-id";
    checkAndResolveConflicts(db, newId, "User prefers spaces for code indentation", "preference");
    const rows = db.prepare("SELECT old_id, new_id, jaccard FROM conflict_audit").all() as Array<{
      old_id: string; new_id: string; jaccard: number;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.old_id === oldId);
    expect(row).toBeTruthy();
    expect(row!.new_id).toBe(newId);
    expect(row!.jaccard).toBeGreaterThan(0.7); // tabs/spaces ≈ 0.714
  });

  // ── Finding 5: consolidation trust propagation ──────────────────────────
  it("consolidation propagates MAX trust to the episodic memory (was reset to 0.5)", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    const ids = [
      mgr.record({ content: "fact alpha about the system", memoryType: "fact", source: "tui" }),
      mgr.record({ content: "fact beta about the system", memoryType: "fact", source: "tui" }),
      mgr.record({ content: "fact gamma about the system", memoryType: "fact", source: "tui" }),
    ];
    // Bump one source memory's trust to 0.95.
    db.prepare("UPDATE working_memory SET trust = 0.95 WHERE id = ?").run(ids[1]!);
    // Make them old enough to consolidate (> CONSOLIDATION_AGE_HOURS = 1h).
    const old = new Date(Date.now() - 100 * 3600_000).toISOString();
    db.prepare("UPDATE working_memory SET timestamp = ?").run(old);

    consolidate(db, "default");
    const ep = db.prepare("SELECT trust FROM episodic_memory LIMIT 1").get() as { trust: number } | undefined;
    expect(ep).toBeTruthy();
    expect(ep!.trust).toBeCloseTo(0.95, 2); // inherits max trust, not 0.5 default
  });

  // ── Finding 7: autoCapture audit ───────────────────────────────────────
  it("autoCapture writes SKIPPED duplicates to capture_audit", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    const text = "I prefer dark mode for my editor";
    // First capture stores it.
    autoCapture(text, mgr);
    // Second capture of the same content is a duplicate → skipped.
    autoCapture(text, mgr);
    const rows = db.prepare("SELECT reason, matched_type FROM capture_audit WHERE reason = 'duplicate'").all() as Array<{
      reason: string; matched_type: string;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.matched_type).toBe("preference");
  });

  // ── Audit retention (security review fix) ───────────────────────────────
  it("purgeStaleAuditLogs deletes capture_audit rows older than 30 days", () => {
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    autoCapture("I prefer dark mode for my editor", mgr); // stored
    autoCapture("I prefer dark mode for my editor", mgr); // duplicate → capture_audit
    // Backdate the audit row to >30 days ago.
    db.prepare("UPDATE capture_audit SET skipped_at = datetime('now','-40 days')").run();
    expect((db.prepare("SELECT COUNT(*) n FROM capture_audit").get() as { n: number }).n).toBe(1);
    const purged = purgeStaleAuditLogs(db);
    expect(purged.capture).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM capture_audit").get() as { n: number }).n).toBe(0);
  });

  // ── Finding 8: SQLITE_BUSY retry ─────────────────────────────────────────
  it("transaction() retries on SQLITE_BUSY then succeeds (bounded retries)", () => {
    const db = openDB(":memory:");
    initSchema(db);
    let calls = 0;
    // First attempt: simulate SQLITE_BUSY (database is locked). Second: succeed.
    const fakeBusy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    // Use a sentinel table so fn() has a real side effect to verify idempotency.
    db.exec("CREATE TABLE retry_probe (attempt INTEGER)");
    transaction(db, () => {
      calls++;
      db.prepare("INSERT INTO retry_probe (attempt) VALUES (?)").run(calls);
      if (calls === 1) throw fakeBusy; // first attempt fails with BUSY → rollback + retry
    });
    expect(calls).toBe(2); // retried once
    // After rollback of attempt 1 + commit of attempt 2, only ONE row survives.
    const rows = db.prepare("SELECT attempt FROM retry_probe ORDER BY attempt").all() as { attempt: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.attempt).toBe(2);
    closeDB(db);
  });

  it("transaction() gives up after MAX_RETRIES and throws the BUSY error", () => {
    const db = openDB(":memory:");
    initSchema(db);
    const fakeBusy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    let calls = 0;
    expect(() => transaction(db, () => {
      calls++;
      throw fakeBusy; // always BUSY → exhaust retries
    })).toThrow();
    // initial + 3 retries = 4 attempts total.
    expect(calls).toBe(4);
    closeDB(db);
  });
});
