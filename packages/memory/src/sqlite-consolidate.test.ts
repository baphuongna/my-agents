/**
 * Tests for consolidation + lifecycle management (sqlite-consolidate.ts).
 *
 * Covers: consolidate() batch grouping + episodic insert, degradeOldMemories()
 * tier compression, purgeWeakMemories() Weibull strength threshold, lifecycleTick()
 * full pipeline, and purgeStaleAuditLogs() retention.
 *
 * Uses an in-memory SQLite database with the full schema initialized.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDB, closeDB, initSchema,
  consolidate, degradeOldMemories, purgeWeakMemories, lifecycleTick,
  purgeStaleAuditLogs,
  CAPTURE_AUDIT_RETENTION_DAYS, CONFLICT_AUDIT_RETENTION_DAYS,
  countTable,
  type SqliteDatabase,
} from "@my-agent/memory";

describe("sqlite-consolidate — constants", () => {
  it("exports retention day constants", () => {
    expect(CAPTURE_AUDIT_RETENTION_DAYS).toBe(30);
    expect(CONFLICT_AUDIT_RETENTION_DAYS).toBe(90);
  });
});

describe("consolidate()", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDB(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    closeDB(db);
  });

  /** Insert a working_memory row with an old timestamp (eligible for consolidation). */
  function insertOldWorking(id: string, content: string, memoryType = "general", source = "test", sessionId = "default"): void {
    const oldTs = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2 hours ago
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, session_id, memory_type, importance, trust)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, content, source, oldTs, sessionId, memoryType, 0.5, 0.5);
  }

  it("returns consolidated=0 when fewer than MIN_BATCH_SIZE (2) items", () => {
    insertOldWorking("w1", "only one item");
    const result = consolidate(db);
    expect(result.consolidated).toBe(0);
    expect(result.episodicId).toBeNull();
    expect(result.summaryPreview).toBe("");
  });

  it("consolidates a batch of same-type memories into episodic", () => {
    insertOldWorking("w1", "first fact about the system", "fact");
    insertOldWorking("w2", "second fact about the system", "fact");
    const result = consolidate(db);
    expect(result.consolidated).toBe(2);
    expect(result.episodicId).not.toBeNull();
    expect(result.summaryPreview).toContain("first fact");
    // An episodic memory should have been created
    expect(countTable(db, "episodic_memory")).toBe(1);
  });

  it("marks source working memories as consolidated", () => {
    insertOldWorking("w1", "content one", "general");
    insertOldWorking("w2", "content two", "general");
    consolidate(db);
    const r1 = db.prepare("SELECT consolidated_at FROM working_memory WHERE id = ?").get("w1") as { consolidated_at: string | null };
    const r2 = db.prepare("SELECT consolidated_at FROM working_memory WHERE id = ?").get("w2") as { consolidated_at: string | null };
    expect(r1.consolidated_at).not.toBeNull();
    expect(r2.consolidated_at).not.toBeNull();
  });

  it("groups by (source, memory_type) — different types form separate batches", () => {
    insertOldWorking("w1", "a preference item", "preference");
    insertOldWorking("w2", "a fact item", "fact");
    // Each type has only 1 item → below MIN_BATCH_SIZE → no consolidation
    const result = consolidate(db);
    expect(result.consolidated).toBe(0);
  });

  it("writes a consolidation_log entry", () => {
    insertOldWorking("w1", "content one", "general");
    insertOldWorking("w2", "content two", "general");
    consolidate(db);
    const logs = db.prepare("SELECT * FROM consolidation_log").all();
    expect(logs.length).toBeGreaterThan(0);
  });

  it("respects sessionId filter", () => {
    insertOldWorking("w1", "session A item", "general", "test", "sess-A");
    insertOldWorking("w2", "session A item", "general", "test", "sess-A");
    insertOldWorking("w3", "session B item", "general", "test", "sess-B");
    insertOldWorking("w4", "session B item", "general", "test", "sess-B");
    const result = consolidate(db, "sess-A");
    expect(result.consolidated).toBe(2);
  });
});

