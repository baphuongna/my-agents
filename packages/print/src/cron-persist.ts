/**
 * Cron job persistence (Phase 0B). The CronScheduler stays fs-free (minimal-core);
 * this module owns the atomic file write/read on the gateway side.
 *
 * `cron.json` is the single source of truth. Writes are atomic (tmpfile → fsync →
 * rename) and created mode 0600 (set at open-time via `flag:"wx",mode:0o600` to
 * avoid a TOCTOU window + symlink injection). Reads tolerate both the legacy
 * bare-array shape and the `{jobs:[...]}` envelope, with a size cap (OOM guard).
 *
 * Security (Phase 3B): `validateCronPrompt` is wired as the scheduler reconcile
 * `validate` hook — loaded jobs are scanned + capped before entering the Map.
 */
import {
  existsSync, readFileSync, writeFileSync, renameSync,
  openSync, closeSync, fsyncSync, chmodSync, mkdirSync,
  statSync, unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

export const CRON_DIR = join(homedir(), ".mya", "agent");
export const CRON_FILE = join(CRON_DIR, "cron.json");

/** Refuse to parse a cron.json larger than 1 MiB (OOM guard against a planted/
 * corrupted huge file). */
const MAX_CRON_FILE_BYTES = 1 * 1024 * 1024;

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
 * any error (missing/corrupt/too-large) so the scheduler treats it as empty
 * rather than crashing the sweep. */
export function readCronJobs(path = CRON_FILE): CronFileJob[] {
  try {
    if (!existsSync(path)) return [];
    // OOM guard: refuse a pathologically large file before reading it whole.
    try {
      const st = statSync(path);
      if (st.size > MAX_CRON_FILE_BYTES) {
        console.warn(`[cron] ${path} is ${st.size} bytes (>${MAX_CRON_FILE_BYTES}); skipping load`);
        return [];
      }
    } catch {
      /* stat best-effort */
    }
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

/** Atomically write the full job list. tmpfile is created with `flag:"wx"`
 * (O_CREAT|O_EXCL — fails if the path already exists, blocking symlink injection)
 * at mode 0600 (set at creation — no TOCTOU window), fsync'd, then renamed. */
export function atomicWriteJobs(jobs: CronFileJob[], path = CRON_FILE): void {
  // ensure CRON_DIR exists owner-only (0700); tighten a pre-existing looser dir.
  mkdirSync(CRON_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(CRON_DIR, 0o700); } catch { /* best-effort */ }
  const dir = dirname(path);
  const tmp = join(dir, `.cron.${process.pid}.${nowWallclock()}.tmp`);
  try {
    // flag "wx" = O_CREAT|O_EXCL: fails (EEXIST) if tmp exists, incl. as a
    // symlink → blocks a pre-planted symlink redirecting the write. mode 0600
    // at creation → no world-readable window before chmod.
    writeFileSync(tmp, JSON.stringify(jobs, null, 2), { flag: "wx", mode: 0o600 });
    try {
      const fd = openSync(tmp, "r");
      fsyncSync(fd);
      closeSync(fd);
    } catch {
      /* fsync best-effort (some FS / Windows) */
    }
    renameSync(tmp, path);
  } catch (e) {
    // cleanup the tmp file on any failure (chmod/rename/disk-full) so we don't
    // accumulate leaked .cron.*.tmp entries across failed sweeps.
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throw e;
  }
}
