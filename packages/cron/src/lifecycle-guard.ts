/**
 * @my-agent/cron — Lifecycle guard.
 *
 * F2: tracks restart frequency per job. If a job fires too many times in a
 * short window (restart loop / flapping), it is auto-disabled + a warning
 * is emitted. Prevents runaway job cascades from burning API quota.
 *
 * Source: §12.3 Cron (lifecycle_guard), PLAN-FEATURES F2.
 */
import { nowWallclock } from "@my-agent/core";

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_RESTARTS = 5; // 5 fires in 60s = flapping

export interface LifecycleGuardOptions {
  windowMs?: number;
  maxRestarts?: number;
}

export class LifecycleGuard {
  private readonly windowMs: number;
  private readonly maxRestarts: number;
  private readonly fireHistory = new Map<string, number[]>(); // jobId → timestamps

  constructor(opts: LifecycleGuardOptions = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRestarts = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  }

  /** Record a fire event. Returns true if the job should be DISABLED (flapping). */
  recordFire(jobId: string, now: number = nowWallclock()): boolean {
    const history = this.fireHistory.get(jobId) ?? [];
    // Prune entries outside the window
    const cutoff = now - this.windowMs;
    const recent = history.filter((ts) => ts >= cutoff);
    recent.push(now);
    this.fireHistory.set(jobId, recent);
    return recent.length > this.maxRestarts;
  }

  /** Check if a job would be disabled if it fired now (without recording). */
  wouldDisable(jobId: string, now: number = nowWallclock()): boolean {
    const history = this.fireHistory.get(jobId) ?? [];
    const cutoff = now - this.windowMs;
    const recent = history.filter((ts) => ts >= cutoff);
    return recent.length + 1 > this.maxRestarts;
  }

  /** Clear history for a job (on manual enable / config change). */
  clear(jobId: string): void {
    this.fireHistory.delete(jobId);
  }

  /** Clear all history (for testing). */
  clearAll(): void {
    this.fireHistory.clear();
  }
}
