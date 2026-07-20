/** Phase 4: cron observability — durable run history (SQLite) + sweep heartbeat.
 *
 * Run records (RunRecord) are in-memory in the scheduler; this module MIRRORS
 * them to ~/.mya/agent/cron.db (better-sqlite3, already a dep via @my-agent/memory)
 * so history survives restarts + powers `mya cron history`. The heartbeat files
 * distinguish a dead ticker (both stale) from an alive-but-failing one (heartbeat
 * fresh, success stale). */
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, statSync, openSync, closeSync, fsyncSync, renameSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// Paths are computed lazily (not at module load) so tests overriding $HOME get a
// fresh path per test (ESM caches the module namespace, not these calls).
const agentDir = (): string => join(homedir(), ".mya", "agent");
const dbFile = (): string => join(agentDir(), "cron.db");
const heartbeatFile = (): string => join(agentDir(), "cron_heartbeat");
const successFile = (): string => join(agentDir(), "cron_last_success");
const MAX_ROWS = 500;

let db: Database.Database | null = null;
/** @internal test seam: close + drop the cached db handle so a new HOME/path
 * takes effect (ESM caches the module namespace). */
export function _resetDbForTest(): void {
  try { db?.close(); } catch { /* best-effort */ }
  db = null;
}
function getDb(): Database.Database {
  if (!db) {
    try { mkdirSync(agentDir(), { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }
    db = new Database(dbFile());
    try { chmodSync(dbFile(), 0o600); } catch { /* best-effort — 0700 dir protects it */ }
    db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE IF NOT EXISTS cron_runs (
      runId TEXT PRIMARY KEY, jobId TEXT NOT NULL, startedAt INTEGER NOT NULL,
      endedAt INTEGER, status TEXT NOT NULL, error TEXT, claimedBy TEXT, output TEXT
    )`);
    // Phase 5: add output column to legacy tables (no-op if present).
    try { db.exec("ALTER TABLE cron_runs ADD COLUMN output TEXT"); } catch { /* already present */ }
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
  output?: string;
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
export function recordRunEnd(runId: string, status: string, error: string | null, endedAt: number, output?: string): void {
  try {
    getDb().prepare("UPDATE cron_runs SET status=?, error=?, endedAt=?, output=? WHERE runId=?")
      .run(status, error, endedAt, output ? output.slice(0, 100_000) : null, runId);
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

/** Phase 5: the latest non-empty output of a job (for context_from chaining). */
export function getLastOutput(jobId: string): string | undefined {
  try {
    const row = getDb().prepare("SELECT output FROM cron_runs WHERE jobId=? AND output IS NOT NULL AND output!='' ORDER BY startedAt DESC LIMIT 1").get(jobId) as { output?: string } | undefined;
    return row?.output;
  } catch { return undefined; }
}

/** Phase 4C: write the heartbeat (every sweep) + success (clean sweep) markers.
 * Atomic (tmpfile + rename). epoch ms is the file's mtime/content. */
function writeEpoch(path: string, epochMs: number): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, String(epochMs));
    try { const fd = openSync(tmp, "r"); fsyncSync(fd); closeSync(fd); } catch { /* best-effort */ }
    try { chmodSync(tmp, 0o600); } catch { /* best-effort */ }
    renameSync(tmp, path);
  } catch { /* best-effort */ }
}

/** Called at the top of every cron sweep (alive marker). */
export function recordHeartbeat(): void {
  writeEpoch(heartbeatFile(), Date.now());
}

/** Called after a clean sweep. NOTE: "success" means the sweep LOOP completed
 * without crashing — NOT that every job succeeded (a job can fail while the
 * ticker is healthy; check run history for per-job outcomes). */
export function recordHeartbeatSuccess(): void {
  writeEpoch(successFile(), Date.now());
}

/** Heartbeat freshness for `mya cron status` / monitoring. Returns ages in ms
 * (undefined if a marker file is absent). heartbeat-fresh + success-stale =
 * alive-but-failing ticker. */
export function heartbeatAge(): { heartbeatAgeMs?: number; successAgeMs?: number } {
  const age = (p: string): number | undefined => {
    try { return Date.now() - statSync(p).mtimeMs; } catch { return undefined; }
  };
  return { heartbeatAgeMs: age(heartbeatFile()), successAgeMs: age(successFile()) };
}
