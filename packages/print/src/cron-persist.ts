/**
 * Cron job persistence (Phase 0B). The CronScheduler stays fs-free (minimal-core);
 * this module owns the atomic file write/read on the gateway side.
 *
 * `cron.json` is the single source of truth. Writes are atomic (tmpfile → fsync →
 * rename, mode 0600); reads tolerate both the legacy bare-array shape and the
 * `{jobs:[...]}` envelope. The scheduler's `reconcile()` consumes the loaded set.
 *
 * Security (Phase 3B): `validateCronPrompt` is wired as the scheduler reconcile
 * `validate` hook — loaded jobs are scanned + capped before entering the Map.
 */
import {
  existsSync, readFileSync, writeFileSync, renameSync,
  openSync, closeSync, fsyncSync, chmodSync, mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const CRON_DIR = join(homedir(), ".mya", "agent");
export const CRON_FILE = join(CRON_DIR, "cron.json");

/** A cron.json row (minimal — old files lack leaseMs/timezone). */
export interface CronFileJob {
  id: string;
  name: string;
  trigger: "cron" | "on-interval" | "once";
  schedule: string | number;
  prompt: string;
  enabled: boolean;
  deliveryTarget: string;
  leaseMs?: number;
  timezone?: string;
}

/** Read + parse cron.json. Tolerates bare-array and {jobs:[...]} shapes. [] on
 * any error (missing/corrupt) so the scheduler treats it as empty rather than
 * crashing the sweep. */
export function readCronJobs(path = CRON_FILE): CronFileJob[] {
  try {
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (Array.isArray(data)) return data as CronFileJob[];
    if (data && typeof data === "object" && Array.isArray((data as { jobs?: unknown }).jobs)) {
      return (data as { jobs: CronFileJob[] }).jobs;
    }
    return [];
  } catch {
    return [];
  }
}

/** Atomically write the full job list (tmpfile → fsync → chmod 0600 → rename). */
export function atomicWriteJobs(jobs: CronFileJob[], path = CRON_FILE): void {
  mkdirSync(CRON_DIR, { recursive: true });
  const dir = dirname(path);
  const tmp = join(dir, `.cron.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  // durability: fsync the tmp file before rename (POSIX rename is atomic).
  try {
    const fd = openSync(tmp, "r");
    fsyncSync(fd);
    closeSync(fd);
  } catch {
    /* fsync best-effort (some FS / Windows) */
  }
  try { chmodSync(tmp, 0o600); } catch { /* 0600 best-effort */ }
  renameSync(tmp, path);
}
