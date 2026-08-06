# Hướng IQ: Time-Aware Planning — suy luận thời gian, deadline

> **Nguồn gốc:** Temporal planning (PDDL 2.1 temporal); "time-aware scheduling"; Allen's interval algebra; CRON/_calendar scheduling; deadline-aware execution (215); TDDL (temporal-deadline)
> **Coupling:** 🟡 — temporal reasoner trong agent planning, ảnh hưởng action ordering
> **Agent-agnostic:** ⚠️ (cần tích hợp time model vào reasoning loop)
> **Code sẵn:** ⚠️ (cron 148 + 215 deadline-bound + time helper sẵn — thiếu temporal planner + calendar)
> **Effort:** 3-4 tuần

## Nguồn gốc

Temporal planning gốc từ classical AI: **PDDL 2.1** (temporal) — action có **duration** + **time window** (start/end constraint), không chỉ thứ tự. **Allen's interval algebra** (1983) — 13 quan hệ giữa khoảng thời gian (before, during, overlaps, meets...). Cho agent: lập kế hoạch không chỉ "làm gì trước gì" mà **khi nào** — deadline (215), dependency time (task B phải đợi A xong + 1h), calendar constraint (chỉ chạy giờ hành chính), timezone (user ở VN, deadline UTC). mya đã có cron scheduling (148) + deadline-bound (215) + single time helper (core/time.ts — §18 hard rule) — IQ nâng lên **temporal reasoning**: agent suy luận về thời gian khi lập plan.

Khác **215 deadline-bound-execution** (deadline = timeout/urgency) — IQ **reason về thời gian** (dependency, calendar, timezone, duration estimate). Khác **148 scheduled-agents** (cron — khi nào chạy task) — IQ **plan có time constraint** (nhiều task + time dependency). Nối **249 priority-scheduling** (IO — priority từ deadline), **237 conformant-planning** (IC — uncertainty trong duration), **core/time.ts** (single time source).

## Mô tả

mya time-aware planning: (1) **time model** — agent suy luận: task A mất ~30min, task B phụ thuộc A, deadline 17:00 → plan: A 16:00, B 16:30, deadline buffer; (2) **calendar constraint** — chỉ chạy giờ hành chính / business hours; (3) **timezone** — user UTC+7, deadline UTC → convert; (4) **dependency timing** — task B after A + delay. Dùng **single time helper** (core/time.ts — §18 hard rule, không nhiều time source). Nối cron (148) cho execute, deadline-bound (215) cho urgency.

## Kiến trúc

```
  GOAL: "deploy v2 before 17:00 UTC (user deadline)"
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  TEMPORAL PLANNER (time-aware)                 │
  │                                               │
  │  TASKS + TIME CONSTRAINTS:                    │
  │   · run tests      [duration ~15min]           │
  │   · build          [duration ~10min, after tests] │
  │   · deploy         [duration ~5min, after build]  │
  │   · smoke test     [duration ~5min, after deploy] │
  │   · DEADLINE: 17:00 UTC (now: 16:20 UTC+7)    │
  │                                               │
  │  ALLEN'S INTERVAL REASONING:                  │
  │   tests BEFORE build BEFORE deploy BEFORE smoke│
  │   total: 35min, deadline in 40min → FIT ✓      │
  │                                               │
  │  PLAN (time-ordered):                         │
  │   16:20 tests → 16:35 build → 16:45 deploy    │
  │   → 16:50 smoke → 16:55 DONE (5min buffer)    │
  │                                               │
  │  CONSTRAINTS:                                 │
  │   · business hours ✓ (not 3am deploy)         │
  │   · timezone: deadline UTC, exec local        │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  EXECUTE (cron 148 / deadline-bound 215) → verify each on time
```

```
mya: cron 148 + 215 deadline + core/time.ts sẵn — thiếu temporal planner + calendar + duration estimate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/time.ts — single time helper (§18 hard rule — THE time source)
// ✅ packages/cron — scheduled execution (when to run — 148)
// ✅ 215 deadline-bound-execution — deadline/timeout (urgency)
// ✅ 148 scheduled-agents — cron scheduling
// ✅ 249 priority-scheduling (IO) — priority from deadline
// ✅ packages/core/src/laneboard.ts — task board (ordering)

// ❌ THIẾU: temporal planner (duration estimate + time-ordered plan)
// ❌ THIẾU: Allen's interval reasoning (before/during/overlaps constraints)
// ❌ THIẾU: calendar constraint (business hours, blackout windows)
// ❌ THIẾU: timezone-aware deadline (user TZ vs UTC vs exec TZ)
```

## Implementation

```typescript
// packages/agent/src/temporal-planner.ts (NEW)
interface TimedTask {
  id: string;
  durationEstimateMs: number;   // how long it takes
  after?: string[];             // dependency task IDs (Allen: BEFORE)
  deadline?: number;            // must finish by (215)
  calendarConstraint?: { hours: [number, number]; tz: string }; // business hours
}

interface TemporalPlan {
  schedule: { taskId: string; startMs: number; endMs: number }[];
  feasible: boolean;            // fits within deadline?
  slackMs: number;              // buffer before deadline
}

class TemporalPlanner {
  constructor(private time: TimeHelper) {}  // single time source (core/time.ts §18)

  plan(tasks: TimedTask[], deadline: number): TemporalPlan {
    const ordered = this.topologicalSort(tasks);  // respect "after" deps (Allen: BEFORE)
    const schedule = [];
    let cursor = this.time.nowWallclock();

    for (const t of ordered) {
      const start = this.respectCalendar(cursor, t);  // skip to business hours if needed
      const end = start + t.durationEstimateMs;
      schedule.push({ taskId: t.id, startMs: start, endMs: end });
      cursor = end;
    }
    const feasible = cursor <= deadline;
    return { schedule, feasible, slackMs: deadline - cursor };
  }

  // Respect calendar constraint (only run during business hours in TZ)
  private respectCalendar(startMs: number, t: TimedTask): number {
    if (!t.calendarConstraint) return startMs;
    // advance to next valid business-hour window in target TZ
    return this.nextBusinessHour(startMs, t.calendarConstraint);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan tôn trọng deadline + dependency (PDDL temporal) | ❌ Duration estimate sai (LLM khó ước chính xác) |
| ✅ Calendar-aware (không deploy 3am) | ❌ Temporal reasoning phức tạp (Allen algebra) |
| ✅ Timezone-safe (user deadline UTC vs exec local) | ❌ Replanning khi estimate sai (dynamic) |
| ✅ Nối cron 148 + 215 + core/time.ts (sẵn) | ❌ Single time source constraint (§18 — phải dùng core/time.ts) |

## Khác các hướng gần

| | 215 Deadline-Bound | 148 Scheduled (cron) | IQ: Time-Aware Planning |
|---|---|---|---|
| Mục | Timeout/urgency | When to run | **Reason về time (plan)** |
| Scope | Single task | Fixed schedule | **Multi-task + dependency** |
| Duration | ❌ | ❌ | **✅ estimate + order** |

## Khi nào chọn

- Task có deadline + dependency thời gian (deploy trước 17:00, sau khi test xong)
- Calendar constraint (business hours, blackout, maintenance window)
- Multi-timezone (user deadline khác exec timezone)
- Cần agent suy luận "có kịp không?" trước khi cam kết (nối 237 IC uncertainty)
