/**
 * @my-agent/memory/sqlite-schema — Schema initialization for the memory database.
 *
 * Following mnemopi/src/core/beam/schema.ts pattern:
 *   - 2-tier: working_memory (L0) + episodic_memory (L1)
 *   - Structured facts: facts + triples (L2)
 *   - FTS5 virtual tables with trigger-synced content
 *   - Schema migration via addColumnIfMissing
 *
 * SQLite IS the store. No in-memory Maps.
 */
import type { SqliteDatabase } from "./sqlite-db.js";

/** Check if a column exists; add it if missing. Returns true if added.
 *  Identifiers are escaped to prevent SQL injection (review HIGH #2). */
function addColumnIfMissing(db: SqliteDatabase, table: string, column: string, definition: string): boolean {
  const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as Array<{ name: string }>;
  for (const row of rows) {
    if (row.name === column) return false;
  }
  db.exec(`ALTER TABLE "${table.replace(/"/g, '""')}" ADD COLUMN "${column.replace(/"/g, '""')}" ${definition}`);
  return true;
}

/** Run multiple SQL statements. */
function runAll(db: SqliteDatabase, statements: readonly string[]): void {
  for (const stmt of statements) db.exec(stmt);
}

/** Migrate old inline-content `fts_working` to external-content format.
 *
 *  For databases created before the external-content schema change, the
 *  `CREATE VIRTUAL TABLE IF NOT EXISTS` above is a no-op (table exists).
 *  This function detects the old format via `sqlite_master.sql`, drops the
 *  old table + triggers, recreates with external-content, and repopulates
 *  the index from `working_memory`.
 *
 *  Idempotent: if the table already uses external-content, does nothing. */