describe("degradeOldMemories()", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDB(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    closeDB(db);
  });

  it("degrades tier-1 episodic memories older than 30 days to tier 2", () => {
    const oldTs = new Date(Date.now() - 45 * 24 * 3600_000).toISOString(); // 45 days ago
    db.prepare(`
      INSERT INTO episodic_memory (id, content, source, timestamp, tier)
      VALUES (?, ?, ?, ?, 1)
    `).run("e1", "A".repeat(1000), "consolidation", oldTs);

    const result = degradeOldMemories(db);
    expect(result.degraded).toBe(1);
    const row = db.prepare("SELECT tier, content FROM episodic_memory WHERE id = ?").get("e1") as { tier: number; content: string };
    expect(row.tier).toBe(2);
    // Tier 2 truncates content to 800 chars
    expect(row.content.length).toBeLessThanOrEqual(800);
  });

  it("degrades very old tier-1 memories directly to tier 3", () => {
    const oldTs = new Date(Date.now() - 200 * 24 * 3600_000).toISOString(); // 200 days ago
    db.prepare(`
      INSERT INTO episodic_memory (id, content, source, timestamp, tier)
      VALUES (?, ?, ?, ?, 1)
    `).run("e1", "B".repeat(1000), "consolidation", oldTs);

    const result = degradeOldMemories(db);
    expect(result.degraded).toBe(1);
    const row = db.prepare("SELECT tier, content FROM episodic_memory WHERE id = ?").get("e1") as { tier: number; content: string };
    expect(row.tier).toBe(3);
    expect(row.content.length).toBeLessThanOrEqual(300);
  });

  it("degrades tier-2 memories older than 180 days to tier 3", () => {
    const oldTs = new Date(Date.now() - 200 * 24 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO episodic_memory (id, content, source, timestamp, tier)
      VALUES (?, ?, ?, ?, 2)
    `).run("e1", "C".repeat(500), "consolidation", oldTs);

    const result = degradeOldMemories(db);
    expect(result.degraded).toBe(1);
    const row = db.prepare("SELECT tier FROM episodic_memory WHERE id = ?").get("e1") as { tier: number };
    expect(row.tier).toBe(3);
  });

  it("does not degrade fresh tier-1 memories", () => {
    const freshTs = new Date().toISOString();
    db.prepare(`
      INSERT INTO episodic_memory (id, content, source, timestamp, tier)
      VALUES (?, ?, ?, ?, 1)
    `).run("e1", "fresh content", "consolidation", freshTs);

    const result = degradeOldMemories(db);
    expect(result.degraded).toBe(0);
  });

  it("skips superseded memories", () => {
    const oldTs = new Date(Date.now() - 200 * 24 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO episodic_memory (id, content, source, timestamp, tier, superseded_by)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run("e1", "old content", "consolidation", oldTs, "new-id");

    const result = degradeOldMemories(db);
    expect(result.degraded).toBe(0);
  });
});

describe("purgeWeakMemories()", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDB(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    closeDB(db);
  });

  it("purges old weak memories below the strength threshold", () => {
    // An 'event' type with very old timestamp → low Weibull strength → purged
    const veryOldTs = new Date(Date.now() - 365 * 24 * 3600_000).toISOString(); // 1 year ago
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, memory_type, recall_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("w1", "very old event", "test", veryOldTs, "event", 0, 0);

    const result = purgeWeakMemories(db);
    expect(result.purged).toBe(1);
    expect(countTable(db, "working_memory")).toBe(0);
  });

  it("does not purge pinned memories regardless of strength", () => {
    const veryOldTs = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, memory_type, recall_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("w1", "pinned old event", "test", veryOldTs, "event", 0, 1);

    const result = purgeWeakMemories(db);
    expect(result.purged).toBe(0);
  });

  it("does not purge fresh memories (high strength)", () => {
    const freshTs = new Date().toISOString();
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, memory_type, recall_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("w1", "fresh memory", "test", freshTs, "preference", 0, 0);

    const result = purgeWeakMemories(db);
    expect(result.purged).toBe(0);
  });

  it("frequently-recalled memories survive longer (access reinforcement)", () => {
    // event type: k=1.2, eta=168h. At 12 days (288h):
    //   decay = exp(-(288/168)^1.2) ≈ 0.148, salience=0.3
    //   unpopular: 0.148 * 0.3 * 1.0   = 0.044 < 0.05 → PURGED
    //   popular (recall=100): 0.148 * 0.3 * 1.46 ≈ 0.065 > 0.05 → SURVIVES
    const oldTs = new Date(Date.now() - 12 * 24 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, memory_type, recall_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("unpopular", "old event", "test", oldTs, "event", 0, 0);
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, memory_type, recall_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("popular", "old event", "test", oldTs, "event", 100, 0);

    const result = purgeWeakMemories(db);
    expect(result.purged).toBe(1); // only the unpopular one
    // The popular memory survives due to access reinforcement
    const popular = db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get("popular");
    expect(popular).toBeDefined();
  });

  it("writes purge audit log entries", () => {
    const veryOldTs = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, memory_type, recall_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("w1", "purged content", "test", veryOldTs, "event", 0, 0);

    purgeWeakMemories(db);
    const logs = db.prepare("SELECT * FROM purge_log").all();
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("lifecycleTick()", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDB(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    closeDB(db);
  });

  it("runs all lifecycle phases without error", () => {
    const result = lifecycleTick(db);
    expect(result).toHaveProperty("consolidated");
    expect(result).toHaveProperty("degraded");
    expect(result).toHaveProperty("purged");
    expect(result).toHaveProperty("expired");
    expect(typeof result.expired).toBe("number");
  });

  it("purges expired memories (valid_until < now) in the expired phase", () => {
    db.prepare(`
      INSERT INTO working_memory (id, content, source, timestamp, valid_until)
      VALUES (?, ?, ?, ?, ?)
    `).run("w1", "expired", "test", new Date().toISOString(), "2020-01-01T00:00:00.000Z");

    const result = lifecycleTick(db);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(countTable(db, "working_memory")).toBe(0);
  });

  it("consolidates eligible batches during lifecycle", () => {
    const oldTs = new Date(Date.now() - 2 * 3600_000).toISOString();
    for (let i = 0; i < 3; i++) {
      db.prepare(`
        INSERT INTO working_memory (id, content, source, timestamp, memory_type, importance, trust)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`w${i}`, `content ${i}`, "test", oldTs, "general", 0.5, 0.5);
    }
    const result = lifecycleTick(db);
    expect(result.consolidated.consolidated).toBe(3);
  });
});

