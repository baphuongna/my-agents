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

  // ── FTS5: Full-text search (trigger-synced, BM25 native) ────────────────
  // Working memory FTS (standalone — content indexed on INSERT)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_working USING fts5(
      id UNINDEXED,
      content,
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

  // ── FTS5 Triggers (auto-sync on INSERT/UPDATE/DELETE) ───────────────────
  // Working memory: standalone FTS (id-keyed)
  runAll(db, [
    `CREATE TRIGGER IF NOT EXISTS wm_ai AFTER INSERT ON working_memory BEGIN
      INSERT INTO fts_working(id, content) VALUES (new.id, COALESCE(new.content, '') || COALESCE(new.embed_text, ''));
    END`,
    `CREATE TRIGGER IF NOT EXISTS wm_ad AFTER DELETE ON working_memory BEGIN
      DELETE FROM fts_working WHERE id = old.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS wm_au AFTER UPDATE OF content, embed_text ON working_memory BEGIN
      DELETE FROM fts_working WHERE id = old.id;
      INSERT INTO fts_working(id, content) VALUES (new.id, COALESCE(new.content, '') || COALESCE(new.embed_text, ''));
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
  db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (1)").run();
}

/** Get schema version. */
export function getSchemaVersion(db: SqliteDatabase): number {
  const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
  return row?.v ?? 0;
}