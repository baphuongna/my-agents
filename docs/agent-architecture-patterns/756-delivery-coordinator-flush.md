# Hướng ACB: Delivery Coordinator Flush — trì hoãn flush message sang macrotask kế tiếp vì session_start fire trước khi _reconnectToAgent() được gọi — synchronous delivery mất JSONL persistence

> **Nguồn gốc:** pi-crew (extension/runtime/delivery-coordinator.ts) | **Coupling:** 🟡 — thêm delivery coordinator vào event delivery path | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có broker delivery_failed + flushMailbox — chưa có macrotask defer) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew** `DeliveryCoordinator` phát hiện một **race điển hình**: `session_start` fire **trước khi** `_reconnectToAgent()` được gọi — nếu delivery **synchronous** (flush ngay khi nhận event), agent events sẽ được emit trong lúc **session listener đang bị disconnect** → **mất JSONL persistence** (event không được ghi vào session file). Giải pháp: **trì hoãn flush message sang macrotask kế tiếp** (`setTimeout(..., 0)` / queueMacrotask) — đợi reconnect xong rồi mới flush → listener đã sẵn sàng → persistence không mất. Nguyên tắc: **synchronous delivery trong lúc listener chưa connect = mất data, defer sang macrotask kế tiếp, flush chỉ khi listener sẵn sàng**.

## Mô tả

mya delivery coordinator flush: event delivery qua **coordinator** — nhận event (session_start, agent event...) → **defer flush sang macrotask kế tiếp** (`setTimeout(fn, 0)` hoặc `queueMicrotask`-tương đương ở macrotask level) → lúc đó `_reconnectToAgent()` đã chạy, listener đã sẵn sàng → flush message → **JSONL persistence an toàn**. Không flush ngay (synchronous) — vì listener có thể đang disconnect. mya có packages/intercom broker.ts (flushMailboxForSession, delivery_failed) + packages/core spill.ts (persistence) — ACB thêm **delivery coordinator** (defer flush) + **macrotask boundary** + **listener-ready check**.

## Kiến trúc

```
  SESSION START / AGENT EVENT
       │
       ▼
  DELIVERY COORDINATOR
  ┌────────────────────────────────────────────────┐
  │  1. Nhận event (session_start, agent event)    │
  │  2. KHÔNG flush ngay (synchronous = nguy hiểm) │
  │  3. DEFER sang macrotask kế tiếp               │
  │     setTimeout(flush, 0)                       │
  │  4. Trong lúc đó: _reconnectToAgent() chạy     │
  │     → session listener connect lại             │
  └──────────────────────┬─────────────────────────┘
                         ▼ (macrotask kế tiếp)
  FLUSH MESSAGE (listener đã sẵn sàng)
       │
       ▼
  JSONL PERSISTENCE (không mất event)
  → synchronous delivery trước reconnect = MẤT DATA
  → defer = flush an toàn
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom broker.ts — flushMailboxForSession + delivery_failed (nền — ACB flush)
// ✅ packages/intercom client.ts — message delivery (nền — ACB delivery path)
// ✅ packages/core session.ts — session JSONL (nền — ACB persistence target)
// ✅ packages/core spill.ts — persistence (nền — ACB data safety)

// ❌ THIẾU: delivery coordinator (defer flush sang macrotask)
// ❌ THIẾU: reconnect ordering (flush chỉ sau khi _reconnectToAgent chạy)
// ❌ THIẾU: listener-ready check (không flush khi listener còn disconnect)
```

## Implementation

```typescript
// packages/intercom/src/delivery-coordinator.ts (MỚI)

export interface DeliveryListener { ready: boolean; persist(msg: string): void }

/** Delivery coordinator: defer flush sang macrotask kế tiếp — tránh mất JSONL khi listener chưa connect. */
export class DeliveryCoordinator {
  private queue: string[] = [];
  private scheduled = false;

  constructor(private listener: DeliveryListener) {}

  /** Nhận message: KHÔNG flush ngay — defer sang macrotask kế tiếp. */
  enqueue(msg: string): void {
    this.queue.push(msg);
    if (!this.scheduled) {
      this.scheduled = true;
      // macrotask kế tiếp: lúc này _reconnectToAgent() đã chạy (nếu cần)
      setTimeout(() => this.flushNow(), 0);
    }
  }

  /** Flush thật sự: chỉ khi listener ready — nếu không, giữ queue (không mất). */
  private flushNow(): void {
    this.scheduled = false;
    if (!this.listener.ready) {
      // listener còn disconnect (reconnect chưa xong) → KHÔNG flush, giữ lại
      this.reschedule();
      return;
    }
    const batch = this.queue;
    this.queue = [];
    for (const msg of batch) this.listener.persist(msg); // JSONL persistence an toàn
  }

  private reschedule(): void {
    if (this.queue.length > 0 && !this.scheduled) {
      this.scheduled = true;
      setTimeout(() => this.flushNow(), 0);
    }
  }

  /** Coordinator gọi sau khi reconnect xong — đánh dấu listener sẵn sàng. */
  markReady(): void {
    this.listener.ready = true;
    this.reschedule(); // flush ngay khi listener đã connect
  }
}
// Usage:
// const coordinator = new DeliveryCoordinator({ ready: false, persist: jsonl.append });
// agent.on("event", e => coordinator.enqueue(JSON.stringify(e)));
// // session_start fire trước _reconnectToAgent → flush bị defer (không mất data)
// coordinator.markReady(); // reconnect xong → flush an toàn → JSONL đầy đủ
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không mất data (defer → flush khi listener ready) | ❌ Defer overhead (mỗi message chờ 1 macrotask — latency nhỏ) |
| ✅ Race resolved (session_start vs reconnect — thứ tự đúng) | ❌ Queue unbounded (listener không bao giờ ready → queue phình) |
| ✅ Batch flush (nhiều message 1 macrotask — hiệu quả) | ❌ Ready check phức tạp (xác định "ready" đúng lúc) |
| ✅ JSONL đầy đủ (persistence không mất event) | ❌ Ordering (macrotask defer có thể đảo thứ tự nếu không cẩn thận) |

## Khác các hướng gần

| | Synchronous delivery (flush ngay) | Buffer vô hạn (không flush) | ACB: Coordinator Defer |
|---|---|---|---|
| session_start trước reconnect | **mất data** | không mất nhưng kẹt | **defer → flush khi ready** |
| Latency | thấp | cao (kẹt) | **1 macrotask (nhỏ)** |
| Queue | 0 | vô hạn | **bounded + retry** |
| Persistence | rủi ro | an toàn | **an toàn + đúng thứ tự** |

## Khi nào chọn

- Event delivery có race (session_start fire trước reconnect — listener chưa sẵn sàng)
- Persistence quan trọng (JSONL phải đầy đủ — không mất event)
- Muốn defer an toàn thay vì synchronous risk
- Nối packages/intercom broker.ts + client.ts + packages/core session.ts + spill.ts; guard queue-bound (queue có giới hạn + TTL — listener chết lâu không phình), ready-detection (xác định listener ready đúng — không flush sớm), và ordering-stability (macrotask defer giữ thứ tự message); ACB = delivery coordinator flush, kết hợp 756-family pi-crew runtime với packages/intercom broker (flushMailboxForSession) + packages/core spill.ts (persistence)
