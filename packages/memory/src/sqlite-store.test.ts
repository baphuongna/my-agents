/**
 * Tests for SQLite store CRUD operations (sqlite-store.ts).
 *
 * Covers: storeWorking/storeEpisodic/storeFact inserts, markConsolidated,
 * recordRecall, supersede, degradeTier, purgeExpired, getUnconsolidated,
 * getWorkingById, countTable, and ttlValidUntil TTL computation.
 *
 * Uses an in-memory SQLite database with the full schema initialized.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDB, closeDB, initSchema,
  storeWorking, storeEpisodic, storeFact,
  markConsolidated, recordRecall, supersede, degradeTier, purgeExpired,
  getUnconsolidated, getWorkingById, countTable,
  type SqliteDatabase,
} from "@my-agent/memory";
import { ttlValidUntil } from "./sqlite-store.js";

describe("ttlValidUntil()", () => {
  it("returns an ISO timestamp in the future", () => {
    const now = Date.now();
    const result = ttlValidUntil("general", now);
    const future = new Date(result).getTime();
    expect(future).toBeGreaterThan(now);
  });

  it("honors per-type TTL (event expires faster than preference)", () => {
    const now = Date.now();
    const eventExpiry = new Date(ttlValidUntil("event", now)).getTime();
    const prefExpiry = new Date(ttlValidUntil("preference", now)).getTime();
    // event TTL = 336h, preference TTL = 8760h → preference lives much longer
    expect(prefExpiry).toBeGreaterThan(eventExpiry);
  });

  it("falls back to default TTL for unknown types", () => {
    const now = Date.now();
    const result = ttlValidUntil("nonexistent-type", now);
    const future = new Date(result).getTime();
    // Default TTL = 8760h (1 year)
    expect(future - now).toBeGreaterThanOrEqual(8760 * 3_600_000 - 1000);
  });

  it("handles undefined memoryType", () => {
    const now = Date.now();
    const result = ttlValidUntil(undefined, now);
    expect(new Date(result).getTime()).toBeGreaterThan(now);
  });
});

describe("SQLite store — CRUD operations", () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDB(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    closeDB(db);
  });

  // ── storeWorking ──

  it("storeWorking inserts a row and returns a UUID id", () => {
    const id = storeWorking(db, { content: "Alice likes TypeScript", source: "test" });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(countTable(db, "working_memory")).toBe(1);
  });

  it("storeWorking applies default values for optional fields", () => {
    const id = storeWorking(db, { content: "bare content" });
    const row = getWorkingById(db, id);
    expect(row).not.toBeNull();
    expect(row!.source).toBe("");
    expect(row!.session_id).toBe("default");
    expect(row!.importance).toBe(0.5);
    expect(row!.memory_type).toBe("general");
    expect(row!.scope).toBe("global");
  });

  it("storeWorking sets valid_until based on memory type TTL", () => {
    const id = storeWorking(db, { content: "test", memoryType: "event" });
    const row = getWorkingById(db, id);
    expect(row!.valid_until).not.toBeNull();
    // valid_until should be in the future
    expect(new Date(row!.valid_until!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("storeWorking respects an explicit validUntil override", () => {
    const explicit = "2020-01-01T00:00:00.000Z";
    const id = storeWorking(db, { content: "test", validUntil: explicit });
    const row = getWorkingById(db, id);
    expect(row!.valid_until).toBe(explicit);
  });

  it("storeWorking stores metadata as JSON", () => {
    const id = storeWorking(db, { content: "test", metadata: { key: "val", num: 42 } });
    const row = getWorkingById(db, id);
    const meta = JSON.parse(row!.metadata_json);
    expect(meta.key).toBe("val");
    expect(meta.num).toBe(42);
  });

  it("storeWorking stores scope and agentId (Phase 3)", () => {
    const id = storeWorking(db, { content: "test", scope: "role", agentId: "agent-1" });
    const row = getWorkingById(db, id);
    expect(row!.scope).toBe("role");
    expect(row!.agent_id).toBe("agent-1");
  });

  // ── getWorkingById ──

  it("getWorkingById returns null for a missing id", () => {
    expect(getWorkingById(db, "nonexistent")).toBeNull();
  });

  // ── storeEpisodic ──

  it("storeEpisodic inserts into episodic_memory", () => {
    const id = storeEpisodic(db, { content: "consolidated summary", summaryOf: "w1,w2" });
    expect(id).toBeTruthy();
    expect(countTable(db, "episodic_memory")).toBe(1);
  });

  it("storeEpisodic sets tier default to 1", () => {
    const id = storeEpisodic(db, { content: "summary" });
    const row = db.prepare("SELECT tier FROM episodic_memory WHERE id = ?").get(id) as { tier: number };
    expect(row.tier).toBe(1);
  });

  // ── storeFact ──

  it("storeFact inserts a structured fact triple", () => {
    const id = storeFact(db, { subject: "Alice", predicate: "knows", object: "TypeScript" });
    expect(id).toBeTruthy();
    expect(countTable(db, "facts")).toBe(1);
    const row = db.prepare("SELECT * FROM facts WHERE fact_id = ?").get(id) as Record<string, unknown>;
    expect(row.subject).toBe("Alice");
    expect(row.predicate).toBe("knows");
    expect(row.object).toBe("TypeScript");
  });

  it("storeFact applies default confidence of 1.0", () => {
    const id = storeFact(db, { subject: "S", predicate: "P", object: "O" });
    const row = db.prepare("SELECT confidence FROM facts WHERE fact_id = ?").get(id) as { confidence: number };
    expect(row.confidence).toBe(1.0);
  });

  // ── markConsolidated ──

  it("markConsolidated sets consolidated_at timestamp", () => {
    const id1 = storeWorking(db, { content: "first" });
    const id2 = storeWorking(db, { content: "second" });
    markConsolidated(db, [id1, id2], "episodic-1");
    const r1 = getWorkingById(db, id1);
    const r2 = getWorkingById(db, id2);
    expect(r1!.consolidated_at).not.toBeNull();
    expect(r2!.consolidated_at).not.toBeNull();
  });

  // ── recordRecall ──

  it("recordRecall increments recall_count and sets last_recalled", () => {
    const id = storeWorking(db, { content: "test" });
    recordRecall(db, [id], "working_memory");
    const row = getWorkingById(db, id);
    expect(row!.recall_count).toBe(1);
    expect(row!.last_recalled).not.toBeNull();
  });

  it("recordRecall increments multiple times", () => {
    const id = storeWorking(db, { content: "test" });
    recordRecall(db, [id], "working_memory");
    recordRecall(db, [id], "working_memory");
    recordRecall(db, [id], "working_memory");
    const row = getWorkingById(db, id);
    expect(row!.recall_count).toBe(3);
  });

  // ── supersede ──

  it("supersede sets superseded_by on the old memory", () => {
    const oldId = storeWorking(db, { content: "old fact" });
    const newId = storeWorking(db, { content: "corrected fact" });
    supersede(db, "working_memory", oldId, newId);
    const row = getWorkingById(db, oldId);
    expect(row!.superseded_by).toBe(newId);
  });

  // ── degradeTier ──

  it("degradeTier updates the tier of an episodic memory", () => {
    const id = storeEpisodic(db, { content: "summary" });
    degradeTier(db, id, 2);
    const row = db.prepare("SELECT tier, degraded_at FROM episodic_memory WHERE id = ?").get(id) as { tier: number; degraded_at: string };
    expect(row.tier).toBe(2);
    expect(row.degraded_at).not.toBeNull();
  });

  // ── purgeExpired ──

  it("purgeExpired removes rows past their valid_until", () => {
    storeWorking(db, { content: "expired", validUntil: "2020-01-01T00:00:00.000Z" });
    storeWorking(db, { content: "active", validUntil: "2099-01-01T00:00:00.000Z" });
    const purged = purgeExpired(db, "working_memory");
    expect(purged).toBe(1);
    expect(countTable(db, "working_memory")).toBe(1);
  });

  it("purgeExpired returns 0 when nothing is expired", () => {
    storeWorking(db, { content: "active", validUntil: "2099-01-01T00:00:00.000Z" });
    expect(purgeExpired(db, "working_memory")).toBe(0);
  });

  // ── getUnconsolidated ──

  it("getUnconsolidated returns old unconsolidated memories", () => {
    // Insert directly with an old timestamp (> 1 hour ago)
    const oldTs = new Date(Date.now() - 2 * 3600_000).toISOString();
    db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp, session_id) VALUES (?, ?, ?, ?, ?)",
    ).run("old1", "old content", "test", oldTs, "default");
    db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp, session_id) VALUES (?, ?, ?, ?, ?)",
    ).run("old2", "another old", "test", oldTs, "default");
    const items = getUnconsolidated(db, "default", 1);
    expect(items.length).toBe(2);
  });

  it("getUnconsolidated excludes already-consolidated memories", () => {
    const oldTs = new Date(Date.now() - 2 * 3600_000).toISOString();
    db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp, session_id, consolidated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("c1", "consolidated", "test", oldTs, "default", oldTs);
    const items = getUnconsolidated(db, "default", 1);
    expect(items).toHaveLength(0);
  });

  it("getUnconsolidated filters by session", () => {
    const oldTs = new Date(Date.now() - 2 * 3600_000).toISOString();
    db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp, session_id) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "content", "test", oldTs, "sess-A");
    const items = getUnconsolidated(db, "sess-B", 1);
    expect(items).toHaveLength(0);
  });

  // ── countTable ──

  it("countTable returns accurate counts per table", () => {
    storeWorking(db, { content: "w1" });
    storeWorking(db, { content: "w2" });
    storeEpisodic(db, { content: "e1" });
    storeFact(db, { subject: "s", predicate: "p", object: "o" });

    expect(countTable(db, "working_memory")).toBe(2);
    expect(countTable(db, "episodic_memory")).toBe(1);
    expect(countTable(db, "facts")).toBe(1);
    expect(countTable(db, "triples")).toBe(0);
  });
});
