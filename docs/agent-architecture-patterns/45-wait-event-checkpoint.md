# Hướng AS: Durable Wait-for-Event — checkpoint, pause, resume

> **Nguồn gốc:** LangGraph checkpointing; Temporal durable execution; AWS Step Functions wait-for-callback
> **Coupling:** 🟢 — agents không biết mình bị pause
> **Agent-agnostic:** ✅ — bất kỳ agent có session state
> **Code sẵn:** ⚠️ (1 phần — AuditLog + session JSONL làm checkpoint substrate)
> **Effort:** 1-2 tuần

## Nguồn gốc

Task dài ngày thường phải **chờ event ngoài**: CI chạy xong (webhook), file xuất hiện (file-watcher), con người duyệt (approval). LangGraph/Temporal giải quyết bằng **durable execution**: toàn bộ state workflow được checkpoint xuống disk sau mỗi bước; khi chờ event → workflow "ngủ" (không tốn chi phí, không chiếm session); event đến → rehydrate state → tiếp tục từ đúng chỗ. Sống sót qua restart của orchestrator.

## Mô tả

Khi agent chạm "điểm chờ" (CI pending, approval cần, API bên ngoài chưa sẵn sàng) → mya **checkpoint** context của agent (session JSONL + task state + audit chain) → **release session** (về pool) → đăng ký trigger (webhook/fs.watch/timer). Event đến → **rehydrate** session mới từ checkpoint → agent tiếp tục, không cần nhớ lại. Khác Saga (FF — xử lý failure transaction): đây là *trạng thái chờ bình thường*, không phải rollback.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│            DURABLE TASK LIFECYCLE (mya)                     │
│                                                            │
│  ┌─────────┐   ┌────────────┐   ┌──────────────┐           │
│  │ RUNNING │──►│ CHECKPOINT │──►│ WAITING      │           │
│  │ agent   │   │ JSONL+audit│   │ (0 cost)     │           │
│  └─────────┘   └────────────┘   │ webhook/     │           │
│       ▲                         │ file/ timer  │           │
│       │ event đến               └──────┬───────┘           │
│       │ rehydrate session + context    │                   │
│       └────────────────────────────────┘                   │
│                                                            │
│  checkpoint = session JSONL + task state + audit chain     │
│  event = CI webhook | file-watcher | human approve | timer │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent/src/pool.ts — pi session management (JSONL, compaction)
//    Session JSONL = checkpoint tự nhiên (full transcript)
// ✅ packages/audit — Merkle chain: state đã biến đổi theo thứ tự
// ✅ packages/tools/src/kanban-sqlite.ts — task state (stage, owner) persist
// ✅ packages/gateway — fs.watch + cron (trigger sẵn)

// ❌ THIẾU: registry "WAITING task → trigger" + rehydrate flow.
//    Cần map event → task id → session id, rồi replay JSONL.
```

## Implementation

```typescript
// packages/gateway/src/durable.ts (NEW)
type WaitTrigger =
  | { kind: "webhook"; url: string }
  | { kind: "file"; path: string }
  | { kind: "timer"; atMs: number }
  | { kind: "approval"; userId: string };

interface DurableTask {
  taskId: string;
  sessionPath: string;      // checkpoint: session JSONL
  context: Record<string, unknown>;  // task state (kanban row)
  waiting: WaitTrigger;
  resumedAt?: number;
}

class DurableCoordinator {
  private waiting = new Map<string, DurableTask>();

  async pause(task: DurableTask): Promise<void> {
    await this.pool.release(task.sessionPath);       // giải phóng session
    this.waiting.set(task.taskId, task);
    this.armTrigger(task.waiting);                   // webhook/file/timer
    log(`[durable] ${task.taskId} WAITING`);
  }

  async resume(taskId: string, event: unknown): Promise<void> {
    const task = this.waiting.get(taskId);
    if (!task) return;
    const session = await this.pool.acquire();       // session mới từ pool
    await replayContext(session, task.sessionPath, task.context);
    await session.run(`Tiếp tục task (event: ${JSON.stringify(event)}): ${task.context.step}`);
    this.waiting.delete(taskId);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không tốn chi phí khi chờ (release session) | ❌ Rehydrate mất thời gian (replay JSONL) |
| ✅ Sống sót restart orchestrator | ❌ Context không replay hoàn hảo (tool state ngoài) |
| ✅ Agent không cần nhớ "mình đang làm gì" | ❌ Trigger registry phải đủ các loại event |
| ✅ Session JSONL sẵn làm checkpoint | |
| ✅ Kết hợp UU (escalation) + SS (budget) | |

## Khi nào chọn

- Task dài có chờ CI / approval / event ngoài
- Muốn tiết kiệm session khi idle chờ
- Muốn crash-safe (restart không mất task)
- Đã có session JSONL + audit + kanban
