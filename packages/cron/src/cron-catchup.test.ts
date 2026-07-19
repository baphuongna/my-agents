import { describe, it, expect } from "vitest";
import { CronScheduler, matchesCronExpr, computeNextFire } from "./index.js";
import type { CronJob } from "./index.js";

function mkCron(id: string, schedule = "*/5 * * * *"): CronJob {
  return {
    id, name: id, trigger: "cron", schedule,
    deliveryTarget: "_cron", prompt: "p", enabled: true, leaseMs: 5 * 60_000,
  };
}

describe("computeNextFire (Phase 2A)", () => {
  it("*/5 → the next 5-minute boundary after base", () => {
    // 09:03 → next is 09:05
    const base = new Date(2026, 0, 1, 9, 3, 17);
    const next = computeNextFire("*/5 * * * *", base)!;
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(5);
  });

  it("0 9 * * 1 → next Monday 09:00", () => {
    // 2026-01-02 is a Friday; next Monday is 2026-01-05
    const base = new Date(2026, 0, 2, 10, 0, 0);
    const next = computeNextFire("0 9 * * 1", base)!;
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("0 0 1 1 * → next Jan 1 00:00", () => {
    const base = new Date(2026, 5, 15, 12, 0, 0);
    const next = computeNextFire("0 0 1 1 *", base)!;
    expect(next.getMonth()).toBe(0); // January
    expect(next.getDate()).toBe(1);
    expect(next.getFullYear()).toBe(2027);
  });

  it("returns null for an impossible expression within the cap", () => {
    // month 13 never matches → no future fire within 1 year
    const base = new Date(2026, 0, 1, 0, 0, 0);
    // inject an invalid month via a valid-shape but impossible expr: 0 0 1 13 *
    // (parseField accepts 13 since max is 12 → range(1,12) excludes 13 → empty)
    const next = computeNextFire("0 0 1 13 *", base, undefined, 100);
    expect(next).toBeNull();
  });
});

describe("DOW/DOM OR semantics (C12)", () => {
  it("fires when EITHER dom or dow matches (both restricted)", () => {
    // 0 0 13 * 1 = 1st OR Monday. 2026-01-13 is a Tuesday → matches via dom (13).
    const tue = new Date(2026, 0, 13, 0, 0, 0);
    expect(tue.getDay()).toBe(2); // Tuesday
    expect(matchesCronExpr("0 0 13 * 1", tue)).toBe(true); // dom matches (13)
    // 2026-01-12 is a Monday but not the 13th → matches via dow (Monday)
    const mon = new Date(2026, 0, 12, 0, 0, 0);
    expect(mon.getDay()).toBe(1);
    expect(matchesCronExpr("0 0 13 * 1", mon)).toBe(true); // dow matches (Monday)
    // 2026-01-14 is Wednesday, not 13th, not Monday → no match
    const wed = new Date(2026, 0, 14, 0, 0, 0);
    expect(matchesCronExpr("0 0 13 * 1", wed)).toBe(false);
  });

  it("AND when only one of dom/dow is restricted", () => {
    // 0 0 13 * * = the 13th only. Monday the 12th does NOT match.
    const mon = new Date(2026, 0, 12, 0, 0, 0);
    expect(matchesCronExpr("0 0 13 * *", mon)).toBe(false);
    expect(matchesCronExpr("0 0 * * 1", mon)).toBe(true); // every Monday
  });
});

describe("dueAndAdvance catch-up (Phase 2B/2C — D3 + D8)", () => {
  it("a * * * * * job fires ONCE per sweep, then nextRunAt advances (no same-minute double-fire — D8)", () => {
    const sched = new CronScheduler();
    sched.register(mkCron("every-minute", "* * * * *"));
    const now = Date.now();
    const due1 = sched.dueAndAdvance(now);
    expect(due1.map((j) => j.id)).toContain("every-minute");
    // nextRunAt advanced to a FUTURE minute (> now)
    const job = sched.getJob("every-minute")!;
    expect(job.nextRunAt!).toBeGreaterThan(now);
    // second sweep at the same `now` → NOT due again (nextRunAt is future)
    const due2 = sched.dueAndAdvance(now);
    expect(due2.map((j) => j.id)).not.toContain("every-minute");
  });

  it("an overdue job fires ONCE then advances (no backlog burst-fire — D3)", () => {
    const sched = new CronScheduler();
    // seed a job whose nextRunAt is 6 hours in the past (downtime)
    const past = Date.now() - 6 * 3600_000;
    sched.register({ ...mkCron("daily", "0 9 * * *"), nextRunAt: past });
    const due = sched.dueAndAdvance();
    expect(due).toHaveLength(1); // fires exactly ONCE, not N times
    const job = sched.getJob("daily")!;
    expect(job.nextRunAt!).toBeGreaterThan(Date.now()); // advanced to a future 09:00
  });

  it("recovery: a legacy row without nextRunAt that matches NOW fires this minute (C13)", () => {
    const sched = new CronScheduler();
    sched.register(mkCron("now", "* * * * *")); // no nextRunAt
    const now = Date.now();
    const due = sched.dueAndAdvance(now);
    expect(due.map((j) => j.id)).toContain("now");
  });

  it("a not-yet-due cron job (future nextRunAt) does not fire", () => {
    const sched = new CronScheduler();
    sched.register({ ...mkCron("later", "* * * * *"), nextRunAt: Date.now() + 3600_000 });
    expect(sched.dueAndAdvance().map((j) => j.id)).not.toContain("later");
  });

  it("complete() re-anchors nextRunAt off completion time (drift prevention)", () => {
    const sched = new CronScheduler();
    sched.register({ ...mkCron("c", "0 9 * * *"), nextRunAt: Date.now() - 1000 });
    const due = sched.dueAndAdvance();
    const job = sched.getJob("c")!;
    const advancedAt = job.nextRunAt!;
    // simulate completion 90s later
    const run = sched.claim("c", "w")!;
    sched.complete(run.runId, "succeeded", undefined, Date.now() + 90_000);
    // re-anchored off completion → nextRunAt is the 09:00 strictly after completion
    expect(job.nextRunAt!).toBeGreaterThanOrEqual(advancedAt);
  });

  it("an impossible expression (no future match) is DISABLED, not perpetual-re-fired (P1 fix)", () => {
    const sched = new CronScheduler();
    // Feb 31 never exists → computeNextFire returns null within the cap.
    sched.register(mkCron("impossible", "0 0 31 2 *"));
    const due1 = sched.dueAndAdvance();
    expect(due1.map((j) => j.id)).not.toContain("impossible"); // never fires
    expect(sched.getJob("impossible")!.enabled).toBe(false);    // disabled
    // subsequent sweeps: still disabled, never fires
    const due2 = sched.dueAndAdvance(Date.now() + 120_000);
    const due3 = sched.dueAndAdvance(Date.now() + 240_000);
    expect([...due2, ...due3].map((j) => j.id)).not.toContain("impossible");
  });

  it("an out-of-range expression (month 13) is DISABLED, not perpetual-re-fired", () => {
    const sched = new CronScheduler();
    sched.register(mkCron("bad", "0 0 1 13 *"));
    sched.dueAndAdvance();
    expect(sched.getJob("bad")!.enabled).toBe(false);
  });

  it("dueAndAdvance sets the dirty flag so reconcile won't clobber an unflushed advance (P1 fix)", () => {
    // If the gateway's pre-fire persist fails, the advanced nextRunAt must
    // survive in memory (dirty=true → cronReload skips reconcile). This test
    // pins the precondition: advancing sets dirty (independent of register's dirty).
    const sched = new CronScheduler();
    sched.register(mkCron("d", "* * * * *"));
    sched.markPersisted(); // clear the register-induced dirty
    expect(sched.isDirty).toBe(false);
    sched.dueAndAdvance();
    expect(sched.isDirty).toBe(true); // advance mutated nextRunAt
    sched.markPersisted();
    expect(sched.isDirty).toBe(false);
  });
});
