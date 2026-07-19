/** Phase 4: cron observability — durable run history (SQLite) + sweep heartbeat.
 *
 * Run records (RunRecord) are in-memory in the scheduler; this module MIRRORS
 * them to ~/.mya/agent/cron.db (better-sqlite3, already a dep via @my-agent/memory)
 * so history survives restarts + powers `mya cron history`. The heartbeat files
 * distinguish a dead ticker (both stale) from an alive-but-failing one (heartbeat
 * fresh, success stale). */
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync, statSync, openSync, closeSync, fsyncSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const AGENT_DIR = join(homedir(), ".mya", "agent");
const DB_FILE = join(AGENT_DIR, "cron.db");
const HEARTBEAT_FILE = join(AGENT_DIR, "cron_heartbeat");
const SUCCESS_FILE = join(AGENT_DIR, "cron_last_success");
const MAX_ROWS = 500;

let db: Database.Database | null = null;
function getDb(): Database.Database {
  if (!db) {
    try { mkdirSync(AGENT_DIR, { recursive: true }); } catch { /* best-effort */ }
    db = new Database(DB_FILE);
    db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE IF NOT EXISTS cron_runs (
      runId TEXT PRIMARY KEY, jobId TEXT NOT NULL, startedAt INTEGER NOT NULL,
      endedAt INTEGER, status TEXT NOT NULL, error TEXT, claimedBy TEXT
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(jobId, startedAt DESC)`);
  }
  return db;
}

export interface RunRow {
  runId: string;
  jobId: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  error?: string;
  claimedBy?: string;
}

/** Insert/replace a run row (on claim). Best-effort (DB unavailable → no-op). */
export function recordRunStart(rec: RunRow): void {
  try {
    getDb().prepare(
      "INSERT OR REPLACE INTO cron_runs (runId, jobId, startedAt, status, claimedBy) VALUES (?,?,?,?,?)",
    ).run(rec.runId, rec.jobId, rec.startedAt, rec.status ?? "claimed", rec.claimedBy ?? null);
  } catch { /* best-effort — in-memory runs still work */ }
}

/** Update a run row on completion. */
export function recordRunEnd(runId: string, status: string, error: string | null, endedAt: number): void {
  try {
    getDb().prepare("UPDATE cron_runs SET status=?, error=?, endedAt=? WHERE runId=?")
      .run(status, error, endedAt, runId);
    // prune to the most-recent MAX_ROWS
    getDb().prepare(
      "DELETE FROM cron_runs WHERE runId NOT IN (SELECT runId FROM cron_runs ORDER BY startedAt DESC LIMIT ?)",
    ).run(MAX_ROWS);
  } catch { /* best-effort */ }
}

/** Read a job's run history (most-recent first). */
export function getRunHistory(jobId: string, limit = 50): RunRow[] {
  try {
    return getDb().prepare("SELECT * FROM cron_runs WHERE jobId=? ORDER BY startedAt DESC LIMIT ?").all(jobId, limit) as RunRow[];
  } catch { return []; }
}

/** Phase 4C: write the heartbeat (every sweep) + success (clean sweep) markers.
 * Atomic (tmpfile + rename). epoch ms is the file's mtime/content. */
function writeEpoch(path: string, epochMs: number): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, String(epochMs));
    try { const fd = openSync(tmp, "r"); fsyncSync(fd); closeSync(fd); } catch { /* best-effort */ }
    renameSync(tmp, path);
  } catch { /* best-effort */ }
}

/** Called at the top of every cron sweep (alive marker). */
export function recordHeartbeat(): void {
  writeEpoch(HEARTBEAT_FILE, Date.now());
}

/** Called after a clean sweep (success marker). */
export function recordHeartbeatSuccess(): void {
  writeEpoch(SUCCESS_FILE, Date.now());
}

/** Heartbeat freshness for `mya cron status` / monitoring. Returns ages in ms
 * (undefined if a marker file is absent). */
export function heartbeatAge(): { heartbeatAgeMs?: number; successAgeMs?: number } {
  const age = (p: string): number | undefined => {
    try { return Date.now() - statSync(p).mtimeMs; } catch { return undefined; }
  };
  return { heartbeatAgeMs: age(HEARTBEAT_FILE), successAgeMs: age(SUCCESS_FILE) };
}

export const CRON_HISTORY_DB = DB_FILE;
