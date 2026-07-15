/**
 * @my-agent/memory/sqlite-db — node:sqlite wrapper with WAL + transaction support.
 *
 * Following mnemopi/db.ts pattern, adapted for Node 22's built-in `node:sqlite`.
 *
 * Design:
 *   - SQLite IS the store (disk-primary, not RAM-primary)
 *   - WAL mode for concurrent readers + single writer
 *   - Busy timeout for write contention
 *   - Transaction helper with reentrant depth tracking
 *
 * File location: ~/.mya/memory/memory.db (+ -wal, -shm)
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DatabasePath = string | ":memory:";

/** Open a SQLite database with WAL pragmas. */
export function openDB(path: DatabasePath): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // mnemopi pragmas — battle-tested across context-mode, ctx, pi-session-manager
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA temp_store = MEMORY");
  return db;
}

/** Transaction state for reentrant detection. */
const TX_STATE = Symbol("mya.txState");
type TxDB = DatabaseSync & { [TX_STATE]?: { depth: number } };

/**
 * Run a function inside a SQLite transaction.
 * Reentrant: nested calls reuse the outer transaction.
 * Commits on success, rolls back on error.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const txDb = db as TxDB;
  let state = txDb[TX_STATE];
  if (state !== undefined && state.depth > 0) {
    state.depth++;
    try {
      return fn();
    } finally {
      state.depth--;
    }
  }
  state = { depth: 1 };
  txDb[TX_STATE] = state;
  db.exec("BEGIN");
  try {
    const result = fn();
    state.depth = 0;
    db.exec("COMMIT");
    return result;
  } catch (error) {
    state.depth = 0;
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    delete txDb[TX_STATE];
  }
}

/** Close database quietly (best-effort). */
export function closeDB(db: DatabaseSync | null | undefined): void {
  if (!db) return;
  try { db.close(); } catch { /* best-effort */ }
}

/** WAL checkpoint + truncate (call on shutdown for clean wal file). */
export function checkpoint(db: DatabaseSync): void {
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* best-effort */ }
}