function migrateFtsWorkingToExternalContent(db: SqliteDatabase): void {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='fts_working'`,
  ).get() as { sql: string } | undefined;
  if (!row?.sql) return; // table doesn't exist yet (CREATE IF NOT EXISTS will handle)

  // Already external-content?
  if (/content\s*=\s*'working_memory'/i.test(row.sql)) return;

  // Old inline-content format detected — migrate
  // 1. Drop old triggers (will be recreated below with new SQL)
  db.exec("DROP TRIGGER IF EXISTS wm_ai");
  db.exec("DROP TRIGGER IF EXISTS wm_ad");
  db.exec("DROP TRIGGER IF EXISTS wm_au");

  // 2. Drop old FTS table (inline content)
  db.exec("DROP TABLE IF EXISTS fts_working");

  // 3. Create new external-content FTS table
  db.exec(`
    CREATE VIRTUAL TABLE fts_working USING fts5(
      content,
      content='working_memory',
      content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `);

  // 4. Repopulate index from existing working_memory rows
  try {
    db.exec(`
      INSERT INTO fts_working(rowid, content)
      SELECT rowid, COALESCE(content, '') || COALESCE(embed_text, '')
      FROM working_memory
    `);
  } catch { /* embed_text column may not exist on very old DBs */ }
}

/**
 * Initialize the full schema. Idempotent — safe to call on every startup.
 * Creates tables, FTS5 virtual tables, triggers, and indexes.
 */
export function initSchema(db: SqliteDatabase): void {
  // ── L0: Working memory (raw facts, session-scoped) ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embed_text TEXT DEFAULT NULL,
      source TEXT DEFAULT '',
      timestamp TEXT NOT NULL,
      session_id TEXT DEFAULT 'default',
      importance REAL DEFAULT 0.5,
      metadata_json TEXT DEFAULT '{}',
      veracity TEXT DEFAULT 'unknown',
      memory_type TEXT DEFAULT 'general',
      consolidated_at TEXT,
      recall_count INTEGER DEFAULT 0,
      last_recalled TEXT DEFAULT NULL,
      valid_until TEXT DEFAULT NULL,
      superseded_by TEXT DEFAULT NULL,
      scope TEXT DEFAULT 'global',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── L1: Episodic memory (consolidated summaries) ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memory (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT '',
      timestamp TEXT NOT NULL,
      session_id TEXT DEFAULT 'default',
      importance REAL DEFAULT 0.5,
      metadata_json TEXT DEFAULT '{}',
      summary_of TEXT DEFAULT '',
      veracity TEXT DEFAULT 'unknown',
      tier INTEGER DEFAULT 1,
      degraded_at TEXT,
      memory_type TEXT DEFAULT 'general',
      recall_count INTEGER DEFAULT 0,
      last_recalled TEXT DEFAULT NULL,
      valid_until TEXT DEFAULT NULL,
      superseded_by TEXT DEFAULT NULL,
      scope TEXT DEFAULT 'global',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── L2: Structured facts (knowledge graph triples) ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      fact_id TEXT PRIMARY KEY,
      session_id TEXT DEFAULT 'default',
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      timestamp TEXT,
      source_msg_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS triples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from TEXT DEFAULT (datetime('now')),
      valid_until TEXT,
      source TEXT DEFAULT '',
      confidence REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Consolidation log ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS consolidation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      items_consolidated INTEGER,
      summary_preview TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Indexes ─────────────────────────────────────────────────────────────
  runAll(db, [
    "CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_wm_timestamp ON working_memory(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_wm_source ON working_memory(source)",
    "CREATE INDEX IF NOT EXISTS idx_wm_unconsolidated ON working_memory(session_id, timestamp) WHERE consolidated_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_wm_session_recall ON working_memory(session_id, last_recalled) WHERE valid_until IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_em_session ON episodic_memory(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_em_timestamp ON episodic_memory(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_em_tier ON episodic_memory(tier)",
    "CREATE INDEX IF NOT EXISTS idx_em_scope_imp ON episodic_memory(scope, importance) WHERE superseded_by IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject)",
    "CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject)",
    "CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate)",
    "CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object)",
  ]);

  // ── Dig 3 Phase B: Brain storage tables (brain_* — full-fidelity CRUD) ────
  // Dedicated tables for Brain's Fact/Take/Page/Tombstone state (§4 DDL).
  // No FTS5/triggers — Brain has its own backlinks() regex extraction.
  // All columns map 1:1 to brain.ts Fact/Take/BrainPage fields.
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_facts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'fact',
      entity TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private',
      notability REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      valid_from INTEGER,
      valid_until INTEGER,
      consolidated_at INTEGER,
      consolidated_into TEXT,
      embedded INTEGER NOT NULL DEFAULT 0,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER,
      strength REAL,
      hlc_json TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_takes (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      synthesized_at INTEGER NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]'
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL DEFAULT '',
      compiled_truth TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_tombstones (
      id TEXT PRIMARY KEY,
      fact_json TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    )
  `);
  runAll(db, [
    "CREATE INDEX IF NOT EXISTS idx_brain_facts_entity ON brain_facts(entity)",
    "CREATE INDEX IF NOT EXISTS idx_brain_facts_source ON brain_facts(source)",
    "CREATE INDEX IF NOT EXISTS idx_brain_facts_unconsolidated ON brain_facts(source, entity) WHERE consolidated_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_brain_tombstones_deleted ON brain_tombstones(deleted_at)",
  ]);

  // ── FTS5: Full-text search (external-content, BM25 native) ────────────────
  // Working memory FTS — external-content: reads column values from
  // working_memory on demand (no inline text copy → ~75% size saving vs
  // contentless). content_rowid maps to the base table's implicit rowid.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_working USING fts5(
      content,
      content='working_memory',
      content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `);

  // Episodic memory FTS (content-synced via triggers)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_episodes USING fts5(
      content,
      content='episodic_memory',
      content_rowid='rowid',
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `);

  // Facts FTS (content-synced via triggers)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_facts USING fts5(
      subject, predicate, object,
      content='facts',
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `);

  // ── Migration: convert old inline-content fts_working to external-content ──
  migrateFtsWorkingToExternalContent(db);

  // ── FTS5 Triggers (auto-sync on INSERT/UPDATE/DELETE) ───────────────────
  // Working memory: external-content FTS (rowid-keyed). DROP+CREATE ensures
  // triggers are always the latest version after a schema migration.
  runAll(db, [
    `DROP TRIGGER IF EXISTS wm_ai`,
    `DROP TRIGGER IF EXISTS wm_ad`,
    `DROP TRIGGER IF EXISTS wm_au`,
    `CREATE TRIGGER wm_ai AFTER INSERT ON working_memory BEGIN
      INSERT INTO fts_working(rowid, content) VALUES (new.rowid, COALESCE(new.content, '') || COALESCE(new.embed_text, ''));
    END`,
    `CREATE TRIGGER wm_ad AFTER DELETE ON working_memory BEGIN
      INSERT INTO fts_working(fts_working, rowid, content) VALUES ('delete', old.rowid, COALESCE(old.content, '') || COALESCE(old.embed_text, ''));
    END`,
    `CREATE TRIGGER wm_au AFTER UPDATE OF content, embed_text ON working_memory BEGIN
      INSERT INTO fts_working(fts_working, rowid, content) VALUES ('delete', old.rowid, COALESCE(old.content, '') || COALESCE(old.embed_text, ''));
      INSERT INTO fts_working(rowid, content) VALUES (new.rowid, COALESCE(new.content, '') || COALESCE(new.embed_text, ''));
    END`,
  ]);

  // Episodic memory: content-synced FTS (rowid-keyed)
  runAll(db, [
    `CREATE TRIGGER IF NOT EXISTS em_ai AFTER INSERT ON episodic_memory BEGIN
      INSERT INTO fts_episodes(rowid, content) VALUES (new.rowid, new.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS em_ad AFTER DELETE ON episodic_memory BEGIN
      INSERT INTO fts_episodes(fts_episodes, rowid, content) VALUES ('delete', old.rowid, old.content);
    END`,
    `CREATE TRIGGER IF NOT EXISTS em_au AFTER UPDATE OF content ON episodic_memory BEGIN
      INSERT INTO fts_episodes(fts_episodes, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO fts_episodes(rowid, content) VALUES (new.rowid, new.content);
    END`,
  ]);

  // Facts: content-synced FTS (rowid-keyed)
  runAll(db, [
    `CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
      INSERT INTO fts_facts(rowid, subject, predicate, object)
      VALUES (new.rowid, new.subject, new.predicate, new.object);
    END`,
    `CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
      INSERT INTO fts_facts(fts_facts, rowid, subject, predicate, object)
      VALUES ('delete', old.rowid, old.subject, old.predicate, old.object);
    END`,
    `CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE OF subject, predicate, object ON facts BEGIN
      INSERT INTO fts_facts(fts_facts, rowid, subject, predicate, object)
      VALUES ('delete', old.rowid, old.subject, old.predicate, old.object);
      INSERT INTO fts_facts(rowid, subject, predicate, object)
      VALUES (new.rowid, new.subject, new.predicate, new.object);
    END`,
  ]);

  // ── Schema version ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Migrations for older databases ─────────────────────────────────────
  // R16+ schema adds `scope` (global/session). Old DBs created before this
  // column must be migrated, else every recall query referencing scope throws
  // "no such column: scope" and silently breaks all memory recall.
  addColumnIfMissing(db, "working_memory", "scope", "TEXT DEFAULT 'global'");
  addColumnIfMissing(db, "episodic_memory", "scope", "TEXT DEFAULT 'global'");
  // R17+: pinned column for retention protection (user/agent can pin a memory
  // so the Weibull purge never deletes it regardless of age/strength).
  addColumnIfMissing(db, "working_memory", "pinned", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "episodic_memory", "pinned", "INTEGER NOT NULL DEFAULT 0");
  // R18+ (Phase 3 scope-derived): agent_id (role) + turn_id columns for the
  // 3-tier scope model (common | role:X | session). scope_level is DERIVED from
  // which IDs are populated (headroom pattern), not stored as a separate column.
  // scope values: 'global' (common/brain) | 'role' (agent-scoped) | 'session'.
  addColumnIfMissing(db, "working_memory", "agent_id", "TEXT");
  addColumnIfMissing(db, "working_memory", "turn_id", "TEXT");
  addColumnIfMissing(db, "episodic_memory", "agent_id", "TEXT");
  addColumnIfMissing(db, "episodic_memory", "turn_id", "TEXT");
  // R19+ (Phase 5 governance): trust score [0,1] — feedback-driven (hermes holographic).
  // recall multiplies score by trust so low-trust memories rank lower. Default 0.5 (neutral).
  addColumnIfMissing(db, "working_memory", "trust", "REAL NOT NULL DEFAULT 0.5");
  addColumnIfMissing(db, "episodic_memory", "trust", "REAL NOT NULL DEFAULT 0.5");

  // Action #3 (docs/embeddings-cross-system.md): dense-vector embedding BLOB for
  // semantic recall. Populated in the background by the embedder (fastembed);
  // NULL = not-yet-embedded (recall falls back to FTS for that row). Float32
  // (4 bytes/dim); default model bge-small-en = 384 dims → 1536 bytes/vector.
  addColumnIfMissing(db, "working_memory", "embedding", "BLOB");
  addColumnIfMissing(db, "episodic_memory", "embedding", "BLOB");

  // R19+ (Phase 5 grounding): referent tracking (codebase-memory-mcp pattern).
  // Observations that reference a file/entity carry a content hash so recall can
  // detect staleness (metadata_changed) when the referent changes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS referents (
      memory_id TEXT NOT NULL,
      referent_path TEXT NOT NULL,
      sha256 TEXT,
      mtime_ms INTEGER,
      size INTEGER,
      recorded_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (memory_id, referent_path)
    )
  `);

  // R17+: purge audit log — every retention-driven DELETE records what was purged
  // and why, so an operator can answer "what did we forget today?" (security
  // review: repudiation concern). Mirrors the existing consolidation_log pattern.
  db.exec(`
    CREATE TABLE IF NOT EXISTS purge_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      row_id TEXT NOT NULL,
      memory_type TEXT,
      content_snippet TEXT,
      reason TEXT NOT NULL,
      strength_at_purge REAL,
      pinned INTEGER DEFAULT 0,
      purged_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Conflict audit log — every supersession records old/new + similarity, so an
  // operator can audit "why did this memory disappear?" (false-positive guard for
  // the jaccard conflict detector). Mirrors purge_log/consolidation_log pattern.
  db.exec(`
    CREATE TABLE IF NOT EXISTS conflict_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      old_id TEXT NOT NULL,
      new_id TEXT NOT NULL,
      memory_type TEXT,
      jaccard REAL NOT NULL,
      scope TEXT,
      agent_id TEXT,
      old_snippet TEXT,
      new_snippet TEXT,
      superseded_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Capture audit log — records autoCapture sentences that were SKIPPED (below
  // confidence / no match / duplicate), so an operator can answer "why wasn't X
  // remembered?" without re-reading the conversation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_snippet TEXT,
      matched_type TEXT,
      confidence REAL,
      reason TEXT NOT NULL,
      agent_id TEXT,
      session_id TEXT,
      skipped_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (1)").run();
}

/** Get schema version. */
export function getSchemaVersion(db: SqliteDatabase): number {
  const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
  return row?.v ?? 0;
}