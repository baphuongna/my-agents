/**
 * @my-agent/cron — Cross-process file lock (flock wrapper).
 * F4: prevents double-sweep when multiple gateway processes share cron.json.
 * Source: §12.3 Cron, PLAN-FEATURES F4.
 */
import { openSync, closeSync, readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

const LOCK_FILE = join(homedir(), ".mya", "agent", "cron.lock");
const LOCK_TTL_MS = 60_000;

/** Try to acquire the cross-process cron lock. Returns release function or null. */
export function acquireCronLock(workerId: string): (() => void) | null {
  try {
    if (existsSync(LOCK_FILE)) {
      const content = readFileSync(LOCK_FILE, "utf8").trim();
      const [pid, ts] = content.split(":");
      const age = nowWallclock() - Number(ts);
      // If lock is fresh AND process is alive, fail
      if (age < LOCK_TTL_MS && pid && process.kill(Number(pid), 0)) {
        return null; // lock held by another live process
      }
    }
    // Stale or missing — acquire
    mkdirSync(dirname(LOCK_FILE), { recursive: true });
    writeFileSync(LOCK_FILE, `${process.pid}:${nowWallclock()}`, { mode: 0o600 });
    return () => {
      try { if (existsSync(LOCK_FILE)) {
        const c = readFileSync(LOCK_FILE, "utf8").trim();
        if (c.startsWith(`${process.pid}:`)) {
          // Only release if we still own it
          unlinkSync(LOCK_FILE);
        }
      } } catch { /* best-effort */ }
    };
  } catch {
    return null;
  }
}
