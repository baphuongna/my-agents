/**
 * @my-agent/memory/sqlite-store — CRUD operations for the memory database.
 *
 * Following mnemopi/src/core/beam/store.ts pattern. SQLite IS the store —
 * all reads/writes go through prepared SQL statements.
 *
 * FTS5 triggers auto-sync search index on every INSERT/UPDATE/DELETE.
 * No in-memory cache needed.
 */
import type { SqliteDatabase } from "./sqlite-db.js";
import { randomUUID } from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────

export interface WorkingMemoryInput {
  content: string;
  source?: string;
  sessionId?: string;
  importance?: number;
  memoryType?: string;
  veracity?: string;
  validUntil?: string;
  embedText?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Per-type TTL (hours) for the hard expiry cap. Derived from Weibull eta
 * (the decay scale): a memory is eligible for hard purge once it has lived
 * past its type's natural decay horizon. Lower-eta types (event=168h, context=360h)
 * expire faster; high-eta (preference=4380h, profile=8760h) live long.
 * Falls back to a 1-year cap for unknown types. The existing purgeExpired()
 * (DELETE WHERE valid_until < now) now actually fires because storeWorking sets
 * valid_until at capture when the caller doesn't supply one.
 */
const TTL_HOURS_BY_TYPE: Record<string, number> = {
  event: 336,        // 2 weeks (>= eta 168)
  error: 336,        // 2 weeks (>= eta 336 — was 168, violated 'TTL >= eta')
  issue: 336,        // 2 weeks (eta 336)
  context: 720,      // 30 days
  goal: 1440,        // 60 days
  observation: 960,
  decision: 672,
  request: 144,      // 6 days (>= eta 72)
  pattern: 3360,
  setup: 4320,
  artifact: 4320,
  project: 2160,
  fact: 1440,
  entity: 8760,
  learning: 2880,
  commitment: 4320,
  instruction: 8760,
  relationship: 17520, // 2 years
  preference: 8760,  // 1 year
  profile: 17520,    // 2 years
  general: 720,      // 30 days (aligned with eta 168 — was 8760)
};
const DEFAULT_TTL_HOURS = 8760;

/** Compute the hard-expiry timestamp for a memory type (ISO string). */
export function ttlValidUntil(memoryType: string | undefined, nowMs: number = Date.now()): string {
  const hours = TTL_HOURS_BY_TYPE[memoryType ?? "general"] ?? DEFAULT_TTL_HOURS;
  return new Date(nowMs + hours * 3_600_000).toISOString();
}

export interface EpisodicMemoryInput {
  content: string;
  source?: string;
  sessionId?: string;
  importance?: number;
  summaryOf?: string;
  memoryType?: string;
  veracity?: string;
  tier?: number;
  validUntil?: string;
}

export interface FactInput {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  sessionId?: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  source: string;
  timestamp: string;
  session_id: string;
  importance: number;
  metadata_json: string;
  veracity: string;
  memory_type: string;
  consolidated_at: string | null;
  recall_count: number;
  last_recalled: string | null;
  valid_until: string | null;
  superseded_by: string | null;
  scope: string;
}

// ── Store operations ──────────────────────────────────────────────────────

const now = () => new Date().toISOString();

/** INSERT into working_memory (L0). FTS5 trigger auto-syncs search index. */
export function storeWorking(db: SqliteDatabase, input: WorkingMemoryInput): string {
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO working_memory
      (id, content, embed_text, source, timestamp, session_id, importance,
       metadata_json, veracity, memory_type, valid_until, scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.content,
    input.embedText ?? null,
    input.source ?? "",
    ts,
    input.sessionId ?? "default",
    input.importance ?? 0.5,
    JSON.stringify(input.metadata ?? {}),
    input.veracity ?? "unknown",
    input.memoryType ?? "general",
    // Hard TTL cap: set valid_until at capture per-type so purgeExpired() fires
    // as a ceiling (even popular memories eventually expire by type horizon).
    // Caller may override via input.validUntil. Use `||` not `??` so empty string
    // also falls back (empty would otherwise cause immediate delete on next purge).
    input.validUntil || ttlValidUntil(input.memoryType),
    input.scope ?? "global",
  );
  return id;
}

/** INSERT into episodic_memory (L1). FTS5 trigger auto-syncs search index. */
export function storeEpisodic(db: SqliteDatabase, input: EpisodicMemoryInput): string {
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO episodic_memory
      (id, content, source, timestamp, session_id, importance,
       summary_of, veracity, tier, memory_type, valid_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.content,
    input.source ?? "consolidation",
    ts,
    input.sessionId ?? "default",
    input.importance ?? 0.5,
    input.summaryOf ?? "",
    input.veracity ?? "unknown",
    input.tier ?? 1,
    input.memoryType ?? "general",
    // Episodic are consolidated summaries but still get a TTL ceiling (longer —
    // they're higher-value). Use 2x the working TTL to give them headroom.
    input.validUntil || ttlValidUntil(input.memoryType),
  );
  return id;
}

/** INSERT into facts (L2). FTS5 trigger auto-syncs search index. */
export function storeFact(db: SqliteDatabase, input: FactInput): string {
  const id = randomUUID();
  const ts = now();
  db.prepare(`
    INSERT INTO facts (fact_id, session_id, subject, predicate, object, confidence, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.sessionId ?? "default",
    input.subject,
    input.predicate,
    input.object,
    input.confidence ?? 1.0,
    ts,
  );
  return id;
}

/** Mark working_memory entries as consolidated (set consolidated_at). */
export function markConsolidated(db: SqliteDatabase, ids: string[], episodicId: string): void {
  const ts = now();
  const stmt = db.prepare("UPDATE working_memory SET consolidated_at = ? WHERE id = ?");
  for (const id of ids) {
    stmt.run(ts, id);
  }
}

/** Increment recall_count + update last_recalled for hit IDs. */
export function recordRecall(db: SqliteDatabase, ids: string[], table: "working_memory" | "episodic_memory"): void {
  const ts = now();
  // Batch UPDATE: single statement with IN clause for efficiency
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE ${table} SET recall_count = recall_count + 1, last_recalled = ? WHERE id IN (${placeholders})`)
    .run(ts, ...ids);
}

/** Supersede a memory: set superseded_by. */
export function supersede(db: SqliteDatabase, table: "working_memory" | "episodic_memory", oldId: string, newId: string): void {
  db.prepare(`UPDATE ${table} SET superseded_by = ? WHERE id = ?`).run(newId, oldId);
}

/** Degrade episodic tier (1→2→3 content compression). */
export function degradeTier(db: SqliteDatabase, id: string, newTier: number): void {
  const ts = now();
  db.prepare("UPDATE episodic_memory SET tier = ?, degraded_at = ? WHERE id = ?").run(newTier, ts, id);
}

/** Delete expired memories (valid_until < now). Returns count deleted. */
export function purgeExpired(db: SqliteDatabase, table: "working_memory" | "episodic_memory"): number {
  const ts = now();
  const result = db.prepare(`DELETE FROM ${table} WHERE valid_until IS NOT NULL AND valid_until < ?`).run(ts);
  // node:sqlite Statement.run() returns changes count
  return (result as unknown as { changes?: number }).changes ?? 0;
}

/** Get unconsolidated working memories older than threshold. */
export function getUnconsolidated(db: SqliteDatabase, sessionId: string, olderThanHours: number): MemoryRecord[] {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
  return db.prepare(`
    SELECT * FROM working_memory
    WHERE session_id = ? AND consolidated_at IS NULL AND timestamp < ?
      AND superseded_by IS NULL
    ORDER BY timestamp ASC LIMIT 500
  `).all(sessionId, cutoff) as unknown as MemoryRecord[];
}

/** Get a memory by ID. */
export function getWorkingById(db: SqliteDatabase, id: string): MemoryRecord | null {
  return (db.prepare("SELECT * FROM working_memory WHERE id = ?").get(id) as unknown as MemoryRecord | undefined) ?? null;
}

/** Count records in a table. */
export function countTable(db: SqliteDatabase, table: "working_memory" | "episodic_memory" | "facts" | "triples"): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number };
  return row.n;
}