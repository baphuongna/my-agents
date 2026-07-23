/**
 * Stale lock detection — TTL + PID liveness + atomic tombstone rename.
 *
 * Ported from Hermes gateway hardening (deep-dive.md §6.1).
 *
 * A lock file (`gateway_state.json` or a pid file) can be left behind by a
 * crashed process. Before another process can take over, the stale lock must be
 * removed **atomically** — multiple racers must not each think they won.
 *
 * Strategy:
 *  1. **TTL check** (120 s): a lock older than the TTL is suspect.
 *  2. **PID liveness** (`process.kill(pid, 0)`): is the holder still alive?
 *  3. **Tombstone rename** (`fs.renameSync(lock, lock + ".stale")`): POSIX
 *     rename is atomic — exactly one racer succeeds; the others get ENOENT.
 */

import { nowWallclock } from "@my-agent/core";
import {
  readFileSync,
  writeFileSync,
  writeSync,
  openSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";

/** A lock is considered suspect after this TTL (wallclock ms). */
const LOCK_STALE_TTL_MS = 120_000; // 2 minutes

export interface LockInfo {
  pid: number;
  /** Wallclock ms when the lock was created. */
  createdAt: number;
}

/**
 * Read and parse a lock file.
 * @returns `null` if the file doesn't exist or is malformed.
 */
export function readLock(lockPath: string): LockInfo | null {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number" || typeof parsed.createdAt !== "number") {
      return null;
    }
    return { pid: parsed.pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

/**
 * Check whether a PID is alive using `process.kill(pid, 0)`.
 *
 * - Signal 0 is a no-op existence probe.
 * - ESRCH (no such process) → dead.
 * - EPERM (exists but no permission) → alive (we just can't signal it).
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: process exists but we lack permission → treat as alive.
    if ((e as NodeJS.ErrnoException).code === "EPERM") return true;
    // ESRCH or anything else → dead.
    return false;
  }
}

/**
 * Is the lock at `lockPath` stale?
 *
 * A lock is stale when:
 *  - It is older than `LOCK_STALE_TTL_MS` (the TTL makes the claim suspect), OR
 *  - The holding PID is dead (crashed), even within the TTL.
 *
 * @param now  Current wallclock ms (injectable for deterministic tests).
 */
export function isLockStale(lockPath: string, now: number): boolean {
  const lock = readLock(lockPath);
  if (!lock) return false; // no lock → nothing to replace

  const age = now - lock.createdAt;
  if (age >= LOCK_STALE_TTL_MS) return true; // TTL exceeded → suspect

  // Within TTL: stale only if the holder is dead (crashed).
  return !isPidAlive(lock.pid);
}

/**
 * Atomically remove a stale lock via tombstone rename.
 *
 * `fs.renameSync` (POSIX `rename(2)`) is atomic: exactly one racer succeeds.
 * The others get ENOENT (the file was already renamed by the winner).
 *
 * After renaming to `.stale`, the tombstone is unlinked (best-effort cleanup).
 *
 * @returns `true` if THIS caller won the race (rename succeeded).
 */
export function removeStaleLockAtomic(lockPath: string): boolean {
  const tombstone = `${lockPath}.stale`;
  try {
    renameSync(lockPath, tombstone);
  } catch {
    // ENOENT: another racer already won, or lock never existed.
    return false;
  }
  // Best-effort tombstone cleanup.
  try {
    unlinkSync(tombstone);
  } catch {
    /* best-effort — another racer may have already cleaned up */
  }
  return true;
}

/**
 * Acquire a lock, or replace a stale one.
 *
 *  1. No lock exists → write a new one → `true`.
 *  2. Lock exists and PID is alive → `false` (can't acquire).
 *  3. Lock exists but PID is dead → atomically remove stale → write new → `true`.
 *     If another racer won the tombstone rename → `false`.
 *
 * @returns `true` if THIS process now holds the lock.
 */
export function acquireOrReplaceStaleLock(lockPath: string, pid: number): boolean {
  const existing = readLock(lockPath);

  if (!existing) {
    // No lock — acquire via O_EXCL (atomic exclusive create, prevents TOCTOU).
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid, createdAt: nowWallclock() }));
      closeSync(fd);
      return true;
    } catch {
      return false; // another racer just created it
    }
  }

  if (isPidAlive(existing.pid)) {
    // Lock held by a live process — can't acquire.
    return false;
  }

  // Lock held by a dead process — atomically remove then acquire.
  if (!removeStaleLockAtomic(lockPath)) {
    // Another racer won the tombstone rename.
    return false;
  }

  writeFileSync(lockPath, JSON.stringify({ pid, createdAt: nowWallclock() }));
  return true;
}
