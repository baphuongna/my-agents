# Hướng ADE: Worker Mailbox Dispatch Log — MailboxLog lưu MailboxRecord + DispatchLog theo trạng thái pending → notified → delivered → failed, delivery idempotent qua message_id

> **Nguồn gốc:** oh-my-codex (crates/omx-runtime-core/src/mailbox.rs, dispatch.rs) | **Coupling:** 🟡 — thêm mailbox layer vào messaging | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có intercom broker + durable-ack — chưa có dispatch log audit) | **Effort:** 2 tuần

## Nguồn gốc

**oh-my-codex** có **MailboxLog** — lưu **MailboxRecord** (`from_worker`, `to_worker`, `body`, `created/notified/delivered_at`) và **DispatchLog theo trạng thái** `pending → notified → delivered → failed` — **messaging giữa workers có audit trail đầy đủ**. Delivery **idempotent qua `message_id`** — cùng message_id gửi lại không tạo bản sao (retry an toàn). Nguyên tắc: **mọi message giữa workers đều có record + log trạng thái, delivery idempotent qua message_id, fail được thấy rõ thay vì mất im lặng**.

## Mô tả

mya worker mailbox dispatch log: (1) **MailboxRecord** — mỗi message giữa workers: from/to/body + timestamps created/notified/delivered; (2) **DispatchLog state machine** — `pending → notified → delivered → failed` (thêm `expired` nếu quá hạn); (3) **idempotent delivery** — key bằng `message_id` (hash nội dung + sender) — retry cùng message_id không duplicate; (4) **audit trail** — log đầy đủ để tra cứu ai gửi gì cho ai lúc nào, fail ở đâu; (5) **nối intercom broker** — packages/intercom broker.ts đã có message receipts (queued/delivered/expired...) — ADE thêm persistence + dispatch log đầy đủ. Nối durable-ack (core) — delivery classification.

## Kiến trúc

```
  WORKER A ──message──▶ MAILBOX ──▶ WORKER B
       ▼                    ▼
  MAILBOX RECORD      DISPATCH LOG
  { from_worker        pending ──▶ notified
    to_worker            │            │
    body                 ▼            ▼
    created_at         delivered    failed
    notified_at        (expired)   (retry — idempotent
    delivered_at }                  qua message_id)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom broker.ts — MailboxMessage + receipts (queued/delivered/expired)
//   (nền — ADE thêm record + log bền)
// ✅ packages/intercom types.ts — MessageReceiptStatus (receiver_received/queued/
//   injected/acknowledged/expired/cancelled/superseded) — nền state machine
// ✅ packages/core durable-ack.ts — DurableAckTracker (nền — terminal/retry/deliver)
// ✅ packages/core canonical-json.ts — canonicalJson (nền — message_id hash ổn định)
// ✅ packages/audit index.ts — AuditLog (nền — audit trail)

// ❌ THIẾU: MailboxRecord bền (from/to/body + created/notified/delivered_at)
// ❌ THIẾU: DispatchLog pending → notified → delivered → failed
// ❌ THIẾU: delivery idempotent qua message_id
```
## Implementation
```typescript
// packages/intercom/src/mailbox-log.ts (MỚI)
import { createHash } from "node:crypto";
import { nowWallclock } from "@my-agent/core";
export type DispatchState = "pending" | "notified" | "delivered" | "failed";
export interface MailboxRecord {
  messageId: string; fromWorker: string; toWorker: string; body: string; createdAt: number;
  notifiedAt?: number; deliveredAt?: number; failedAt?: number; failureReason?: string;
}
export interface DispatchLogEntry { messageId: string; state: DispatchState; at: number; detail?: string }
/** Message id — hash sender + body → idempotent key. */
export function messageId(fromWorker: string, body: string): string {
  return createHash("sha256").update(`${fromWorker}|${body}`).digest("hex").slice(0, 16);
}
/** MailboxLog — record + dispatch log với audit trail đầy đủ. */
export class MailboxLog {
  private readonly records = new Map<string, MailboxRecord>();
  private readonly dispatch = new Map<string, DispatchLogEntry[]>();
  /** Ghi message — idempotent: cùng messageId không tạo bản sao. */
  enqueue(fromWorker: string, toWorker: string, body: string): MailboxRecord {
    const id = messageId(fromWorker, body);
    const existing = this.records.get(id);
    if (existing) return existing; // idempotent — retry an toàn
    const rec: MailboxRecord = { messageId: id, fromWorker, toWorker, body, createdAt: nowWallclock() };
    this.records.set(id, rec);
    this.track(id, "pending");
    return rec;
  }
  /** Chuyển trạng thái dispatch — log mọi chuyển đổi. */
  transition(messageId: string, state: DispatchState, detail?: string): void {
    const rec = this.records.get(messageId);
    if (!rec) throw new Error(`mailbox record không tồn tại: ${messageId}`);
    const at = nowWallclock();
    if (state === "notified") rec.notifiedAt = at;
    if (state === "delivered") rec.deliveredAt = at;
    if (state === "failed") { rec.failedAt = at; rec.failureReason = detail; }
    this.track(messageId, state, detail);
  }
  private track(messageId: string, state: DispatchState, detail?: string): void {
    const list = this.dispatch.get(messageId) ?? [];
    list.push({ messageId, state, at: nowWallclock(), detail });
    this.dispatch.set(messageId, list);
  }
  /** Audit trail đầy đủ — tra cứu message theo id. */
  history(messageId: string): DispatchLogEntry[] {
    return this.dispatch.get(messageId) ?? [];
  }
  /** Message đang pending — chưa notified/delivered/failed. */
  pending(): MailboxRecord[] {
    return [...this.records.values()].filter((r) => !r.notifiedAt && !r.deliveredAt && !r.failedAt);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Audit trail đầy đủ — ai gửi gì cho ai, fail ở đâu | ❌ Mỗi message lưu log — tốn storage theo volume |
| ✅ Idempotent qua message_id — retry không duplicate | ❌ Hash body — hai message giống hệt coi là một |
| ✅ State machine rõ — pending/notified/delivered/failed | ❌ Transition phải gọi đúng thứ tự — sai state khó phát hiện |
| ✅ Nối intercom broker — receipt có sẵn | ❌ Log trong memory — cần persist cho restart |

## Khác các hướng gần

| | Intercom broker receipts | ADE: Mailbox Dispatch Log |
|---|---|---|
| Trạng thái | receiver_received/queued/injected/… | **pending → notified → delivered → failed** |
| Persist | Trong broker process | **Record + log riêng (audit trail)** |
| Idempotent | messageId có sẵn | **Hash sender + body — retry an toàn** |
| Mục đích | Giao message | **Audit + theo dõi dispatch đầy đủ** |

## Khi nào chọn

- Messaging giữa workers cần audit trail (ai gửi gì cho ai, fail ở đâu)
- Retry delivery cần idempotent (không duplicate khi gửi lại)
- Đã có intercom broker + durable-ack — thêm log layer
- Guard: transition state machine rõ, message_id hash ổn định, log persist nếu cần tra cứu sau
