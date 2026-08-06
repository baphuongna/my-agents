# Hướng IO: Priority Scheduling — queue ưu tiên, preemption

> **Nguồn gốc:** OS priority scheduling (Tanenbaum); Kubernetes priority class + preemption; "deadline-bound execution" (215); SLA-driven queue; priority queue data structure
> **Coupling:** 🟡 — scheduler nằm giữa task enqueue và worker dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (kanban queue + 215 deadline-bound sẵn — thiếu priority class + preemption)
> **Effort:** 2 tuần

## Nguồn gốc

Priority scheduling — cổ điển trong OS (Tanenbaum "Modern Operating Systems"): mỗi process có **priority**, scheduler chọn priority cao nhất trước. **Preemption** — process ưu tiên cao đến → giành CPU từ process thấp đang chạy (preempt). Kubernetes priority class: pod ưu tiên cao → schedule trước; cluster đầy → **preempt** pod thấp để nhường chỗ. SLA-driven queue: task có deadline (215) → priority theo urgency. Cho agent: task agent có **priority** (urgent vs background), **deadline** (215), **SLA tier** (243) → scheduler sắp xếp theo priority + deadline, preempt task thấp khi resource (GPU/session) đầy.

Khác **215 deadline-bound-execution** (deadline = urgency) — IO thêm **explicit priority class** (business priority, không chỉ time). Khác **233 work-stealing** (HY — cân bằng load) — IO sắp xếp **thứ tự ưu tiên**. Nối **243 SLO** (II — SLA tier → priority), **245 capacity-planning** (IK — capacity đầy → preempt low-priority), **196 rate-limiting** (quota per priority).

## Mô tả

mya priority scheduling: (1) **priority class** — task gắn priority (P0 critical / P1 high / P2 normal / P3 background); (2) **queue** — thay FIFO (kanban hiện tại) → priority queue (heap theo priority × deadline); (3) **preemption** — task P0 đến khi worker đầy → preempt task P3 (pause + requeue); (4) **SLA integration** — priority từ SLA tier (243 II). mya đã có kanban task queue (FIFO) + deadline-bound (215) — IO thêm priority class + preemption.

## Kiến trúc

```
  INCOMING TASKS (mixed priority)
   · T1: deploy fix (P0 critical, deadline 5min)
   · T2: refactor module (P2 normal)
   · T3: generate report (P3 background)
   · T4: urgent bug (P0, deadline 2min)
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  PRIORITY QUEUE (heap: priority × urgency)     │
  │                                               │
  │  order: T4(P0,2m) > T1(P0,5m) > T2(P2) > T3  │
  │  (higher priority + tighter deadline first)   │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼  worker pool (2 workers, both busy with T5/T6 P3)
  ┌──────────────────────────────────────────────┐
  │  PREEMPTION CHECK                              │
  │                                               │
  │  T4 P0 arrives, no free worker                 │
  │  → find lowest-priority running task: T6 (P3)  │
  │  → PREEMPT T6 (pause + checkpoint + requeue)   │
  │  → dispatch T4 to freed worker                 │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌────────────┐  ┌────────────┐
  │ WORKER 1   │  │ WORKER 2   │
  │ T4 (P0) ✓  │  │ T5 (P2)    │  ← T6 preempted, requeued
  └────────────┘  └────────────┘
```

```
mya: kanban queue (FIFO) + 215 deadline sẵn — thiếu priority class + preemption + checkpoint
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ kanban-sqlite — task queue (FIFO — cần nâng lên priority queue)
// ✅ 215 deadline-bound-execution — deadline/urgency (priority factor)
// ✅ packages/agent/src/pool.ts — session pool (worker pool — preemption target)
// ✅ 233 work-stealing (HY) — load balancing (complementary)
// ✅ 243 agent-slo-sli (II) — SLA tier (priority source)
// ✅ 196 rate-limiting-quotas — quota (per-priority budget)

// ❌ THIẾU: priority class (P0-P3 assignment per task)
// ❌ THIẾU: priority queue (heap — replace FIFO)
// ❌ THIẾU: preemption (pause low-priority + checkpoint + requeue)
// ❌ THIẾU: checkpoint for preempted task (save state to resume — 73 durable)
```

## Implementation

```typescript
// packages/agent/src/priority-scheduler.ts (NEW)
type Priority = "P0" | "P1" | "P2" | "P3";

interface PrioritizedTask {
  id: string;
  priority: Priority;
  deadline?: number;     // nối 215
  enqueuedAt: number;
  checkpoint?: unknown;  // state for resume after preemption
}

const PRIORITY_RANK: Record<Priority, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };

class PriorityScheduler {
  private queue = new PriorityQueue<PrioritizedTask>((a, b) => this.score(b) - this.score(a));

  private score(t: PrioritizedTask): number {
    const urgency = t.deadline ? 1 / Math.max(1, t.deadline - nowWallclock()) : 0;
    return PRIORITY_RANK[t.priority] * 100 + urgency * 10;
  }

  enqueue(task: PrioritizedTask): void { this.queue.push(task); }

  // Dispatch highest-priority; preempt low-priority if pool full
  async dispatch(pool: SessionPool): Promise<void> {
    if (pool.hasFree()) { return pool.assign(this.queue.pop()!); }
    // no free worker → try preempt lowest-priority running task
    const victim = pool.lowestPriorityRunning();
    if (victim && PRIORITY_RANK[victim.priority] < PRIORITY_RANK[this.queue.peek()!.priority]) {
      victim.checkpoint = await pool.checkpoint(victim.id);  // save state (73 durable)
      await pool.preempt(victim.id);                         // pause + free worker
      this.queue.push(victim);                               // requeue victim
      pool.assign(this.queue.pop()!);                        // dispatch urgent task
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task quan trọng làm trước (Tanenbaum/K8s) | ❌ Preemption overhead (checkpoint + requeue) |
| ✅ SLA-driven (deadline 215 + SLO 243) | ❌ Starvation (P3 never runs if always P0) |
| ✅ Resource-efficient (preempt instead of wait) | ❌ Checkpoint complexity (state save/resume — 73) |
| ✅ Nối kanban + deadline (sẵn) | ❌ Priority tuning (wrong priority → wrong order) |

## Khác các hướng gần

| | 215 Deadline-Bound | 233 Work-Stealing (HY) | IO: Priority Scheduling |
|---|---|---|---|
| Trục | Deadline/urgency | Load balance | **Business priority** |
| Order | By deadline | Steal when idle | **Priority heap** |
| Preempt | ❌ | ❌ | **✅ pause low for high** |

## Khi nào chọn

- Task có priority khác nhau (urgent vs background)
- Worker pool đầy → cần preempt (không đợi) thay vì queue dài
- SLA tier (243) → priority (P0 critical vs P3 batch)
- Cần fairness guard (anti-starvation — P3 vẫn chạy đôi khi)
