# Hướng AIG: Telegram-Queue-Control — prompt gửi từ Telegram khi Pi đang bận được xếp vào queue thành Telegram turn thay vì interrupt; operator xem hàng đợi, xóa stale work, promote prompt quan trọng, continue/abort/stop, force next item

> **Nguồn gốc:** pi-telegram | **Coupling:** 🟡 — channel queue | **Agent-agnostic:** ⚠️ (channel model) | **Code sẵn:** ⚠️ (có channel adapters + registry; chưa có turn-queue + control ops) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-telegram** prompt gửi từ Telegram khi Pi đang bận được **xếp vào queue thành Telegram turn** thay vì interrupt; operator có thể **xem hàng đợi**, **xóa stale work**, **promote prompt quan trọng**, **continue/abort/stop**, **force next item**. Nguyên tắc: **queue-when-busy** — không drop prompt, không interrupt turn đang chạy; **operator control** — xem/xóa/promote/force-next qua command; **priority promote** — prompt quan trọng đẩy lên đầu; **turn boundary** — queue item thành turn kế tiếp khi turn hiện tại xong.

## Mô tả

Với mya, pattern = **channel turn-queue**: (1) mya đã có **channels** (packages/channels) — messaging adapters + per-chat session; (2) mya có **ChannelRegistry** + gateway channel-bridge; (3) AIG thêm **turn-queue per chat**: khi agent busy → inbound prompt vào queue (không interrupt); (4) **drain on turn-boundary** — turn xong → dequeue next → thành turn mới; (5) **control commands**: `/queue` (view), `/queue delete <id>`, `/queue promote <id>`, `/queue abort`, `/queue force-next`.

## Kiến trúc (ASCII)

```
  TELEGRAM ──► inbound prompt
    │
    ▼ agent busy?
    ├─ NO  ──► thành turn ngay
    └─ YES ──► TURN-QUEUE (per chat) — KHÔNG interrupt, KHÔNG drop
                 [prompt1, prompt2(stale), prompt3(important)]
         │
         ▼ CONTROL (operator):
         /queue              ──► view (list + status)
         /queue delete p2    ──► xóa stale work
         /queue promote p3   ──► đẩy important lên đầu
         /queue abort        ──► abort turn hiện tại
         /queue force-next   ──► skip, dequeue ngay
         │
         ▼ turn boundary (turn hiện tại xong):
         dequeue head ──► thành turn kế tiếp
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/channels — ChannelAdapter + per-chat ChatSession (nền queue)
// ✅ packages/channels index.ts — ChannelRegistry (chat routing)
// ✅ packages/gateway channel-bridge.ts — adapter → Channel wiring
// ✅ packages/core loop.ts — turn boundary (dequeue hook point)
// ✅ packages/core time.ts — nowWallclock (stale detection)

// ❌ THIẾU: turn-queue per chat (queue-when-busy)
// ❌ THIẾU: control commands (view/delete/promote/abort/force-next)
// ❌ THIẾU: turn-boundary drain
```

## Implementation

```typescript
// packages/channels/src/turn-queue.ts (NEW)
import { nowWallclock } from "@my-agent/core";

export interface QueuedTurn { id: string; chatId: string; prompt: string; enqueuedAt: number; priority: number }

export class TurnQueue {
  private readonly queues = new Map<string, QueuedTurn[]>(); // chatId → items
  /** Queue when busy — không interrupt, không drop. */
  enqueue(chatId: string, prompt: string, priority = 0): QueuedTurn {
    const item = { id: crypto.randomUUID(), chatId, prompt, enqueuedAt: nowWallclock(), priority };
    const q = this.queues.get(chatId) ?? [];
    q.push(item);
    q.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt); // priority then FIFO
    this.queues.set(chatId, q);
    return item;
  }
  /** Turn boundary — dequeue head. */
  dequeue(chatId: string): QueuedTurn | null {
    const q = this.queues.get(chatId); if (!q || q.length === 0) return null;
    return q.shift()!;
  }
  /** Control ops — operator. */
  view(chatId: string): QueuedTurn[] { return this.queues.get(chatId) ?? []; }
  delete(chatId: string, id: string): void { this.queues.set(chatId, (this.queues.get(chatId) ?? []).filter((i) => i.id !== id)); }
  promote(chatId: string, id: string): void { const q = this.queues.get(chatId) ?? []; const i = q.find((x) => x.id === id); if (i) i.priority = 999; q.sort((a, b) => b.priority - a.priority); }
}
// loop.ts turn-end → dequeue(chatId) → next turn. Commands parse → queue ops.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không drop/interrupt prompt khi busy | ❌ Queue có thể dài — latency tăng |
| ✅ Operator control (view/delete/promote) | ❌ Priority promote có thể starvation |
| ✅ Priority — important trước | ❌ Stale detection cần TTL tuning |
| ✅ Nối channel adapters sẵn | ❌ force-next skip có thể mất work |

## Khác các hướng gần

| | AIG Telegram-Queue-Control | AIE Parallel-Background-Queue | AII Multi-Instance-Bus-Leader |
|---|---|---|---|
| Trọng tâm | Queue prompt khi busy | Queue agent khi full concurrency | Leader poll khi nhiều instance |
| Cơ chế | Turn-queue + control ops | Semaphore + wait-queue | Leader/follower + heartbeat |
| Quan hệ | Channel inbound queue | Agent execution queue | Bot poll coordination |

## Khi nào chọn

- Channel (Telegram) gửi prompt khi agent busy → cần queue không drop
- Operator cần control (view/delete/promote/force)
- Priority — prompt quan trọng trước
- Guard: queue per chat, priority+FIFO, stale TTL, abort safe, force-next opt-in
