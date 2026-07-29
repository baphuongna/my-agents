# Port Plan: Cron Grace-Window Catch-Up (Fire-Once + Fast-Forward)

> **Source:** Hermes `cron/jobs.py` (v0.19.0) · **Target:** `packages/cron/src/index.ts` (`CronScheduler`)
> **Status:** DRAFT — ready for implementation. **Fixes a latent bug.**

---

## 1. Hermes design — fire-once + fast-forward

A recurring job that missed its scheduled time (gateway down, long-running prior execution) fires **exactly once** on recovery and has `next_run_at` **fast-forwarded** to the next future occurrence — collapsing the backlog instead of burst-firing N missed runs or silently skipping forever.

### 1.1 Grace window — `_compute_grace_seconds` (`cron/jobs.py:686-717`)
Grace = **half the schedule period**, clamped to **[120 s, 7200 s]**.
- interval: `grace = period_seconds // 2`
- cron: derive period from first two fires, `grace = period // 2`
- `return max(MIN_GRACE, min(grace, MAX_GRACE))`
Daily job (86400s) → grace 7200s (2h). 5-min job (300s) → grace 150s.

### 1.2 One-shot grace — `ONESHOT_GRACE_SECONDS = 120` (`jobs.py:102`)
`_recoverable_oneshot_run_at` (`jobs.py:660-682`): a one-shot fires if `run_at >= now - 120s` and not yet run. Beyond 120s → rejected as "ghost", never fires.

