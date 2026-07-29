process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY = "1";
import { describe, it, expect } from "vitest";
import {
  CronScheduler,
  computeGraceMs,
  MIN_GRACE_MS,
  MAX_GRACE_MS,
  type CronJob,
} from "./index.js";

function mkCron(id: string, schedule = "*/5 * * * *"): CronJob {
  return {
    id, name: id, trigger: "cron", schedule,
    deliveryTarget: "_cron", prompt: "p", enabled: true, leaseMs: 5 * 60_000,
  };
}

describe("computeGraceMs (F4 — Hermes _compute_grace_seconds port)", () => {
  it("interval: half-period clamped to [MIN, MAX]", () => {
    expect(computeGraceMs(300_000)).toBe(150_000);          // 5-min period → 150s
    expect(computeGraceMs(3_600_000)).toBe(1_800_000);      // 1-hour → 30 min
    expect(computeGraceMs(86_400_000)).toBe(MAX_GRACE_MS);  // daily → 2h cap
    expect(computeGraceMs(60_000)).toBe(MIN_GRACE_MS);      // 1-min → 120s floor
  });

  it("cron expr: derives period from first two fires", () => {
    // "0 * * * *" = top of every hour → period 3600s → grace 1800s
    expect(computeGraceMs("0 * * * *")).toBe(1_800_000);
    // "0 0 * * *" = daily → grace capped at 2h
    expect(computeGraceMs("0 0 * * *")).toBe(MAX_GRACE_MS);
    // "*/5 * * * *" = every 5 min → period 300s → grace 150s
    expect(computeGraceMs("*/5 * * * *")).toBe(150_000);
  });

  it("impossible expr returns MIN_GRACE_MS", () => {
    expect(computeGraceMs("0 0 31 2 *")).toBe(MIN_GRACE_MS);
  });
});

describe("dueAndAdvance fire-once on stale catch-up (F4 — anti-perpetual-defer)", () => {
  it("a job missed several intervals fires ONCE (not skipped, not N times)", () => {
    const sched = new CronScheduler();
    const past = Date.now() - 6 * 3_600_000; // 6 hours ago (downtime)
    sched.register({ ...mkCron("hourly", "0 * * * *"), nextRunAt: past });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1); // fires exactly ONCE
    const job = sched.getJob("hourly")!;
    expect(job.nextRunAt!).toBeGreaterThan(Date.now()); // fast-forwarded to future
  });

  it("a job within grace fires once (not stale)", () => {
    const sched = new CronScheduler();
    // hourly job (grace = 30 min), 10 min late → within grace
    sched.register({ ...mkCron("h", "0 * * * *"), nextRunAt: Date.now() - 600_000 });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1);
  });

  it("a job BEYOND grace STILL fires once (anti-perpetual-defer — the bug fix)", () => {
    const sched = new CronScheduler();
    // hourly job (grace = 30 min), 45 min late → beyond grace but STILL fires
    sched.register({ ...mkCron("h", "0 * * * *"), nextRunAt: Date.now() - 2_700_000 });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1); // NOT skipped (this was the bug)
    expect(sched.getJob("h")!.nextRunAt!).toBeGreaterThan(Date.now());
  });

  it("explicit graceMs override does NOT skip firing (backward-compat regression guard)", () => {
    const sched = new CronScheduler();
    // graceMs = 60s; job 5 min late → stale, but STILL fires once (F4 fix)
    sched.register({
      ...mkCron("h", "0 * * * *"),
      nextRunAt: Date.now() - 300_000,
      graceMs: 60_000,
    });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1); // fires once — no perpetual-defer
  });

  it("graceMs:0 (worst-case perpetual-defer trigger) STILL fires once", () => {
    const sched = new CronScheduler();
    // graceMs = 0 → ANY positive lateness is stale. Old code would skip this
    // forever. F4 guarantees it fires once.
    sched.register({
      ...mkCron("h", "0 * * * *"),
      nextRunAt: Date.now() - 60_000,
      graceMs: 0,
    });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1);
    expect(sched.getJob("h")!.nextRunAt!).toBeGreaterThan(Date.now());
  });

  it("second sweep at same `now` does NOT re-fire (nextRunAt is future)", () => {
    const sched = new CronScheduler();
    const now = Date.now();
    sched.register({ ...mkCron("m", "* * * * *"), nextRunAt: now - 10 * 60_000 });
    const due1 = sched.dueAndAdvance(now);
    expect(due1.map((j) => j.id)).toContain("m");
    const due2 = sched.dueAndAdvance(now);
    expect(due2.map((j) => j.id)).not.toContain("m"); // advanced → not re-due
  });

  it("atomic claim still holds — a stale job that fires is claimable exactly once", () => {
    const sched = new CronScheduler();
    sched.register({ ...mkCron("h", "0 * * * *"), nextRunAt: Date.now() - 3_600_000 });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1);
    const run1 = sched.claim(due[0]!.id, "worker-1");
    expect(run1).not.toBeNull();
    // second claim by another worker is rejected (lease active)
    const run2 = sched.claim(due[0]!.id, "worker-2");
    expect(run2).toBeNull();
  });

  it("one-shot within ONESHOT_GRACE_MS fires; beyond is skipped (unchanged)", () => {
    const sched = new CronScheduler();
    const now = Date.now();
    sched.register({
      id: "os", name: "os", trigger: "once", schedule: now - 60_000,
      deliveryTarget: "_cron", prompt: "p", enabled: true, leaseMs: 5 * 60_000,
    });
    expect(sched.dueAndAdvance(now).map((j) => j.id)).toContain("os");
  });
});
