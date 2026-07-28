// P4-P6 (Hermes distillation 2026-07-24): future-dated claim guard.
// Replicates the hermes `claim_job_for_fire` pattern (`0 <= age < TTL`) so a
// clock/TZ skew that stamps `startedAt` in the future doesn't make a run
// permanently unclaimable.

import { describe, it, expect, beforeEach } from "vitest";
import { CronScheduler, type CronJob } from "./index.js";

function makeJob(): CronJob {
  return {
    id: "test-1",
    name: "test",
    schedule: "*/5 * * * *",
    trigger: "cron",
    deliveryTarget: "lane:test",
    enabled: true,
    prompt: "test",
    leaseMs: 60_000,
    graceMs: 0,
  };
}

describe("P4-P6 future-dated claim guard", () => {
  let sched: CronScheduler;
  beforeEach(() => {
    sched = new CronScheduler();
  });

  it("activeRun rejects future-dated claims (lower-bound guard)", () => {
    const job = makeJob();
    sched.register(job);
    // Future-dated startedAt (clock skew simulation)
    const future = Date.now() + 600_000;
    const rec = sched.claim(job.id, "worker-1", future);
    // Without the lower-bound guard, activeRun() would return this rec
    // (now - future < 0 < leaseMs). With the guard, activeRun() returns undefined.
    const now = Date.now();
    const active = (sched as unknown as { activeRun(j: string, n: number): unknown }).activeRun(job.id, now);
    expect(active).toBeUndefined();
    // sweepExpired at "now" should also mark it lease-expired
    const expired = sched.sweepExpired(now);
    expect(expired.length).toBe(1);
    expect(expired[0]).toBe(rec?.runId);
  });

  it("sweepExpired treats future-dated runs as expired", () => {
    const job = makeJob();
    sched.register(job);
    const future = Date.now() + 10_000_000;
    sched.claim(job.id, "w1", future);
    // Without the guard, the run would be "fresh forever" (now - future < 0 < leaseMs).
    // With the guard, it's swept on the very next sweepExpired() call.
    const expired = sched.sweepExpired();
    expect(expired.length).toBeGreaterThan(0);
  });

  it("normal-dated claim still works (regression check)", () => {
    const job = makeJob();
    sched.register(job);
    const now = Date.now();
    sched.claim(job.id, "w1", now);
    // Within lease window — not expired
    const expired = sched.sweepExpired(now + 1000);
    expect(expired).toEqual([]);
  });

  it("expired-dated claim is swept (regression check)", () => {
    const job = makeJob();
    sched.register(job);
    const past = Date.now() - 600_000; // way past leaseMs
    sched.claim(job.id, "w1", past);
    const expired = sched.sweepExpired(Date.now());
    expect(expired.length).toBeGreaterThan(0);
  });
});
