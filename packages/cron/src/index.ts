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
  /** Optional IANA timezone for schedule evaluation (e.g. "America/New_York").
   * Falls back to process.env.MYA_TZ, then system local time. */
  timezone?: string;
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

  /** Jobs whose trigger fires at `now` (cron / on-interval / once). Cron-expr
   * jobs match against the current wall-clock minute; on-interval fires on cadence;
   * once fires until succeeded. A "once" job re-fires until it has a SUCCEEDED
   * run (a crashed/failed run retries); on-interval fires on its cadence
   * regardless of prior outcome. */
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
      else if (job.trigger === "cron" && typeof job.schedule === "string") {
        if (matchesCronExpr(job.schedule, new Date(now), job.timezone)) out.push(job);
      }
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

// ── Cron expression parser (5-field: min hour dom month dow) ─────────────
const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};
const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function parseField(field: string, min: number, max: number, names?: Record<string, number>): number[] {
  if (field === "*") return range(min, max);
  const result: number[] = [];
  for (const part of field.split(",")) {
    // Step: */N or A-B/N or A/N
    const stepMatch = part.match(/^(.+?)\/(\d+)$/);
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (step < 1) return result; // guard: */0 would infinite-loop
    const rangePart = stepMatch ? stepMatch[1]! : part;
    let lo: number, hi: number;
    if (rangePart === "*") { lo = min; hi = max; }
    else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = resolveVal(a ?? "", names); hi = resolveVal(b ?? "", names);
    } else {
      lo = resolveVal(rangePart, names);
      hi = stepMatch ? max : lo;
    }
    for (let v = lo; v <= hi; v += step) result.push(v);
  }
  return result;
}

function resolveVal(s: string, names?: Record<string, number>): number {
  const upper = s.toUpperCase();
  if (names && upper in names) return names[upper]!;
  return Number(s);
}

function range(lo: number, hi: number): number[] {
  const r: number[] = [];
  for (let v = lo; v <= hi; v++) r.push(v);
  return r;
}

/**
 * Extract cron-relevant date parts (minute, hour, day-of-month, month,
 * day-of-week) from a Date in local time or a specific timezone.
 *
 * By default, uses system local time (getHours, getMinutes, etc.). When a
 * `timezone` is passed or `MYA_TZ` is set, parts are resolved for that
 * timezone via `Intl.DateTimeFormat`.
 */
function getCronParts(date: Date, timezone?: string): {
  minute: number; hour: number; dom: number; month: number; dow: number;
} {
  const tz = timezone ?? process.env["MYA_TZ"];
  if (!tz) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dom: date.getDate(),
      month: date.getMonth() + 1,
      dow: date.getDay(),
    };
  }
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      minute: "numeric",
      hour: "numeric",
      day: "numeric",
      month: "numeric",
      weekday: "short",
    });
    const parts = fmt.formatToParts(date);
    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const dowNames: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return {
      minute: Number(get("minute")),
      hour: Number(get("hour")) % 24,
      dom: Number(get("day")),
      month: Number(get("month")),
      dow: dowNames[get("weekday")] ?? date.getDay(),
    };
  } catch {
    // MEDIUM-1 fix: invalid timezone string — fall back to local time
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dom: date.getDate(),
      month: date.getMonth() + 1,
      dow: date.getDay(),
    };
  }
}

/**
 * Check if a 5-field cron expression matches the given date.
 *
 * **Timezone behavior:** By default, matching uses system local time
 * (getHours/getMinutes/etc.). Pass an IANA timezone name (e.g.
 * `"America/New_York"`) as the third argument to evaluate in a specific
 * zone. If `MYA_TZ` is set in the environment, it serves as the default
 * timezone when no explicit argument is provided.
 *
 * @param expr - 5-field cron expression (min hour dom month dow)
 * @param date - the date to evaluate
 * @param timezone - optional IANA timezone (e.g. "UTC", "America/New_York")
 */
export function matchesCronExpr(expr: string, date: Date, timezone?: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hourF, domF, monthF, dowF] = fields;

  const minutes = parseField(minF!, 0, 59);
  const hours = parseField(hourF!, 0, 23);
  const doms = parseField(domF!, 1, 31);
  const months = parseField(monthF!, 1, 12, MONTH_NAMES);
  const dows = parseField(dowF!, 0, 7, DOW_NAMES).map((d) => d % 7); // 7→0 (Sunday)

  const parts = getCronParts(date, timezone);

  return (
    minutes.includes(parts.minute) &&
    hours.includes(parts.hour) &&
    doms.includes(parts.dom) &&
    months.includes(parts.month) &&
    dows.includes(parts.dow)
  );
}