describe("purgeStaleAuditLogs()", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDB(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    closeDB(db);
  });

  it("deletes capture_audit rows older than retention window", () => {
    // Insert an old row (using SQLite datetime math)
    db.prepare(`
      INSERT INTO capture_audit (content_snippet, matched_type, confidence, reason, skipped_at)
      VALUES (?, ?, ?, ?, datetime('now', '-60 days'))
    `).run("old skip", "general", 0.3, "below threshold");

    const result = purgeStaleAuditLogs(db);
    expect(result.capture).toBeGreaterThanOrEqual(1);
  });

  it("deletes conflict_audit rows older than retention window", () => {
    db.prepare(`
      INSERT INTO conflict_audit (old_id, new_id, jaccard, superseded_at)
      VALUES (?, ?, ?, datetime('now', '-100 days'))
    `).run("old-1", "new-1", 0.9);

    const result = purgeStaleAuditLogs(db);
    expect(result.conflict).toBeGreaterThanOrEqual(1);
  });

  it("keeps recent audit rows", () => {
    db.prepare(`
      INSERT INTO capture_audit (content_snippet, matched_type, confidence, reason, skipped_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run("recent skip", "general", 0.3, "below threshold");

    const before = (db.prepare("SELECT COUNT(*) as n FROM capture_audit").get() as { n: number }).n;
    purgeStaleAuditLogs(db);
    const after = (db.prepare("SELECT COUNT(*) as n FROM capture_audit").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});
