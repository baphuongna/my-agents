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

// Phase 3B/3D: prompt-injection / lifecycle scanner (re-exported for the gateway).
export { validateCronPrompt, THREAT_IDS } from "./scan.js";

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
  /** Phase 2 (D3): the next fire time (epoch ms) for cron-trigger jobs. The
   * scheduler advances this BEFORE firing (at-most-once across crashes) and
   * re-anchors it off completion time. Absent on legacy rows → recovered on the
   * next dueAndAdvance(). */
  nextRunAt?: number;
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
 * atomicity is over the job's `claimedBy` field (compare-and-swap).
 *
 * Persistence (Phase 0B): the scheduler stays fs-free (minimal-core). The
 * gateway layer wires `onDirty` to atomically persist the full job list, and
 * calls `reconcile()` each sweep to pick up external (CLI) file edits. The
 * `jobs` Map is the in-memory cache; `cron.json` is the single source of truth.
 * Run records (`runs`/`jobRuns`) are in-memory only (history → Phase 4A SQLite). */
export class CronScheduler {
  private readonly jobs = new Map<string, CronJob>();
  private readonly runs = new Map<string, RunRecord>(); // runId → record
  private readonly jobRuns = new Map<string, string[]>(); // jobId → runIds
  /** Persist hook: gateway atomically writes the full job list. */
  private onDirty?: (jobs: CronJob[]) => void;
  /** True when in-memory state has unflushed mutations (cleared by markPersisted). */
  private dirty = false;
  /** Phase 3A: max registered jobs (DoS / cost-amplification bound). */
  private maxJobs = 50;
  /** Phase 3B: prompt validator (rejects injection/exfil/destructive prompts). */
  private validator?: (prompt: string | undefined | null) => string | null;

  constructor(opts: { onDirty?: (jobs: CronJob[]) => void; maxJobs?: number } = {}) {
    this.onDirty = opts.onDirty;
    if (opts.maxJobs != null) this.maxJobs = opts.maxJobs;
  }
  /** Wire persistence post-construction (the shared-instance singleton is built
   * before the gateway/fs layer exists). Idempotent. */
  setOnDirty(cb: (jobs: CronJob[]) => void): void { this.onDirty = cb; }
  /** Phase 3A: configure the max-jobs cap at runtime. */
  setMaxJobs(n: number): void { this.maxJobs = n; }
  /** Phase 3B: wire a prompt validator (validateCronPrompt). register/updateJob
   * reject prompts it flags. */
  setValidator(v: (prompt: string | undefined | null) => string | null): void { this.validator = v; }
  /** Gateway calls this after a successful atomic write to clear the dirty flag. */
  markPersisted(): void { this.dirty = false; }
  private markDirty(): void {
    this.dirty = true;
    if (this.onDirty) this.onDirty(this.listJobs());
  }

  register(job: Omit<CronJob, "id"> & { id?: string }): CronJob {
    // Phase 3A: cap the job count (DoS / cost bound).
    const id = job.id ?? randomUUID();
    if (this.jobs.size >= this.maxJobs && !this.jobs.has(id)) {
      throw new Error(`cron job cap reached (${this.maxJobs})`);
    }
    // C10/3A min-interval floor: refuse every-minute cron (cost amplification).
    // Operators needing high frequency set MYA_CRON_ALLOW_HIGH_FREQUENCY=1 or use
    // an on-interval trigger with an explicit ms cadence.
    if (job.trigger === "cron" && job.schedule === "* * * * *" && !process.env["MYA_CRON_ALLOW_HIGH_FREQUENCY"]) {
      throw new Error("refusing '* * * * *' (every-minute cron) — set MYA_CRON_ALLOW_HIGH_FREQUENCY=1 or use a less frequent schedule / on-interval");
    }
    // Phase 3B: validate the prompt.
    if (this.validator) {
      const err = this.validator(job.prompt);
      if (err) throw new Error(`cron prompt rejected: ${err}`);
    }
    const full: CronJob = { ...job, id };
    this.jobs.set(id, full);
    this.markDirty();
    return full;
  }

  /** Remove a job (write-through via onDirty). Replaces the old private-Map cast
   * hack in main.ts (D10). Run records are retained for history. */
  removeJob(id: string): boolean {
    const existed = this.jobs.delete(id);
    if (existed) this.markDirty();
    return existed;
  }

