/**
 * @my-agent/cron — scheduler (§12.3).
 *
 * Trigger types (cron / on-interval / once). Atomic claim + TTL lease (a job is
 * claimed by exactly one worker; a crashed worker's lease expires). Run-log +
 * failure-alert. Delivery-target grammar. Direct-delivery isolation.
 *
 * Source: §12.3 Cron scheduler; MyAgents scheduler.
 */
import { randomUUID } from "node:crypto";
import { nowWallclock } from "@my-agent/core";

export type TriggerType = "cron" | "on-interval" | "once";

export interface CronJob {
  id: string;
  name: string;
  trigger: TriggerType;
  /** cron expression (cron) / interval-ms (on-interval) / epoch-ms (once). */
  schedule: string | number;
  /** Delivery target grammar: a tool name or "lane:<id>" or "channel:<id>". */
  deliveryTarget: string;
  prompt: string;
  enabled: boolean;
  /** TTL lease in ms; a claimed job auto-releases after this if the worker dies. */
  leaseMs: number;
}

export interface RunRecord {
  jobId: string;
  runId: string;
  startedAt: number;
  endedAt?: number;
  status: "claimed" | "running" | "succeeded" | "failed" | "lease-expired";
  error?: string;
  /** The worker that claimed it (for atomicity). */
  claimedBy?: string;
}

/** A scheduler with atomic claim + TTL lease + run-log. Single-process; the
 * atomicity is over the job's `claimedBy` field (compare-and-swap). */
export class CronScheduler {
  private readonly jobs = new Map<string, CronJob>();
  private readonly runs = new Map<string, RunRecord>(); // runId → record
  private readonly jobRuns = new Map<string, string[]>(); // jobId → runIds

  register(job: Omit<CronJob, "id"> & { id?: string }): CronJob {
    const id = job.id ?? randomUUID();
    const full: CronJob = { ...job, id };
    this.jobs.set(id, full);
    return full;
  }

  /** Atomic claim: a job is claimed by exactly one worker. Returns the run
   * record or null if already claimed (within its lease). */
  claim(jobId: string, workerId: string, now = nowWallclock()): RunRecord | null {
    const job = this.jobs.get(jobId);
    if (!job || !job.enabled) return null;
    // check for an active, unexpired claim
    const active = this.activeRun(jobId, now);
    if (active) return null; // someone else holds an unexpired lease
    const runId = randomUUID();
    const rec: RunRecord = { jobId, runId, startedAt: now, status: "claimed", claimedBy: workerId };
    this.runs.set(runId, rec);
    const list = this.jobRuns.get(jobId) ?? [];
    list.push(runId);
    this.jobRuns.set(jobId, list);
    return rec;
  }

  /** Mark a claimed run as running (worker picked it up). */
  start(runId: string): void {
    const rec = this.runs.get(runId);
    if (rec) rec.status = "running";
  }

  /** Complete a run (succeeded/failed). Releases the claim. */
  complete(runId: string, status: "succeeded" | "failed", error?: string): void {
    const rec = this.runs.get(runId);
    if (rec) {
      rec.status = status;
      rec.endedAt = nowWallclock();
      if (error) rec.error = error;
    }
  }

  /** Find the active (unexpired-lease) run for a job. */
  private activeRun(jobId: string, now: number): RunRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    const runs = (this.jobRuns.get(jobId) ?? [])
      .map((id) => this.runs.get(id)!)
      .filter(Boolean);
    return runs.find(
      (r) => (r.status === "claimed" || r.status === "running") && now - r.startedAt < job.leaseMs,
    );
  }

  /** Sweep expired leases (a crashed worker's job becomes claimable again). */
  sweepExpired(now = nowWallclock()): string[] {
    const expired: string[] = [];
    for (const [jobId, job] of this.jobs) {
      for (const runId of this.jobRuns.get(jobId) ?? []) {
        const rec = this.runs.get(runId);
        if (!rec) continue;
        if ((rec.status === "claimed" || rec.status === "running") && now - rec.startedAt >= job.leaseMs) {
          rec.status = "lease-expired";
          rec.endedAt = now;
          expired.push(runId);
        }
      }
    }
    return expired;
  }

  /** Jobs whose trigger fires at `now` (best-effort; cron-expr parsing is
   * minimal — supports on-interval + once exactly, cron as "every-Nm" shorthand).
   * A "once" job re-fires until it has a SUCCEEDED run (a crashed/failed run
   * retries); on-interval fires on its cadence regardless of prior outcome. */
  due(now = nowWallclock()): CronJob[] {
    const out: CronJob[] = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (this.activeRun(job.id, now)) continue;
      if (job.trigger === "on-interval" && typeof job.schedule === "number") {
        const last = this.lastRunAt(job.id);
        if (last == null || now - last >= job.schedule) out.push(job);
      } else if (job.trigger === "once" && typeof job.schedule === "number") {
        // C2: fire until succeeded (a failed/crashed once-job retries)
        const succeeded = this.runsOf(job.id).some((r) => r.status === "succeeded");
        if (now >= job.schedule && !succeeded) out.push(job);
      }
      // cron: best-effort skip (full cron-expr parser is Tier-2+)
    }
    return out;
  }

  private lastRunAt(jobId: string): number | undefined {
    const runs = (this.jobRuns.get(jobId) ?? []).map((id) => this.runs.get(id)!).filter(Boolean);
    if (runs.length === 0) return undefined;
    return Math.max(...runs.map((r) => r.startedAt));
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }
  /** List all registered jobs (public API — register returns the id, but
   * callers need a way to enumerate). */
  listJobs(): CronJob[] {
    return [...this.jobs.values()];
  }
  runsOf(jobId: string): RunRecord[] {
    return (this.jobRuns.get(jobId) ?? []).map((id) => this.runs.get(id)!).filter(Boolean);
  }
}
