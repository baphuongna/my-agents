# Hướng MC: Async Request-Reply — correlation ID cho async agent communication

> **Nguồn gốc:** Async request-reply (Enterprise Integration Patterns); correlation identifier pattern; callback; long polling; WebSocket; message correlation; saga pattern; "request with future"
> **Coupling:** 🟡 — cần correlation registry + reply channel
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent messaging sẵn — chưa có correlation-based async reply)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Async request-reply** (EIP — Hohpe/Woolf): sender gửi request → nhận **correlation ID** → làm việc khác → khi reply đến (match correlation ID) → pickup result. **Correlation identifier pattern**: mỗi request có unique ID, reply mang cùng ID → sender match. Khác **sync RPC** (block đợi) — async **không block**. Saga pattern: long-running transaction với correlation. Long polling / WebSocket: đợi reply async. Nguyên tắc: **agent gửi request, không block** — khi reply đến, match correlation ID → resume. Khác **54 handoff** (transfer ownership) — MC **request-reply** (gửi rồi nhận response); khác **202 agent-communication** — MC là **pattern cụ thể** (correlation + async).

## Mô tả

mya async request-reply: agent A gửi request cho agent B (VD "phân tích code này") → nhận correlation ID → làm task khác → khi B trả reply (match ID) → A pickup result → resume. Không block đợi. Nối 331 escalation-timeouts — nếu reply không đến trong deadline → escalate. Nối 340 event-schema — reply là typed event. mya có agent messaging (202) — MC thêm **correlation ID + async reply channel + timeout**.

## Kiến trúc

```
  AGENT A                    AGENT B
     │                          │
     │ ── request(correlationId=42) ──►
     │                          │
     │ (không block — làm task khác)    (xử lý...)
     │   · chạy tool khác               │
     │   · gửi request khác             │
     │                          │
     │ ◄──── reply(correlationId=42) ── │
     │                          │
     │ match ID=42 → pickup result      │
     │ → resume task liên quan           │
     │                          │
     │ (nếu timeout → escalate 331)      │
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 202 agent-communication-patterns — messaging (nền)
// ✅ 54 handoff — transfer (related — MC request-reply)
// ✅ 331 LS escalation — timeout (MC deadline)
// ✅ 340 MB event-schema — typed reply (MC reply format)
// ✅ 203 GU retry — retry (nếu reply fail)
// ✅ 291 cancel-propagation — cancel pending (MC cancel)

// ❌ THIẾU: correlation ID generation + tracking
// ❌ THIẾU: async reply channel (reply → match ID → resolve future)
// ❌ THIẾU: pending request registry (ID → callback)
// ❌ THIẾU: timeout per request (→ escalate 331)
```

## Implementation

```typescript
// packages/agent/src/async-rpc.ts (NEW)
interface PendingRequest<T = unknown> {
  correlationId: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
}

class AsyncRequestReply {
  private pending = new Map<string, PendingRequest>();

  // Sender — gửi request, trả promise (không block)
  request<T>(send: (correlationId: string) => void, timeoutMs = 30_000): Promise<T> {
    const correlationId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new DeadlineExceeded(`request ${correlationId} timed out`)); // → escalate 331
      }, timeoutMs);
      this.pending.set(correlationId, { correlationId, resolve, reject, deadline: Date.now() + timeoutMs, timer });
      send(correlationId); // gửi request (non-blocking)
    });
  }

  // Reply channel — khi reply đến, match correlation ID → resolve
  reply<T>(correlationId: string, result: T): void {
    const req = this.pending.get(correlationId);
    if (!req) return; // stale reply (timeout rồi) → ignore
    clearTimeout(req.timer);
    this.pending.delete(correlationId);
    req.resolve(result);
  }

  // Error reply
  fail(correlationId: string, error: Error): void {
    const req = this.pending.get(correlationId);
    if (!req) return;
    clearTimeout(req.timer);
    this.pending.delete(correlationId);
    req.reject(error);
  }

  // Cancel pending (291 cancel-propagation)
  cancel(correlationId: string): void { this.fail(correlationId, new Error('cancelled')); }

  // Cleanup expired (safety net)
  gc(): void {
    const now = Date.now();
    for (const [id, req] of this.pending) {
      if (now > req.deadline) { clearTimeout(req.timer); this.pending.delete(id); }
    }
  }
}

// Usage: const result = await rpc.request(id => agentB.send({ type: 'analyze', correlationId: id }));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không block — agent làm nhiều việc song song (EIP) | ❌ Pending registry = state to manage |
| ✅ Correlation ID match reply chính xác | ❌ Stale reply (timeout rồi reply mới đến) |
| ✅ Timeout → escalate (331) | ❌ Memory leak nếu GC thiếu (pending pile up) |
| ✅ Nối 291 cancel + 340 event | ❌ Debug khó (async timeline) |

## Khác các hướng gần

| | 54 Handoff | 202 Agent Messaging | 331 Escalation | MC: Async Req-Reply |
|---|---|---|---|---|
| Pattern | Transfer ownership | Send message | Deadline escalation | **Request → correlation → reply** |
| Block? | ❌ | ❌ | ❌ | ❌ (async) |
| Reply | ❌ | ❌ | ❌ | ✅ match ID |
| Cancel | ❌ | ❌ | ❌ | ✅ (291) |

## Khi nào chọn

- Agent cần gửi request, không block đợi (làm việc khác song song)
- Reply đến sau (long-running: code analysis, build, search)
- Muốn correlation ID match reply chính xác
- Kết hợp 331 escalation (timeout) + 291 cancel (cancel pending) + 340 schema (typed reply)
