# Hướng AHM: Parallel Fanout Semaphore — nhiều tool call `subagent` trong cùng turn chạy song song nhưng bị giới hạn bởi per-process semaphore `maxConcurrency` (default 4); call vượt cap chờ trong hàng đợi

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟡 — bind vào subagent spawn + turn loop | **Agent-agnostic:** ❌ (cốt lõi agent fanout) | **Code sẵn:** ✅ (mya có AgentPool maxSessions semaphore + workflows parallel, pattern đã có) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-subagents**: nhiều tool call `subagent` trong **cùng một turn** được chạy **song song** (LLM fan-out nhiều subagent cùng lúc). Nhưng bị giới hạn bởi **per-process semaphore** `maxConcurrency` (**mặc định 4**) — call vượt cap **chờ trong hàng đợi** thay vì spawn thêm (tránh overwhelm provider/resource). Semaphore: acquire (lấy slot) trước spawn, release (trả slot) khi xong. Pattern này cho **parallel có giới hạn**: tận dụng concurrency nhưng có backpressure (không mở N subagent cùng lúc giết resource).

Nguyên tắc: **fan-out parallel** (nhiều subagent 1 turn); **per-process semaphore** (cap maxConcurrency); **queue thay vì reject** (call thừa chờ, không fail); **backpressure** (không overwhelm provider/disk).

## Mô tả

Với mya, packages/agent `pool.ts` **đã có** `AgentPool` với **`maxSessions`** (semaphore-bounded parallel sessions, "Per-agent concurrency" line 12) + `acquire`/`release` (line 125/184). packages/workflows `runner.ts` có `parallel(tasks)` (`Promise.all`). Pattern semaphore **đã có nền vững**. Cần áp dụng cụ thể cho **per-turn subagent fanout**: nhiều tool call `subagent` trong 1 turn chạy song song nhưng bounded bởi semaphore (mặc định 4), call thừa queue.

## Kiến trúc (ASCII)

```
  1 TURN: LLM gọi subagent×8 (fan-out)
        │
        ▼
  Semaphore (maxConcurrency=4)
   ┌─────────────────────────────┐
   │ slot 1: subagent A (running)│
   │ slot 2: subagent B (running)│   ← 4 chạy song song
   │ slot 3: subagent C (running)│
   │ slot 4: subagent D (running)│
   └─────────────────────────────┘
        │
        ▼
   hàng đợi: [E, F, G, H]   ← chờ slot free (không spawn thêm, không reject)
        │  A xong → release slot 1 → E acquire
        ▼
   backpressure: không overwhelm provider/resource
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent/src/pool.ts — AgentPool maxSessions (semaphore-bounded, "Per-agent concurrency", line 12)
// ✅ packages/agent/src/pool.ts — acquire(sessionId)/release(sessionId) (line 125/184)
// ✅ packages/workflows/src/runner.ts — parallel(tasks) = Promise.all (line 119)
// ⚠️ CHƯA rõ per-turn subagent fanout semaphore (maxConcurrency=4 cho tool call subagent trong 1 turn)
// ⚠️ AgentPool bound theo session, cần áp dụng cho tool-call fanout cụ thể
```

## Implementation

```typescript
// packages/agent/src/fanout-semaphore.ts (NEW)
/** Per-process semaphore — bound parallel fanout, queue thay vì reject. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrency = 4) {}

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) { this.active++; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));   // queue chờ
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();                     // đánh thức 1 waiter
  }

  get pending(): number { return this.waiters.length; }
  get running(): number { return this.active; }
}

/** Fan-out: chạy nhiều subagent song song, bounded bởi semaphore. */
export async function fanoutSubagents<T>(
  sem: Semaphore,
  tasks: Array<() => Promise<T>>,
): Promise<T[]> {
  return Promise.all(tasks.map(async (run) => {
    await sem.acquire();                   // chờ slot (queue nếu vượt cap)
    try { return await run(); }            // chạy subagent
    finally { sem.release(); }             // luôn trả slot
  }));
}

// Hook turn loop: const sem = new Semaphore(4);
//   fanoutSubagents(sem, turn.subagentCalls.map(c => () => spawnSubagent(c.goal)));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parallel có giới hạn (tận dụng concurrency) | ❌ Call thừa chờ (độ trễ khi queue dài) |
| ✅ Backpressure (không overwhelm provider) | ❌ Deadlock nếu task acquire không release (try/finally) |
| ✅ Queue thay vì reject (không fail) | ❌ maxConcurrency tune sai → quá chậm/quá tải |

## Khác các hướng gần

| | AHM Fanout Semaphore | AHL Spawn Allowlist | AgentPool pool.ts |
|---|---|---|---|
| Trọng tâm | Bound parallel subagent fanout | Giới hạn agent-type spawn | Bound parallel sessions |
| Cơ chế | maxConcurrency semaphore + queue | subagent_agents + env + filter | maxSessions acquire/release |
| Quan hệ | Nối parallel bound | Nối spawn permission | Nối session concurrency |

## Khi nào chọn

- LLM fan-out nhiều subagent trong 1 turn — cần bound parallel
- Tránh overwhelm provider/resource (backpressure)
- Muốn queue thay vì reject (call thừa chờ, không fail)
- Guard: semaphore acquire/release try/finally, maxConcurrency tune (default 4), queue unbounded check