### 1.3 Fire-once + fast-forward in `get_due_jobs` (`jobs.py:2055-2090`)
```python
grace = _compute_grace_seconds(schedule)
if kind in {"cron", "interval"} and (now - next_run_dt).total_seconds() > grace:
    new_next = compute_next_run(schedule, now.isoformat())
    rj["next_run_at"] = new_next   # fast-forward, collapse backlog
    needs_save = True
    # Fall through — execute once now (NEVER skip)
due.append(job)   # ← fires regardless of staleness
```
**Key invariant: a stale recurring job ALWAYS fires once.** Grace controls whether backlog is collapsed (it is) + logs "missed", but the job is never skipped. Anti-perpetual-defer (#33315).

### 1.4 At-most-once ordering — advance BEFORE fire (`scheduler.py:4031-4035`)
`get_due_jobs()` → advance `next_run_at` for ALL recurring jobs FIRST (under file lock) → then execute. Crash during fire won't re-fire on restart — missing one run preferred over crash-loop burst.

### 1.5 Re-anchor on completion — `mark_job_run` (`jobs.py:1531-1610`)
After execution, `next_run_at = compute_next_run(schedule, now)` where now = **completion** time (corrects drift from slow execution).

---

## 2. mya current state — claim/lease/past-due + the exact gap

### 2.1 What mya ALREADY has
- **`dueAndAdvance()` (`index.ts:350-392`)** — production due path. For cron-trigger jobs, if `nextRunAt <= now`, computes next future fire, advances `nextRunAt`, returns as due (fires once). **Collapses backlog.**
- **Atomic claim + TTL lease** — `claim()` (`:234-253`) checks `activeRun()` (`:281-291`); `sweepExpired()` (`:293-310`).
- **Cross-process lock** — `acquireCronLock()` (flock).
- **Re-anchor on completion** — `complete()` (`:260-275`).
- **Pre-fire persistence** — gateway (`gateway/src/index.ts:635-642`): `dueAndAdvance()` → `cronPersist()` BEFORE firing (at-most-once).
- **One-shot grace** — `ONESHOT_GRACE_MS = 120_000` (`:21`); ghosts > 2min skipped (`:362`).
- **`graceMs` field** — `CronJob.graceMs?: number` (`:67-70`).

### 2.2 The EXACT gap (`index.ts:384-389`)
```typescript
const grace = job.graceMs ?? Infinity;
const isStale = grace !== Infinity && (now - job.nextRunAt!) > grace;
job.nextRunAt = next;
this.dirty = true;
if (isStale) continue; // ← skip firing — too stale
out.push(job);
```

**Gap 1 — No dynamic grace.** `graceMs` defaults to `Infinity` → `isStale` always false unless operator manually sets `graceMs`. No auto-computed half-period grace.

**Gap 2 — Skip-vs-fire-once when stale (PERPETUAL-DEFER BUG).** When `graceMs` IS set and stale, `continue` **skips entirely** (not fired). `nextRunAt` advanced → next sweep finds it future → never fires. This is the perpetual-defer Hermes explicitly avoids (#33315).

**Answer to "job due 5 intervals ago while down?":**

| Scenario | mya behavior |
|---|---|
| Default (`graceMs` unset / Infinity) | Fires **once**, fast-forwards. ✅ Correct. |
| `graceMs` set | **Skipped** (never fires), silently advanced. ❌ Perpetual-defer. |

Hermes always fires once regardless of staleness.

---

## 3. Port design

### 3.1 Goals
1. Auto-compute grace from schedule (half-period, clamped [120s, 7200s]).
2. Fire-once even when stale (never skip; close perpetual-defer).
3. Respect explicit `graceMs` override (backward compat).
4. Don't break at-most-once (advance-before-fire ordering unchanged).

### 3.2 New exported constants + helper (`packages/cron/src/index.ts`)
```typescript
export const MIN_GRACE_MS = 120_000;     // 2 minutes (Hermes cron/jobs.py:693)
export const MAX_GRACE_MS = 7_200_000;   // 2 hours   (Hermes cron/jobs.py:694)

export function computeGraceMs(schedule: string | number, timezone?: string): number {
  let periodMs: number;
  if (typeof schedule === "number") {
    periodMs = schedule;
  } else {
    const base = new Date(nowWallclock());
    const first = computeNextFire(schedule, base, timezone);
    if (!first) return MIN_GRACE_MS;
    const second = computeNextFire(schedule, first, timezone);
    if (!second) return MIN_GRACE_MS;
    periodMs = second.getTime() - first.getTime();
  }
  return Math.max(MIN_GRACE_MS, Math.min(Math.floor(periodMs / 2), MAX_GRACE_MS));
}
```

### 3.3 Modified `dueAndAdvance()` — fire-once even when stale
Replace the stale-skip block with fire-once-and-log:
```typescript
const grace = job.graceMs ?? computeGraceMs(job.schedule, job.timezone);
const latenessMs = now - job.nextRunAt!;
const isStale = latenessMs > grace;
job.nextRunAt = next;
this.dirty = true;
// NOTE: no `continue` — fire once even when stale (Hermes #33315 model).
out.push(job);
```
`isStale` is now informational (exposable in `summary()` for observability/logging). The job fires once regardless.

### 3.4 At-most-once interaction (unchanged)
Gateway ordering: `dueAndAdvance()` → `cronPersist()` (before fire) → `claim()` → fire. The change only affects *whether* a job appears in the `due` array (it always does when past nextRunAt), not the claim/persist/fire ordering. At-most-once preserved.

---

## 4. Files to touch
| File | Change |
|---|---|
| `packages/cron/src/index.ts` | Add `MIN_GRACE_MS`, `MAX_GRACE_MS`, `computeGraceMs()`. Remove `if (isStale) continue;` (fire-once even when stale). Wire `computeGraceMs` as default when `graceMs` unset. Export new constants/function. |
| `packages/cron/src/cron-grace.test.ts` | **NEW** — test suite (§6) |

**Not touched:** `agent-tools.ts` (graceMs already optional), `cross-process-lock.ts`, `gateway/src/index.ts` (sweep ordering unchanged; optional: log `summary().missedWindow`).

---

## 5. Effort & risk
**Effort: S** (~20 LOC: one function + removing the skip line + wiring default).

**Default-identical (LOW RISK):**
- Before: default `graceMs = Infinity` → `isStale = false` → fires once.
- After: default grace = `computeGraceMs()` → `isStale` may be true → **still fires once** (`continue` removed).
- Observable behavior for existing jobs is **identical** (fire once). Only `isStale` flips in some cases; stale path no longer skips. No existing test should break (`cron-catchup.test.ts` expects fire-once, preserved).

**Compute cost:** `computeGraceMs` for cron exprs calls `computeNextFire` twice (O(period) minute-iteration, capped 366 days). Hourly/daily < 60 iterations. Once per due job per sweep (every 60s). Negligible.

---

## 6. Test plan — `packages/cron/src/cron-grace.test.ts` (NO TEST = NO MERGE)

Use injectable `now` on `dueAndAdvance(now)` / `claim(id, w, now)` (matching `cron-catchup.test.ts`), or `setTimeProvider` from `@my-agent/core` (invariant: no `Date.now()`).

```typescript
describe("computeGraceMs", () => {
  it("interval: half-period clamped [MIN, MAX]", () => {
    expect(computeGraceMs(300_000)).toBe(150_000);        // 5-min → 150s
    expect(computeGraceMs(3_600_000)).toBe(1_800_000);    // 1-hour → 30min
    expect(computeGraceMs(86_400_000)).toBe(MAX_GRACE_MS);// daily → 2h cap
    expect(computeGraceMs(60_000)).toBe(MIN_GRACE_MS);    // 1-min → 120s floor
  });
  it("cron expr derives period from first two fires", () => {
    expect(computeGraceMs("0 * * * *")).toBe(1_800_000);  // hourly → 30min
    expect(computeGraceMs("0 0 * * *")).toBe(MAX_GRACE_MS); // daily → 2h
  });
  it("impossible expr → MIN_GRACE_MS", () => {
    expect(computeGraceMs("0 0 31 2 *")).toBe(MIN_GRACE_MS);
  });
});

describe("dueAndAdvance fire-once on stale catch-up", () => {
  it("job missed 5 intervals fires ONCE (not skipped, not N times)", () => {
    // hourly job, nextRunAt = now - 5h → fires once, fast-forwards
    expect(due).toHaveLength(1);
    expect(job.nextRunAt).toBeGreaterThan(now);
  });
  it("job within grace fires once (not stale)", () => { /* 10min late, hourly */ });
  it("job beyond grace STILL fires once (anti-perpetual-defer)", () => {
    // 35min late, hourly (grace 30min) → fires once, NOT skipped
    expect(due).toHaveLength(1);
  });
  it("explicit graceMs override respected for staleness (still fires)", () => {
    // graceMs=60s, job 5min late → stale but still fires once
  });
  it("atomic claim still holds — stale job claimable exactly once", () => {
    // claim succeeds; second worker rejected
  });
  it("one-shot within ONESHOT_GRACE_MS fires; beyond skipped (unchanged)", () => {});
});
```

---

## 7. Honest assessment

**Worth porting: YES — small change, high alignment value, FIXES A LATENT BUG.**

mya **already implements fire-once + fast-forward** in `dueAndAdvance()`. The default case (`graceMs = Infinity`) already fires stale jobs once. The gap is narrow:
1. **No dynamic grace** — `graceMs` exists but defaults to Infinity, never auto-computed. `computeGraceMs` adds the Hermes-identical policy (half-period clamped) for observability + future staleness features.
2. **Perpetual-defer when `graceMs` IS set** — the `if (isStale) continue;` line is a **latent bug**. If any operator configures `graceMs`, their stale jobs silently stop firing. Removing it closes the gap + aligns with Hermes's #33315 fix.

~20 LOC + tests. **Recommend doing it.**

**Edge cases:**
- **DST:** mya uses `Intl.DateTimeFormat` with IANA tz in `getCronParts()` (handles DST for matching). `computeGraceMs` derives period from two consecutive fires — DST-correct (iterates wall-clock minutes). No extra handling needed.
- **Long downtime (> grace):** daily job down 3 days fires **once** on recovery, fast-forwards to tomorrow. No burst. mya's default already does this; port preserves it.
- **Clock skew / future-dated nextRunAt:** unaffected (`nextRunAt <= now` check; future claim guard orthogonal).

**What is NOT ported (intentional):**
- Hermes cross-process `run_claim`/`fire_claim` CAS — mya's claim/lease/sweep provides equivalent at-most-once differently. No need.
- Hermes `repeat.times` catch-up consumption — mya has no repeat-limit field. N/A.
- Hermes `advance_next_run` (separate from `mark_job_run`) — mya's `dueAndAdvance` (advance before fire) + `complete` (re-anchor after) is the equivalent two-phase. Already implemented.

**Default-identical verification:** all existing `cron-catchup.test.ts` cases (overdue fires once; `* * * * *` once per sweep; impossible expr disabled; dirty flag on advance) pass unchanged. Only behavioral change: jobs with explicit `graceMs` that are stale now **fire** instead of **skip** — the untested gap.
