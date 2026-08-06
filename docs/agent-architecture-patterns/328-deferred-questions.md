# Hướng LP: Deferred Questions — hàng đợi câu hỏi, agent hỏi sau không block

> **Nguồn gốc:** "Non-blocking I/O"; message queue / mailbox; "ask-for-clarification" patterns; "lazy evaluation"; async/await event loop; "deferred decisions" in planning; human-in-the-loop checkpoints
> **Coupling:** 🟢 — queue layer, không đổi core logic
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + mailbox/channel sẵn — thiếu question queue + batch-ask + non-blocking resume)
> **Effort:** 2-3 tuần

## Nguồn gốc

Non-blocking I/O: không đợi (block) — xếp hàng, xử lý sau. Message queue (mailbox): producer gửi → queue → consumer lấy async. Ask-for-clarification: agent thiếu info → hỏi user — nhưng **block chờ** làm đình trệ. Deferred decisions (planning): quyết định chưa rõ → hoãn, làm phần khác trước → quay lại khi có info. Human-in-the-loop checkpoint: agent pause tại điểm cần human → tiếp tục khi human trả lời. Cốt lõi: **đừng block chờ 1 câu hỏi** — xếp vào queue, làm task khác, batch hỏi user sau → non-blocking, hiệu quả.

## Mô tả

mya deferred questions: agent đang làm task gặp info thiếu → thay vì block chờ user → (1) **enqueue** câu hỏi + đánh dấu "blocked-on-this"; (2) **continue** làm phần khác không phụ thuộc câu trả lời; (3) **batch** — gom nhiều câu hỏi → hỏi user 1 lần (giảm interrupt); (4) **resume** — khi user trả lời → unblock, tiếp tục. Nối 327 interruptible (pause/resume), mailbox (crew coordination), 314 conflict-merge (flag = deferred question).

## Kiến trúc

```
  AGENT TASK FLOW:
     │
     ├── Step A (independent) → ✓ done
     ├── Step B → needs "which API version?" → ENQUEUE question, mark blocked
     │     │  ❌ DON'T block-wait (đình trệ)
     │     ▼
     ├── Step C (independent) → ✓ done (kept working!)
     ├── Step D → needs "confirm delete?" → ENQUEUE question
     │
     ▼
  ┌──────────────────────────────────────────────────────┐
  │  QUESTION QUEUE (mailbox)                            │
  │  Q1: "which API version?" (blocks Step B)            │
  │  Q2: "confirm delete?"     (blocks Step D)           │
  └──────────────────┬───────────────────────────────────┘
                     │ batch → ask user once (less interrupt)
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  USER ANSWERS (async — whenever ready)               │
  │  Q1 → "v2"   → unblock Step B → resume              │
  │  Q2 → "yes"  → unblock Step D → resume              │
  └──────────────────────────────────────────────────────┘
```

```
mya: agent-loop + mailbox/channel sẵn — thiếu question queue + batch-ask + blocked-resume
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — agent-loop (sẵn)
// ✅ mailbox/channel (crew coordination) — queue concept (sẵn)
// ✅ 327 interruptible-agents — pause/resume (documented)
// ✅ 314 conflict-merge — "flag" = deferred question (documented)

// ❌ THIẾU: question queue (enqueue + track blocked-step)
// ❌ THIẾU: batch-ask (collect questions → ask once)
// ❌ THIẾU: non-blocking continue (do other steps while waiting)
// ❌ THIẾU: resume-on-answer (unblock when user replies)
```

## Implementation

```typescript
// packages/agent/src/deferred-questions.ts (NEW)
interface DeferredQuestion {
  id: string;
  question: string;
  blockedStepId: string;
  answered: boolean;
  answer?: string;
}

export class DeferredQuestionQueue {
  private queue: DeferredQuestion[] = [];

  enqueue(question: string, blockedStepId: string): string {
    const id = cryptoId();
    this.queue.push({ id, question, blockedStepId, answered: false });
    return id;
  }

  // Batch-ask: collect all unanswered → ask user once
  pendingBatch(): { id: string; question: string }[] {
    return this.queue.filter((q) => !q.answered).map((q) => ({ id: q.id, question: q.question }));
  }

  // User answers → mark + (caller resumes blocked step)
  answer(id: string, answer: string): string | null {
    const q = this.queue.find((x) => x.id === id);
    if (!q) return null;
    q.answered = true;
    q.answer = answer;
    return q.blockedStepId; // caller: resume this step
  }

  hasUnanswered(): boolean {
    return this.queue.some((q) => !q.answered);
  }
}

// Agent loop: continue independent steps while questions pending
class NonBlockingAgent {
  constructor(private queue: DeferredQuestionQueue) {}

  async runStep(stepId: string, needsInfo: string | null): Promise<void> {
    if (needsInfo) {
      // Don't block — enqueue, continue other steps
      this.queue.enqueue(needsInfo, stepId);
      return; // skip this step (will resume on answer)
    }
    // do the step...
  }

  // After all independent steps done → batch-ask pending questions
  async askPending(): Promise<void> {
    const batch = this.queue.pendingBatch();
    if (batch.length > 0) {
      await this.presentToUser(batch); // one interrupt, not N
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Non-blocking — agent không đình trệ chờ user | ❌ Out-of-order (steps resume in any order) |
| ✅ Batch-ask — 1 interrupt thay N (giảm phiền user) | ❌ User delay still blocks dependent steps |
| ✅ Hiệu quả — làm việc khác trong lúc chờ | ❌ Queue state complexity (track blocked) |
| ✅ Human-in-loop checkpoint (pause/resume) | ❌ Stale context when user answers late |

## Khác các hướng gần

| | 327 Interruptible | 314 Conflict-Merge (flag) | LP: Deferred Questions |
|---|---|---|---|
| Khi | User cancel | Conflicting fact | **Info thiếu → hỏi sau** |
| Block | ❌ (cancel) | Flag | **Enqueue + continue (non-block)** |
| Resume | Checkpoint | Manual | **On user answer** |

## Khi nào chọn

- Agent hay cần hỏi user — nhưng không muốn block chờ
- User bận — collect câu hỏi → hỏi batch 1 lần
- Task có nhiều phần độc lập (làm phần khác trong lúc chờ)
- Nối 327 interruptible + 314 conflict-merge + mailbox (crew coordination)
