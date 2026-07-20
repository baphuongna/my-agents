/**
 * @my-agent/memory/sqlite-db — SQLite wrapper with WAL + transaction support.
 *
 * Backend: better-sqlite3 (stable, synchronous, prebuilt native addon).
 * Previously used Node's experimental `node:sqlite`; switched to better-sqlite3
 * to avoid the ExperimentalWarning on every launch + use a production-stable
 * SQLite. API surface (exec/prepare/run/get/all/close) is compatible.
 *
 * Design:
 *   - SQLite IS the store (disk-primary, not RAM-primary)
 *   - WAL mode for concurrent readers + single writer
 *   - Busy timeout for write contention
 *   - Transaction helper with reentrant depth tracking
 *
 * File location: ~/.mya/memory/memory.db (+ -wal, -shm)
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nowWallclock } from "@my-agent/core";

// ── Minimal type-safe interface for the SQLite API surface we use ─────────
// This avoids importing the native addon at module eval time (which breaks
// vitest/esbuild resolution) while still providing type safety for all DB ops.

export interface SqliteStatement {
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | string };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

// Lazy-load better-sqlite3 — avoids breaking vitest/vite/esbuild which can't
// resolve the native addon at module evaluation time. createRequire resolves
// from this file's location at call time (runtime), finding better-sqlite3 in
// node_modules (bundled install or global node_modules).
let DatabaseCtor: (new (path: string, options?: Record<string, unknown>) => SqliteDatabase) | null = null;

function getDatabaseCtor(): new (path: string, options?: Record<string, unknown>) => SqliteDatabase {
  if (DatabaseCtor !== null) return DatabaseCtor;
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = req("better-sqlite3");
  // better-sqlite3 exports the Database class directly (module.exports = Database),
  // so `mod` IS the constructor. The ?? fallback also tolerates a { Database } shape.
  DatabaseCtor = (mod.Database ?? mod) as new (path: string, options?: Record<string, unknown>) => SqliteDatabase;
  return DatabaseCtor;
}

export type DatabasePath = string | ":memory:";

/** Open a SQLite database with WAL pragmas. */
export function openDB(path: DatabasePath): SqliteDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const Ctor = getDatabaseCtor();
  const db = new Ctor(path);
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
type TxDB = SqliteDatabase & { [TX_STATE]?: { depth: number } };

/** Detect SQLITE_BUSY / "database is locked" from better-sqlite3 (or the adapter). */
function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  return /SQLITE_BUSY|database is locked/i.test(`${e.code ?? ""} ${e.message ?? ""}`);
}

/** Synchronous sleep (better-sqlite3 is synchronous; no async sleep possible). */
function syncSleep(ms: number): void {
  const end = nowWallclock() + ms;
  while (nowWallclock() < end) { /* spin — only on rare contention */ }
}

/**
 * Run a function inside a SQLite transaction.
 * Reentrant: nested calls reuse the outer transaction.
 * Commits on success, rolls back on error.
 *
 * Retries on SQLITE_BUSY beyond the built-in busy_timeout (deep-dive Finding 8):
 * under cross-process contention a long DreamCycle consolidation can exceed the
 * 5s busy_timeout, which previously surfaced as a raw error to the agent. We now
 * roll back + retry the whole transaction up to 3× with exponential backoff so a
 * transient lock doesn't break a capture/recall/consolidation call.
 */
export function transaction<T>(db: SqliteDatabase, fn: () => T): T {
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

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 50;
  for (let attempt = 0; ; attempt++) {
    state = { depth: 1 };
    txDb[TX_STATE] = state;
    try {
      db.exec("BEGIN");
      const result = fn();
      state.depth = 0;
      db.exec("COMMIT");
      return result;
    } catch (error) {
      state.depth = 0;
      try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      if (isSqliteBusy(error) && attempt < MAX_RETRIES) {
        syncSleep(BASE_DELAY_MS * Math.pow(2, attempt)); // 50, 100, 200 ms
        continue;
      }
      throw error;
    } finally {
      delete txDb[TX_STATE];
    }
  }
}

/** Close database quietly (best-effort). */
export function closeDB(db: SqliteDatabase | null | undefined): void {
  if (!db) return;
  try { db.close(); } catch { /* best-effort */ }
}

/** WAL checkpoint + truncate (call on shutdown for clean wal file). */
export function checkpoint(db: SqliteDatabase): void {
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* best-effort */ }
}