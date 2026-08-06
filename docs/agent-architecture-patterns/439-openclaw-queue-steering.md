# Hướng PW: Queue Steering — gom lệnh trong cửa sổ yên lặng, inject giữa lượt xếp hàng

> **Nguồn gốc:** OpenClaw (queue steering, quiet-window batching); "message coalescing"; "debounced turn injection"; "in-flight queue enrichment"; "conversational backpressure"
> **Coupling:** 🟢 — thêm queue-batching + prompt-injection layer trước turn dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + message queue sẵn — chưa có quiet-window detector + mid-queue injection)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenClaw** xử lý tình huống user gửi nhiều message liên tiếp ("sửa file A", "à quên thêm B", "thêm test nữa"). Nếu mỗi message là 1 turn riêng, agent phản ứng từng cái → tác động dở dang, lặp, mất ngữ cảnh. **Queue steering**: thay vì dispatch ngay, queue gom message trong **cửa sổ yên lặng** (quiet window — không message mới trong N giây). Khi cửa sổ đóng, tất cả message đã gom được **inject** vào prompt của 1 turn duy nhất. Giống **message coalescing** (OS interrupt coalescing) và **debouncing** (UI). Nguyên tắc: **đợi user xong rồi mới hành động** — không phản ứng từng tin rời rạc. Khác **99 progressive-disclosure** (curate context) — PW là **batch input**; khác **402 OL request-type** (classify intent) — PW là **time-based coalescing**.

## Mô tả

mya queue steering: message queue có **quiet-window detector**. Khi message đến, timer reset. Nếu không message mới trong `quietMs` (vd 1500ms) → **flush queue**: gom tất cả message thành 1 enriched prompt. Nếu message mới đến trong window → reset timer (gom thêm). Ngoài ra cho phép **mid-queue injection**: giữa 2 lượt xếp hàng (agent đang chờ), dữ liệu mới (web-hook, tool-result, scheduled) được **steer** vào prompt trước khi agent bắt đầu turn. Mở rộng **agent-loop** (turn dispatch) bằng **debounced queue + injection slot**.

## Kiến trúc

```
  USER MESSAGES (rapid-fire):
  "fix bug in auth.ts" ──►┐
  "also add logging"   ──►├── QUEUE (coalescing)
  "oh and add test"    ──►┘
                          │
                    ┌─────▼──────┐
                    │  QUIET      │  timer resets on each msg
                    │  WINDOW     │  flush when idle > quietMs
                    │  (1500ms)   │
                    └─────┬──────┘
                          │ (all 3 messages batched)
                          ▼
  ┌─── INJECTION SLOT ─────────────────────────────┐
  │                                                  │
  │  [user] fix bug in auth.ts                       │
  │  [user] also add logging                         │
  │  [user] oh and add test                          │
  │  ── mid-queue injection ──                       │
  │  [system] webhook: CI build #42 failed           │
  │                                                  │
  │  → 1 enriched turn (not 3 turns)                 │
  └──────────────────────┬───────────────────────────┘
                         │
                         ▼
                    AGENT LOOP
                  (single dispatch)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ agent-loop — turn dispatch (nền — PW adds queue batching)
// ✅ message queue — messages được queue (nền — PW adds quiet-window)
// ✅ tool-result injection — tool results inject vào turn (nền)
// ✅ 83 tool-discovery — tool scheduling (relate)

// ❌ THIẾU: quiet-window detector (debounce timer trên message arrival)
// ❌ THIẾU: message coalescing (gom nhiều msg → 1 enriched prompt)
// ❌ THIẾU: mid-queue injection slot (inject webhook/scheduled giữa lượt)
// ❌ THIẾU: conversational backpressure (signal user "đang gom, chờ")
```

## Implementation

```typescript
// packages/agent/src/queue-steering.ts (NEW)
interface QueuedMessage {
  role: 'user' | 'system';
  content: string;
  source: 'user' | 'webhook' | 'scheduled' | 'tool-callback';
  arrivedAt: number;
}

class QueueSteerer {
  private queue: QueuedMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private quietMs = 1500;

  constructor(private dispatch: (messages: QueuedMessage[]) => Promise<void>) {}

  enqueue(msg: QueuedMessage): void {
    this.queue.push(msg);
    // Reset quiet-window timer on each arrival
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.quietMs);
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];
    this.timer = null;
    // Dispatch as a single enriched turn
    await this.dispatch(batch);
  }

  // Mid-queue injection: inject data while agent waits between turns
  inject(content: string, source: QueuedMessage['source']): void {
    this.enqueue({ role: 'system', content, source, arrivedAt: Date.now() });
  }

  // Force flush immediately (skip quiet window)
  forceFlush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void this.flush();
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tránh phản ứng từng tin rời rạc (1 turn thay vì N turns) | ❌ Latency tăng (quietMs delay trước mỗi dispatch) |
| ✅ Context đầy đủ (gom hết ý rồi mới hành động) | ❌ Cảm giác "chậm" nếu user quen phản hồi tức thì |
| ✅ Tiết kiệm token (1 turn thay vì N turn lặp context) | ❌ Edge case: message rất quan trọng bị trì hoãn |
| ✅ Mid-queue injection (webhook/tool-result chèn đúng lúc) | ❌ Cần backpressure UI (cho user biết đang gom) |

## Khác các hướng gần

| | 99 Progressive-Disclosure | 402 Request-Type-Auth | PW: Queue-Steering |
|---|---|---|---|
| Trọng tâm | Curate context | Classify intent | **Batch input theo thời gian** |
| Khi | Context lớn | Quyền theo intent | **User gõ nhanh liên tiếp** |
| Cơ chế | Tiered loading | Autonomy matrix | **Quiet-window debounce** |

## Khi nào chọn

- User thường gửi nhiều message liên tiếp (rapid-fire, sửa-cho-thêm-à-quên)
- Cần inject webhook/tool-result/scheduled data vào đúng turn (không turn kế tiếp)
- Muốn tiết kiệm token (gom thay vì lặp context N lần)
- Nối agent-loop (turn dispatch) + 83 tool-discovery (scheduling) + 99 progressive-disclosure (context curation)