  /** Patch a job's config (write-through). Phase 3B: validates a changed prompt. */
  updateJob(id: string, patch: Partial<Omit<CronJob, "id">>): CronJob | undefined {
    const cur = this.jobs.get(id);
    if (!cur) return undefined;
    if (this.validator && patch.prompt != null) {
      const err = this.validator(patch.prompt);
      if (err) throw new Error(`cron prompt rejected: ${err}`);
    }
    const updated: CronJob = { ...cur, ...patch, id: cur.id };
    this.jobs.set(id, updated);
    this.markDirty();
    return updated;
  }

  /** Reconcile the in-memory `jobs` Map with a file-loaded set. The file is
   * authoritative for job *config*; in-memory run records (`runs`/`jobRuns`) are
   * preserved across reconcile for history. Does NOT trigger onDirty (the file is
   * the source — no write-back loop). `validate`, when provided, rejects a job
   * (quarantine) instead of loading it (Phase 3B wires validateCronPrompt). */
  reconcile(loaded: ReadonlyArray<Partial<CronJob> & { id: string }>, opts?: { validate?: (job: Partial<CronJob>) => string | null }): {
    added: number; updated: number; removed: number; quarantined: number;
  } {
    const validate = opts?.validate;
    const stats = { added: 0, updated: 0, removed: 0, quarantined: 0 };
    // canonical form for change-detection: defaults applied identically to both
    // sides so a job that round-trips through the file (gaining leaseMs/enabled
    // defaults) isn't flagged `updated` every sweep.
    const canon = (j: CronJob): string =>
      JSON.stringify({ ...j, leaseMs: j.leaseMs ?? 5 * 60_000, enabled: j.enabled ?? true });
    const loadedIds = new Set<string>();
    for (const raw of loaded) {
      if (!raw?.id) continue;
      if (validate) {
        const err = validate(raw);
        if (err) { stats.quarantined++; continue; }
      }
      // Phase 3A: cap the loaded job count too (a planted/huge cron.json can't
      // bypass the register cap). Excess jobs are quarantined.
      if (!this.jobs.has(raw.id) && loadedIds.size >= this.maxJobs) {
        stats.quarantined++;
        continue;
      }
      // ensure required fields have safe defaults (old/minimal cron.json rows);
      // explicit `raw.x ?? default` so TS doesn't flag a duplicated key.
      const job: CronJob = {
        ...raw,
        id: raw.id,
        leaseMs: raw.leaseMs ?? 5 * 60_000,
        enabled: raw.enabled ?? true,
      } as CronJob;
      loadedIds.add(job.id);
      const cur = this.jobs.get(job.id);
      if (!cur) { this.jobs.set(job.id, job); stats.added++; }
      else if (canon(cur) !== canon(job)) {
        this.jobs.set(job.id, job); // replace config; runs/jobRuns keyed by id survive
        stats.updated++;
      }
    }
    // drop jobs no longer in the file (external edit / CLI remove); keep run history
    for (const id of [...this.jobs.keys()]) {
      if (!loadedIds.has(id)) { this.jobs.delete(id); stats.removed++; }
    }
    return stats;
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
  /** Complete a run (succeeded/failed). Releases the claim. Phase 2C: re-anchors
   * the cron job's nextRunAt off the COMPLETION time (the dueAndAdvance advance
   * was provisional; this corrects it so slow execution doesn't drift the
   * schedule). now is injectable for tests. */
  complete(runId: string, status: "succeeded" | "failed", error?: string, now = nowWallclock()): void {
    const rec = this.runs.get(runId);
    if (rec) {
      rec.status = status;
      rec.endedAt = now;
      if (error) rec.error = error;
      const job = this.jobs.get(rec.jobId);
      if (job && job.trigger === "cron" && typeof job.schedule === "string") {
        const next = computeNextFire(job.schedule, new Date(now), job.timezone)?.getTime();
        if (next != null) { job.nextRunAt = next; this.dirty = true; }
        else { job.enabled = false; this.dirty = true; } // impossible expr post-fire — disable
      }
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
        // D8 (Phase 2B): no nextRunAt advance yet — a `* * * * *` job can fire
        // twice in one minute under a 30s sweep (the per-sweep cap + lease limit
        // the blast radius; nextRunAt tracking in 2B closes it).
        if (matchesCronExpr(job.schedule, new Date(now), job.timezone)) out.push(job);
      }
    }
    return out;
  }

