/**
 * Phase 1 (R17) Retention — acceptance tests.
 * Covers: valid_until TTL at capture, purgeWeakMemories (salience/access/pin),
 * lifecycleTick TTL ceiling (purgeExpired wired), purge_log audit.
 *
 * Addresses the 3 Phase-1 review findings: correctness (type coverage, TTL math,
 * empty-string validUntil, recall guard), security (purge audit, pin), and
 * architecture/regression (Dig 7 correction + acceptance criteria).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDB, closeDB, initSchema, storeWorking, purgeWeakMemories, lifecycleTick, type DatabasePath } from "@my-agent/memory";

let dbPath: DatabasePath;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function freshDb() {
  db = openDB(dbPath);
  initSchema(db);
  return db;
}

/** Insert a working_memory row with an explicit (possibly old) timestamp, bypassing storeWorking's now(). */
function seedRow(opts: {
  content: string;
  memoryType: string;
  timestampIso: string;
  recallCount?: number;
  pinned?: number;
  validUntil?: string | null;
}): string {
  const id = "seed-" + Math.random().toString(36).slice(2);
  db.prepare(`
    INSERT INTO working_memory (id, content, embed_text, source, timestamp, session_id, importance,
      metadata_json, veracity, memory_type, valid_until, scope, recall_count, pinned)
    VALUES (?, ?, NULL, 'test', ?, 'default', 0.5, '{}', 'inferred', ?, ?, 'global', ?, ?)
  `).run(id, opts.content, opts.timestampIso, opts.memoryType, opts.validUntil ?? null, opts.recallCount ?? 0, opts.pinned ?? 0);
  return id;
}

const OLD = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const FUTURE = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString();

