# Hướng HW: Dead-Letter Queue — tác vụ hỏng vào DLQ/quarantine thay vì retry đè

> **Nguồn gốc:** AWS SQS DLQ; Azure Service Bus DLQ; "Dead Letter Queues Are Not Where Messages Go to Die" (Semeraro); Glukhov "DLQ: Handling Poison Messages"
> **Coupling:** 🟢 — DLQ tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retry/backoff sẵn — thiếu DLQ + quarantine)
> **Effort:** 1 tuần

## Nguồn gốc

Dead-letter queue (AWS SQS/Azure Service Bus): message fail xử lý sau N retry → vào **DLQ** (quarantine) thay vì retry vô hạn. AWS: "targets for messages that fail processing, aiding in application debugging by isolating unconsumed messages." Glukhov: "A DLQ turns an invisible failure into a visible, inspectable one. It gives you a place to quarantine the message, alert on it, and decide — deliberately." Poison message: message luôn fail (malformed, incompatible API) → block queue → DLQ cô lập. Semeraro: "The oldest message in the DLQ tells you how long failures have been accumulating without attention."

## Mô tả

mya DLQ: task agent fail sau N retry → vào DLQ (SQLite table). DLQ message có: task gốc, lỗi, retry count, timestamp. Operator inspect DLQ → fix root cause → requeue hoặc discard. Alert khi DLQ có message mới. Khác retry loop (203 — retry vô hạn): DLQ dừng retry, cô lập, đợi can thiệp. Cron job fail → DLQ (không retry đè).

## Kiến trúc

```
  TASK (tool_call, cron_job, agent_step)
        │
        ▼
  ┌──────────────┐     fail      ┌──────────────┐
  │  PROCESS     │──────────────►│  RETRY       │
  │  (execute)   │               │  backoff x3  │
  └──────┬───────┘               └──────┬───────┘
         │ ok                            │ still fail
         ▼                               ▼
  ┌──────────────┐               ┌──────────────┐
  │  SUCCESS     │               │  DEAD LETTER │
  │  (result)    │               │  QUEUE       │
  └──────────────┘               │              │
                                 │  task        │
                                 │  error       │
                                 │  retryCount  │
                                 │  timestamp   │
                                 └──────┬───────┘
                                        │
                                 ┌──────▼───────┐
                                 │  ALERT       │
                                 │  (operator)  │
                                 └──────┬───────┘
                                        │
                              inspect → fix → requeue / discard
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 203 failure-detection-retry-loops — retry + backoff (sẵn)
// ✅ 42 circuit-breaker — stop retry khi quá nhiều fail (sẵn)
// ✅ 46 escalation-tree — escalate khi fail (sẵn)
// ✅ kanban — task state (có thể thêm "dead" state)

// ❌ THIẾU: DLQ table (quarantine failed tasks)
// ❌ THIẾU: DLQ alert (notify operator khi task vào DLQ)
// ❌ THIẾU: requeue mechanism (fix → retry từ DLQ)
// ❌ THIẾU: poison message detection (same error N times)
```

## Implementation

```typescript
// packages/dlq/src/index.ts (NEW)
interface DeadLetter {
  id: string;
  taskType: string;
  payload: unknown;
  error: string;
  retryCount: number;
  failedAt: number;
}

class DeadLetterQueue {
  constructor(private db: Database, private maxRetries = 3) {}

  async handleFailure(task: Task, error: Error, retries: number): Promise<"retry" | "dead"> {
    if (retries < this.maxRetries) return "retry"; // still retrying

    // Max retries exceeded → quarantine
    this.db.prepare(
      "INSERT INTO dlq (id, taskType, payload, error, retryCount, failedAt) VALUES (?,?,?,?,?,?)"
    ).run(crypto.randomUUID(), task.type, JSON.stringify(task.payload), error.message, retries, Date.now());

    await this.alert(task, error); // notify operator
    return "dead";
  }

  async requeue(dlqId: string): Promise<void> {
    const dlq = this.db.prepare("SELECT * FROM dlq WHERE id = ?").get(dlqId);
    // Fix applied → requeue task with fresh retry budget
    await this.taskQueue.enqueue({ type: dlq.taskType, payload: JSON.parse(dlq.payload) });
    this.db.prepare("DELETE FROM dlq WHERE id = ?").run(dlqId);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Poison message không block queue (AWS/Azure) | ❌ Task "lost" trong DLQ nếu operator quên inspect |
| ✅ Visible failure (Glukhov — inspectable, alertable) | ❌ Manual intervention needed (requeue/discard) |
| ✅ Retry budget finite (không retry vô hạn đốt token) | ❌ Extra table/infrastructure |
| ✅ Audit (DLQ = failure history) | |
| ✅ Nối 203 retry + 42 circuit-breaker | |

## Khác các hướng gần

| | 203 Retry Loops | 42 Circuit Breaker | HW: DLQ |
|---|---|---|---|
| Khi fail | Retry backoff | Stop tất cả | **Quarantine 1 task** |
| Scope | Per-task | System-wide | Per-task |
| Recovery | Auto retry | Auto reset | **Manual requeue** |
| Poison msg | ❌ (retry forever) | ❌ (global stop) | ✅ isolate |

## Khi nào chọn

- Task hay fail (API rate limit, malformed input, timeout)
- Không muốn retry vô hạn đốt token/cost
- Cần inspect failure (debug root cause)
- Operator có thể fix → requeue (or discard poison)
