# Hướng PT: Openclaw Commitments — pass nền trích lời hứa/việc dở từ hội thoại, gửi todo khi xong

> **Nguồn gốc:** openclaw (commitments/ — types.ts, extraction.ts, runtime.ts, store.ts, store-writer.ts); "commitment extraction"; "background follow-up"; "inferred user context"; "agent promise tracking"; "due window scheduling"
> **Coupling:** 🟡 — thêm commitment extraction + scheduling runtime vào agent background layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (openclaw commitments module sẵn — chưa port vào mya agent)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**openclaw** (`src/commitments/`) có hệ thống **commitment tracking** — pass nền trích lời hứa/việc dở từ hội thoại, gửi follow-up khi đến hạn. `types.ts` định nghĩa `CommitmentKind` (event_check_in, deadline_check, care_check_in, open_loop), `CommitmentSource` (inferred_user_context — agent suy luận từ hội thoại; agent_promise — agent tự hứa), `CommitmentStatus` (pending → sent/dismissed/snoozed/expired). `extraction.ts` dùng **LLM prompt** để trích commitments từ conversation text (userText + assistantText) → `CommitmentCandidate` (kind, reason, suggestedText, dueWindow, confidence, dedupeKey). `runtime.ts` chạy **background** — batch extraction requests, queue, drain timer, persist results. `store.ts` quản lý commitment lifecycle: pending → due → sent (hoặc dismissed/snoozed/expired). `dueWindow` (earliestMs, latestMs, timezone) — khi đến due window → send follow-up (todo/notification). `dedupeKey` — tránh trùng commitment. Nguyên tắc: **không quên lời hứa** — agent trích lời hứa/việc dở, gửi khi đến hạn. Khác **10 kanban** (task board) — PT là **commitment extraction + scheduling**.

## Mô tả

mya openclaw commitments: agent chạy hội thoại → **background commitment extraction** — (1) **Extract**: sau mỗi turn, background runtime trích commitments từ conversation (LLM prompt → candidates: kind, reason, dueWindow, confidence). (2) **Dedupe**: `dedupeKey` tránh trùng (cùng lời hứa không extract 2 lần). (3) **Store**: commitments persisted (status: pending). (4) **Schedule**: `dueWindow` (earliest/latest + timezone) — khi đến due → trigger follow-up. (5) **Deliver**: send todo/notification khi đến hạn (status: pending → sent). (6) **Lifecycle**: pending → sent (delivered) / dismissed (user ignore) / snoozed (đẩy sau) / expired (quá late). Commitments từ 2 nguồn: **inferred** (agent suy luận từ user context — "tôi sẽ gửi email mai") và **promise** (agent tự hứa — "tôi sẽ check lại sau"). mya có cron/scheduling — PT thêm **commitment extraction + due-window scheduling + lifecycle**.

## Kiến trúc

```
  CONVERSATION (agent + user):
  User: "I'll send you the report by Friday"
  Agent: "Great, I'll remind you"
        │
        ▼ (after turn completes)
  ┌─── BACKGROUND EXTRACTION (runtime.ts) ───────────────┐
  │                                                       │
  │  enqueue: { userText, assistantText, scope, nowMs }   │
  │  ↓ batch drain (timer)                                │
  │  LLM prompt → extract commitments:                    │
  │    candidate: {                                        │
  │      kind: "deadline_check",                           │
  │      reason: "user promised report by Friday",         │
  │      suggestedText: "Did you send the report?",        │
  │      source: "inferred_user_context",                  │
  │      dueWindow: { earliest: Friday 9am,                │
  │                    latest: Friday 5pm,                 │
  │                    timezone: "America/New_York" },     │
  │      confidence: 0.85,                                 │
  │      dedupeKey: "report-friday"                        │
  │    }                                                   │
  │                                                       │
  │  dedupe: dedupeKey "report-friday" not in pending?     │
  │    → YES → persist (status: pending)                   │
  │    → NO → skip (already tracked)                       │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼ (when dueWindow arrives)
  ┌─── SCHEDULE + DELIVER ───────────────────────────────┐
  │                                                       │
  │  dueWindow check (cron/timer):                        │
  │    now >= earliestMs && now <= latestMs?               │
  │    → YES → trigger follow-up                          │
  │                                                       │
  │  DELIVER: send todo/notification:                     │
  │    "📨 Did you send the report? (you promised Friday)" │
  │    status: pending → sent                             │
  │                                                       │
  │  LIFECYCLE:                                            │
  │    pending → sent (delivered ✅)                       │
  │    pending → dismissed (user: "already done")          │
  │    pending → snoozed (user: "remind tomorrow")         │
  │    pending → expired (now > latestMs, too late)        │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ cron / scheduling (packages/cron) — timer/scheduler (nền — PT = commitment scheduling)
// ✅ 10 kanban-board — task board (nền — PT = commitment tracking)
// ✅ openclaw commitments module (source/ — reference impl: types, extraction, runtime, store)

// ❌ THIẾU: commitment extraction (LLM prompt → candidates from conversation)
// ❌ THIẾU: background runtime (batch queue + drain timer)
// ❌ THIẾU: due-window scheduling (earliest/latest + timezone → trigger)
// ❌ THIẾU: commitment lifecycle (pending → sent/dismissed/snoozed/expired)
// ❌ THIẾU: dedupe (dedupeKey — avoid duplicate commitments)
```

