# Hướng HY: Work Stealing — scheduler cướp việc từ queue bận, cân bằng tải

> **Nguồn gốc:** Blumofe & Leiserson "Scheduling Multithreaded Computations by Work Stealing" (1999); Wikipedia "Work stealing"; Rust work-stealing scheduler; Convex "Work Stealing: Load-balancing for compute-heavy tasks"
> **Coupling:** 🟢 — scheduler tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (task queue sẵn — thiếu work-stealing)
> **Effort:** 1-2 tuần

## Nguồn gốc

Work stealing (Blumofe & Leiserson, 1999): decentralized scheduling — mỗi worker có **deque** (double-ended queue). Worker push/pop từ đầu queue (LIFO, cache-friendly). Khi queue rỗng → **steal** task từ đuôi queue worker khác. Rust users: "WSS pays synchronization cost only when needed, while central-queue needs to pay it for every task." Wikipedia: "solves the problem of executing a dynamically multithreaded computation on a parallel computer efficiently." Convex: "dynamically redistributes tasks among workers to avoid any one worker becoming a bottleneck." arXiv 2401.04494: adaptive async work-stealing for distributed load balancing.

## Mô tả

mya work stealing: mỗi agent worker có local deque. Khi nhận task → push vào deque riêng. Khi agent rảnh → check deque; rỗng → steal từ agent khác. Ưu điểm: **lock contention thấp** (chỉ steal khi cần, không central queue bottleneck), **cache locality** (LIFO processed trước), **tự cân bằng** (rảnh worker steal from bận worker). mya hiện dùng central task queue (kanban) — work stealing thêm per-worker deque + steal protocol.

## Kiến trúc

```
  ┌──────────────────────────────────────────────────────────────┐
  │                  WORK-STEALING SCHEDULER                      │
  │                                                              │
  │  ┌────────────┐   ┌────────────┐   ┌────────────┐           │
  │  │  WORKER A  │   │  WORKER B  │   │  WORKER C  │           │
  │  │            │   │            │   │            │           │
  │  │  deque:    │   │  deque:    │   │  deque:    │           │
  │  │  [t1,t2,t3]│   │  []         │   │  [t7]      │           │
  │  │  ↑pop      │   │  IDLE!      │   │            │           │
  │  └─────┬──────┘   └──────┬─────┘   └────────────┘           │
  │        │                 │ steal                              │
  │        │                 ▼                                    │
  │        │    ┌──────────────────────────┐                      │
  │        │    │ steal from tail of A     │                      │
  │        │    │ → gets t1                │                      │
  │        │    └──────────────────────────┘                      │
  │        │                                                     │
  │        │  Worker A: processing t3 (LIFO — cache warm)        │
  │        │  Worker B: now has t1 (stolen from tail)            │
  │        │  Worker C: processing t7                            │
  │        │                                                     │
  │  Lock contention: ONLY on steal (rare), not every task       │
  └──────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ kanban-sqlite — central task queue (sẵn — nhưng central bottleneck)
// ✅ 36 mapreduce — parallel processing (central dispatch)
// ✅ cron — task scheduling (central)
// ✅ packages/agent/src/pool.ts — session pool

// ❌ THIẾU: per-worker deque (local queue)
// ❌ THIẾU: steal protocol (worker steal from another)
// ❌ THIẾU: LIFO optimization (cache locality)
// ❌ THIẾU: load balancing metric (queue depth monitoring)
```

## Implementation

```typescript
// packages/workstealing/src/index.ts (NEW)
class WorkStealingWorker {
  private deque: Task[] = []; // double-ended: push/pop at head, steal at tail

  // Owner: push/pop from HEAD (LIFO — cache friendly)
  push(task: Task): void { this.deque.unshift(task); }

  pop(): Task | null { return this.deque.shift() ?? null; }

  // Thief: steal from TAIL (FIFO — oldest task, least cache-relevant)
  steal(): Task | null { return this.deque.pop() ?? null; }

  get depth(): number { return this.deque.length; }
}

class WorkStealingScheduler {
  private workers: Map<string, WorkStealingWorker> = new Map();

  async run(workerId: string): Promise<void> {
    const myQueue = this.workers.get(workerId)!;
    while (true) {
      let task = myQueue.pop(); // try own queue first (LIFO)
      if (!task) {
        task = this.trySteal(); // queue empty → steal from busiest worker
      }
      if (!task) { await sleep(100); continue; } // nothing to do
      await this.execute(task);
    }
  }

  private trySteal(): Task | null {
    // Find busiest worker, steal from its tail
    let busiest: WorkStealingWorker | null = null;
    let maxDepth = 0;
    for (const w of this.workers.values()) {
      if (w.depth > maxDepth) { maxDepth = w.depth; busiest = w; }
    }
    return busiest?.steal() ?? null;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lock contention thấp (steal rare, not every task) | ❌ Steal overhead (scan workers) |
| ✅ Cache locality (LIFO — recent tasks cache-warm) | ❌ Load imbalance transient (steal lag) |
| ✅ Tự cân bằng (rảnh worker steals from bận) | ❌ Complexity vs central queue |
| ✅ Proven (Cilk, Rust, Go, Java ForkJoin) | ❌ Task dependencies harder (steal independent only) |
| ✅ Scale: thêm worker = thêm throughput | |

## Khác các hướng gần

| | Central Queue (kanban) | 36 MapReduce | HY: Work Stealing |
|---|---|---|---|
| Dispatch | Central (lock every task) | Central (split → map) | **Decentralized (steal when idle)** |
| Contention | High (every task) | Medium (split phase) | **Low (only on steal)** |
| Balance | Manual | Static chunks | **Dynamic (auto)** |
| Cache | Poor (random) | Per-chunk | **LIFO (warm)** |

## Khi nào chọn

- Nhiều worker agent, task không đều (some fast, some slow)
- Central queue bottleneck (lock contention)
- Cần cache locality (LIFO — recent context warm)
- Worker scale dynamically (add/remove workers)