  /** Phase 2 (D3): the production due path. Returns due jobs AND advances each
   * due cron job's nextRunAt to the next future fire (at-most-once: the advance
   * is persisted by the gateway BEFORE firing, so a crash during fire doesn't
   * re-fire). `due()` stays read-only for display callers (mya-bridge).
   *
   * Catch-up model (hermes fire-once + fast-forward): a job whose nextRunAt is
   * in the past fires EXACTLY ONCE this sweep, then nextRunAt advances to the
   * next future occurrence — downtime collapses the backlog instead of
   * burst-firing. complete() re-anchors nextRunAt off completion time. */
  dueAndAdvance(now = nowWallclock()): CronJob[] {
    const out: CronJob[] = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (this.activeRun(job.id, now)) continue;
      if (job.trigger === "on-interval" && typeof job.schedule === "number") {
        const last = this.lastRunAt(job.id);
        if (last == null || now - last >= job.schedule) out.push(job);
      } else if (job.trigger === "once" && typeof job.schedule === "number") {
        const succeeded = this.runsOf(job.id).some((r) => r.status === "succeeded");
        if (now >= job.schedule && !succeeded) out.push(job);
      } else if (job.trigger === "cron" && typeof job.schedule === "string") {
        // recovery: a legacy/loaded row without nextRunAt.
        if (job.nextRunAt == null) {
          if (matchesCronExpr(job.schedule, new Date(now), job.timezone)) {
            job.nextRunAt = now; // C13: matches now → fire this minute
          } else {
            const seed = computeNextFire(job.schedule, new Date(now), job.timezone)?.getTime();
            if (seed == null) { job.enabled = false; this.dirty = true; continue; } // impossible/rare expr
            job.nextRunAt = seed;
          }
        }
        if (job.nextRunAt <= now) {
          // DUE — fire once + advance to the next future fire (collapses backlog;
          // closes D8 same-minute double-fire + D3 silent-skip). An expr with no
          // future match is DISABLED (hermes state="error") so it doesn't re-fire
          // every sweep (computeNextFire-null hazard).
          const next = computeNextFire(job.schedule, new Date(now), job.timezone)?.getTime();
          if (next == null) { job.enabled = false; this.dirty = true; continue; }
          job.nextRunAt = next;
          this.dirty = true; // Phase 2C: the gateway persists this before firing
          out.push(job);
        }
      }
    }
    return out;
  }

  private lastRunAt(jobId: string): number | undefined {
    const runs = (this.jobRuns.get(jobId) ?? []).map((id) => this.runs.get(id)!).filter(Boolean);
    if (runs.length === 0) return undefined;
    return Math.max(...runs.map((r) => r.startedAt));
  }

  /** Whether in-memory state has unflushed mutations. */
  get isDirty(): boolean { return this.dirty; }

  /** A control-plane view of a job joined with its last run (for GET /cron/jobs
   * observability — lastRunAt/lastStatus/lastError otherwise unreachable since
   * CronJob carries no run fields). Phase 4B persists these to SQLite. */
  summary(job: CronJob): CronJob & {
    lastRunAt?: number; lastStatus?: RunRecord["status"]; lastError?: string;
  } {
    const runs = this.runsOf(job.id);
    const last = runs[runs.length - 1];
    return {
      ...job,
      lastRunAt: last?.endedAt ?? last?.startedAt,
      lastStatus: last?.status,
      lastError: last?.error,
    };
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

  // Standard Vixie-cron DOW/DOM OR semantics (C12): when BOTH day-of-month and
  // day-of-week are restricted (not `*`), the job fires if EITHER matches (not
  // both). When either is `*`, the other governs (AND with the rest).
  const domMatch = doms.includes(parts.dom);
  const dowMatch = dows.includes(parts.dow);
  const dayMatch = domF !== "*" && dowF !== "*" ? domMatch || dowMatch : domMatch && dowMatch;

  return (
    minutes.includes(parts.minute) &&
    hours.includes(parts.hour) &&
    dayMatch &&
    months.includes(parts.month)
  );
}

/** Phase 2 (D3): compute the next fire time strictly AFTER `base`. Uses bounded
 * minute-iteration reusing the tested `matchesCronExpr` (so DOW/DOM OR + tz are
 * handled identically). Cap = one year (527040 min) → returns null for an
 * expression with no future match (e.g. `0 0 31 2 *`). */
export function computeNextFire(
  expr: string,
  base: Date,
  timezone?: string,
  cap = 366 * 24 * 60,
): Date | null {
  const d = new Date(base.getTime());
  d.setSeconds(0, 0); // align to the start of the minute
  d.setMinutes(d.getMinutes() + 1); // strictly after base
  for (let i = 0; i < cap; i++) {
    if (matchesCronExpr(expr, d, timezone)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}