## Implementation

```typescript
// packages/agent/src/commitments.ts (MỚI — port từ openclaw commitments/)

type CommitmentKind = 'event_check_in' | 'deadline_check' | 'care_check_in' | 'open_loop';
type CommitmentStatus = 'pending' | 'sent' | 'dismissed' | 'snoozed' | 'expired';
type CommitmentSource = 'inferred_user_context' | 'agent_promise';

interface CommitmentRecord {
  id: string;
  kind: CommitmentKind;
  source: CommitmentSource;
  status: CommitmentStatus;
  reason: string;
  suggestedText: string;
  dedupeKey: string;
  confidence: number;
  dueWindow: { earliestMs: number; latestMs: number; timezone: string };
  createdAtMs: number;
  sentAtMs?: number;
  attempts: number;
}

// Background extraction runtime
class CommitmentRuntime {
  private queue: Array<{ userText: string; assistantText?: string; scope: Scope; nowMs: number }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private store: CommitmentStore;

  // Enqueue extraction after each turn (non-blocking)
  enqueue(input: { userText: string; assistantText?: string; scope: Scope; nowMs: number }): void {
    this.queue.push(input);
    this.scheduleDrain();
  }

  // Batch drain — extract commitments from queued turns
  private async drain(): Promise<void> {
    const batch = this.queue.splice(0);
    for (const item of batch) {
      const candidates = await this.extractCommitments(item);
      for (const candidate of candidates) {
        // Dedupe: skip if dedupeKey already pending
        if (this.store.hasPending(candidate.dedupeKey, item.scope)) continue;
        this.store.upsert({ ...candidate, ...item.scope, status: 'pending', attempts: 0 });
      }
    }
  }

  // LLM extraction (prompt → candidates)
  private async extractCommitments(item: {
    userText: string; assistantText?: string; nowMs: number; timezone: string;
  }): Promise<CommitmentCandidate[]> {
    const prompt = buildExtractionPrompt(item);
    const result = await llmExtract(prompt); // structured output
    return result.candidates.filter((c) => c.confidence >= 0.5);
  }

  // Check due commitments (called by cron/timer)
  async checkDue(nowMs: number): Promise<CommitmentRecord[]> {
    const due = this.store.queryPending()
      .filter((c) => nowMs >= c.dueWindow.earliestMs && nowMs <= c.dueWindow.latestMs);
    for (const commitment of due) {
      await this.deliver(commitment);
    }
    // Expire: past latestMs
    this.store.queryPending()
      .filter((c) => nowMs > c.dueWindow.latestMs)
      .forEach((c) => this.store.update(c.id, { status: 'expired' }));
    return due;
  }

  // Deliver: send todo/notification
  private async deliver(commitment: CommitmentRecord): Promise<void> {
    await sendNotification(commitment.scope, commitment.suggestedText);
    this.store.update(commitment.id, { status: 'sent', sentAtMs: Date.now() });
  }
}

// Usage:
// runtime.enqueue({ userText: "I'll send report Friday", scope, nowMs });
// → background extracts commitment → stores → schedules dueWindow
// cron: runtime.checkDue(Date.now()) → sends follow-up when due
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No forgotten promises (agent tracks lời hứa/việc dở) | ❌ LLM extraction cost (mỗi turn → background LLM call) |
| ✅ Background (non-blocking — không interrupt conversation) | ❌ False positive (extract commitment không tồn tại — noise) |
| ✅ Due-window scheduling (timezone-aware — đúng giờ) | ❌ Dedupe complexity (dedupeKey design — phải unique enough) |
| ✅ Lifecycle (sent/dismissed/snoozed/expired — clear states) | ❌ Privacy (trích lời hứa từ hội thoại — cần consent) |

## Khác các hướng gần

| | 10 Kanban-Board | PT: Openclaw-Commitments |
|---|---|---|
| Cái gì | Task board | **Commitment extraction + scheduling** |
| Source | Manual | **Auto-extract from conversation** |
| Due window | ❌ | ✅ earliest/latest + timezone |
| Background | ❌ | ✅ batch extraction runtime |

## Khi nào chọn

- Agent cần track lời hứa/việc dở (không quên follow-up)
- Muốn auto-extract (background — không cần user manual entry)
- Muốn due-window scheduling (timezone-aware — đúng giờ gửi)
- Nối 10 kanban-board (PT = auto-extraction layer on task tracking) + cron (PT = scheduling runtime) + openclaw (reference impl); guard false positive (extraction confidence threshold — skip low confidence)