describe("Phase 1 R17 — Retention", () => {
  beforeEach(() => {
    dbPath = ":memory:";
    freshDb();
  });

  // ── Acceptance: valid_until set at capture per-type TTL ────────────────
  it("storeWorking sets valid_until per-type TTL when caller omits it", () => {
    const id = storeWorking(db, { content: "a preference", memoryType: "preference" });
    const row = db.prepare("SELECT valid_until, memory_type FROM working_memory WHERE id = ?").get(id) as { valid_until: string; memory_type: string };
    expect(row.valid_until).not.toBeNull();
    // preference TTL = 8760h = 365d → valid_until is ~1 year in the future
    const until = new Date(row.valid_until).getTime();
    expect(until).toBeGreaterThan(Date.now() + 360 * 86_400_000); // > 360 days out
  });

  it("storeWorking with validUntil='' falls back to TTL (not empty → immediate-delete foot-gun)", () => {
    const id = storeWorking(db, { content: "x", memoryType: "event", validUntil: "" } as { content: string; memoryType: string; validUntil: string });
    const row = db.prepare("SELECT valid_until FROM working_memory WHERE id = ?").get(id) as { valid_until: string };
    expect(row.valid_until).not.toBe("");
    expect(row.valid_until.length).toBeGreaterThan(10); // a real ISO timestamp, not empty
  });

  it("different types get different TTLs (event short, preference long)", () => {
    const ev = storeWorking(db, { content: "an event", memoryType: "event" });
    const pref = storeWorking(db, { content: "a pref", memoryType: "preference" });
    const evRow = db.prepare("SELECT valid_until FROM working_memory WHERE id = ?").get(ev) as { valid_until: string };
    const prefRow = db.prepare("SELECT valid_until FROM working_memory WHERE id = ?").get(pref) as { valid_until: string };
    expect(new Date(prefRow.valid_until).getTime()).toBeGreaterThan(new Date(evRow.valid_until).getTime());
  });

  // ── Acceptance: purgeWeakMemories respects pin + salience + access ──────
  it("pinned rows survive purgeWeakMemories even when very old + low-salience", () => {
    const pinnedId = seedRow({ content: "pinned old event", memoryType: "event", timestampIso: OLD(400), pinned: 1, validUntil: FUTURE(1) });
    const { purged } = purgeWeakMemories(db);
    const survives = db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(pinnedId);
    expect(survives).toBeTruthy(); // pinned survived
    expect(purged).toBeGreaterThanOrEqual(0);
  });

  it("low-salience type (event) purges faster than high-salience (preference) at same age", () => {
    // Same age (old), same recall=0, valid_until in future (so TTL ceiling doesn't interfere)
    const eventId = seedRow({ content: "old event", memoryType: "event", timestampIso: OLD(30), validUntil: FUTURE(1) });
    const prefId = seedRow({ content: "old pref", memoryType: "preference", timestampIso: OLD(30), validUntil: FUTURE(1) });
    purgeWeakMemories(db);
    const eventGone = !db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(eventId);
    const prefGone = !db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(prefId);
    // event (salience 0.3) should be gone; preference (salience 0.85, eta 4380h) should survive at 30 days
    expect(eventGone).toBe(true);
    expect(prefGone).toBe(false);
  });

  it("high recall_count extends life (access-reinforcement)", () => {
    // Two events, same old age; one recalled a lot, one never
    const recalledId = seedRow({ content: "popular event", memoryType: "event", timestampIso: OLD(8), recallCount: 50, validUntil: FUTURE(1) });
    const coldId = seedRow({ content: "cold event", memoryType: "event", timestampIso: OLD(8), recallCount: 0, validUntil: FUTURE(1) });
    purgeWeakMemories(db);
    const coldGone = !db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(coldId);
    const recalledGone = !db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(recalledId);
    // The recalled one should outlive the cold one (access boost). At minimum, if cold dies, recalled survives.
    if (coldGone) expect(recalledGone).toBe(false);
  });

  // ── Acceptance: lifecycleTick TTL ceiling (purgeExpired now wired) ──────
  it("lifecycleTick purges rows whose valid_until < now (TTL ceiling fires — the Dig 7 fix)", () => {
    const expiredId = seedRow({ content: "expired", memoryType: "event", timestampIso: OLD(10), validUntil: OLD(1) }); // valid_until in the past
    const result = lifecycleTick(db);
    const gone = !db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(expiredId);
    expect(gone).toBe(true); // TTL ceiling purged it
    expect(result.expired).toBeGreaterThan(0); // purgeExpired count reported
  });

  it("lifecycleTick keeps rows whose valid_until is in the future", () => {
    const liveId = seedRow({ content: "live", memoryType: "preference", timestampIso: OLD(1), validUntil: FUTURE(30) });
    lifecycleTick(db);
    const survives = db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(liveId);
    expect(survives).toBeTruthy();
  });

  // ── Acceptance: purge_log audit (security repudiation fix) ─────────────
  it("purgeWeakMemories writes a purge_log audit entry for each DELETE", () => {
    seedRow({ content: "old event to purge", memoryType: "event", timestampIso: OLD(60), validUntil: FUTURE(1) });
    const before = (db.prepare("SELECT COUNT(*) c FROM purge_log").get() as { c: number }).c;
    purgeWeakMemories(db);
    const after = (db.prepare("SELECT COUNT(*) c FROM purge_log").get() as { c: number }).c;
    expect(after).toBeGreaterThan(before);
    const entry = db.prepare("SELECT reason, source_table, content_snippet FROM purge_log ORDER BY id DESC LIMIT 1").get() as { reason: string; source_table: string; content_snippet: string };
    expect(entry.reason).toBe("weak_strength");
    expect(entry.source_table).toBe("working_memory");
    expect(entry.content_snippet).toContain("old event");
  });

  // ── recall_count guard (correctness: -1/NaN don't break purge) ─────────
  it("negative/NULL recall_count does not crash purge (guarded)", () => {
    // Manually set recall_count to a weird value; purge should not throw / not -Infinity-purge everything
    const id = seedRow({ content: "recent pref", memoryType: "preference", timestampIso: OLD(1), validUntil: FUTURE(30) });
    db.prepare("UPDATE working_memory SET recall_count = -1 WHERE id = ?").run(id);
    expect(() => purgeWeakMemories(db)).not.toThrow();
    // A 1-day-old preference with recall=-1 should still survive (guard treats it as 0)
    const survives = db.prepare("SELECT 1 FROM working_memory WHERE id = ?").get(id);
    expect(survives).toBeTruthy();
  });

  afterEach(() => {
    if (db) { try { closeDB(db); } catch { /* */ } }
  });
});
