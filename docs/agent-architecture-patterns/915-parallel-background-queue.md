# Hướng AIE: Parallel-Background-Queue — background agents chạy song song với automatic queuing (concurrency limit mặc định 4); `get_subagent_result` với `wait: true` chờ cả agent đang ở queue (chưa có run promise) chứ không trả "No output" vội — poll tới khi queue start rồi await run

> **Nguồn gốc:** pi-subagents3 | **Coupling:** 🟡 — concurrency control | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có pool maxSessions; chưa có wait-queue + queue-aware wait) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents3** background agents chạy **song song** với **automatic queuing** (concurrency limit mặc định 4); `get_subagent_result` với **`wait: true`** chờ cả agent đang ở queue (chưa có run promise) chứ không trả "No output" vội — **poll tới khi queue start rồi await run**. Nguyên tắc: **bounded concurrency** — giới hạn agent chạy song song (mặc định 4); **automatic queue** — vượt limit → vào queue, không reject; **queue-aware wait** — `wait:true` chờ cả agent đang xếp hàng, không trả vội "No output"; **poll-then-await** — poll tới khi queue promote → await run promise.

## Mô tả

Với mya, pattern = **parallel background queue**: (1) mya đã có **AgentPool.maxSessions** (packages/agent) — concurrency limit (default 16); (2) mya có spawnSubagent; (3) AIE thêm **queue** khi active >= limit → request vào queue; (4) **promotion** — khi slot free, queue head promote → start run; (5) **`get_subagent_result(wait:true)`** — nếu agent chưa có run promise (đang queue) → poll tới khi promote → await run; không trả "No output" vội.

## Kiến trúc (ASCII)

```
  POOL (maxConcurrent = 4)
    ├─ ACTIVE: [A, B, C, D]   (4 đang chạy — full)
    └─ QUEUE:  [E, F]          (vượt limit → xếp hàng, KHÔNG reject)
         │
         ├─ A completes ──► slot free ──► E PROMOTE (start run)
         │
         ▼ get_subagent_result(E, wait:true):
            E chưa có run promise (đang queue)?
              └─ YES → POLL tới khi promote ──► await run(E) ──► return result
              └─ NO  (đã chạy) → await run(E) trực tiếp
            (KHÔNG trả "No output" vội khi E đang queue)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — AgentPool { maxSessions } (concurrency limit — default 16)
// ✅ packages/agent pool.ts — AgentSessionEntry (active tracking)
// ✅ packages/agent — spawnSubagent + sub.wait() (run await)
// ✅ packages/core time.ts — nowWallclock (poll timing)

// ❌ THIẾU: queue khi active >= limit (hiện có thể reject hoặc unbounded)
// ❌ THIẾU: queue promotion (slot free → promote head)
// ❌ THIẾU: queue-aware wait (wait:true poll tới promote)
```

## Implementation

```typescript
// packages/agent/src/background-queue.ts (NEW)
import { nowWallclock } from "@my-agent/core";

interface QueuedAgent { id: string; start: () => Promise<string> }

export class BackgroundQueue {
  private active = 0;
  private readonly queue: QueuedAgent[] = [];
  private readonly runPromises = new Map<string, Promise<string>>();
  constructor(private readonly maxConcurrent = 4) {}

  /** Enqueue — vượt limit thì xếp hàng, không reject. */
  enqueue(a: QueuedAgent): void {
    if (this.active < this.maxConcurrent) this.start(a);
    else this.queue.push(a);
  }
  private start(a: QueuedAgent): void {
    this.active++;
    this.runPromises.set(a.id, a.start().finally(() => {
      this.active--;
      this.runPromises.delete(a.id);
      if (this.queue.length > 0) this.start(this.queue.shift()!); // promote head
    }));
  }
  /** wait:true — chờ cả agent đang queue (poll tới promote), không trả vội. */
  async getResult(id: string, wait: boolean, now: () => number): Promise<string | null> {
    if (!wait) return this.runPromises.has(id) ? await this.runPromises.get(id)! : null;
    // wait — poll tới khi có run promise (queue promote)
    while (!this.runPromises.has(id)) await new Promise((r) => setTimeout(r, 100));
    return this.runPromises.get(id)!; // đã promote → await run
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bounded concurrency — không overwhelm | ❌ Queue chờ — latency tăng khi full |
| ✅ Automatic queue — không reject | ❌ Poll loop overhead (100ms interval) |
| ✅ Queue-aware wait — không "No output" vội | ❌ maxConcurrent phải calibrate |
| ✅ Nối AgentPool.maxSessions sẵn | ❌ Queue unbounded nếu steady-state overload |

## Khác các hướng gần

| | AIE Parallel-Background-Queue | AHV Session-Scoped-Schedule | AIA Group-Join-Consolidated |
|---|---|---|---|
| Trọng tâm | Queue concurrency limit | Lưu schedule per-session | Gộp notify |
| Cơ chế | Semaphore + wait-queue + poll | <sessionId>.json + PID lock | Join 30s + straggler 15s |
| Quan hệ | Chạy agent (limit) | Persist lịch | Notify kết quả |

## Khi nào chọn

- Nhiều background agent → cần bounded concurrency
- Muốn queue thay vì reject khi full
- get_subagent_result(wait:true) phải chờ cả agent đang xếp hàng
- Guard: maxConcurrent calibrate, queue promotion FIFO, poll interval reasonable, queue bound (anti-unbounded)
