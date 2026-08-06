# Hướng NQ: Inter-Session Message Broker — broker 1:1 session↔session, ask/reply timeout, mailbox

> **Nguồn gốc:** Message broker (pub/sub, request-reply); actor mailbox (Erlang/Akka); Unix domain socket broker; "dead-letter queue"; pi-intercom broker
> **Coupling:** 🟢 — lớp transport/broker tách biệt core
> **Agent-agnostic:** ✅
> **Code sẵn:** ✅ (packages/intercom đã có broker + mailbox + ask/reply timeout)
> **Effort:** 0.5-1 tuần (đã có — tài liệu hóa + mở rộng)

## Nguồn gốc

**Message broker** (pub/sub, request-reply): trung gian route message giữa các participant mà chúng không cần biết địa chỉ của nhau — broker quản lý routing, delivery, retry. **Actor mailbox** (Erlang/Akka, actor model): mỗi actor có mailbox — message đến khi actor offline được lưu, flush khi actor online lại. **Request-reply với timeout** (RPC): caller gửi ask → chờ reply trong khoảng timeout → nếu quá timeout → fail/error. **Dead-letter / retained message**: message không deliver được (recipient offline) được lưu cho sau. Nguyên tắc: session giao tiếp session **qua broker** (không direct), với **mailbox** (offline delivery) + **ask/reply timeout** (không treo vĩnh viễn). Khác **341 async-req-reply** (async pattern client-side) — NQ là **broker hạ tầng** route giữa nhiều session; khác **328 deferred-questions** (defer user question) — NQ defer **message delivery**.

## Mô tả

mya inter-session message broker: một tiến trình broker trung gian (Unix socket / TCP) route message giữa các agent session. Session đăng ký (register) → broker cấp ID → gửi message tới session khác qua broker. Hai chế độ: (1) **send** (fire-and-forget — message vào mailbox nếu recipient offline), (2) **ask** (request-reply blocking — chờ reply, timeout `DEFAULT_ASK_TIMEOUT_MS = 10min`, quá timeout → error). Broker giữ **mailbox** (lưu message khi recipient offline, flush khi online lại, retention 24h, max 256 messages). mya `packages/intercom` ĐÃ CÓ đầy đủ broker này.

## Kiến trúc

```
   SESSION A (subagent)          SESSION B (supervisor)
       │                              │
       │  register ──► BROKER ◄── register
       │                 │
       │  ┌── ASK (request-reply, timeout) ──┐
       │  │   A → broker → B                  │
       │  │   B → broker → A (reply)          │
       │  │   ⏱ timeout 10min → fail          │
       │  └───────────────────────────────────┘
       │
       │  ┌── SEND (fire-and-forget) ─────────┐
       │  │   A → broker                       │
       │  │   B offline? → MAILBOX (retention)│
       │  │   B online → flush mailbox → B    │
       │  └───────────────────────────────────┘
       │
   BROKER RESPONSIBILITIES:
    · route 1:1 (by stable session ID)
    · rate limit (240 cap, 120/s refill)
    · presence heartbeat (1s)
    · mailbox: 24h retention, 256 max
    · disconnected session: 24h retention
```

## mya ĐÃ CÓ (đầy đủ)

```typescript
// ✅ packages/intercom/src/broker/broker.ts — broker trung gian (Unix socket)
// ✅ ask/reply timeout — DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000 (config.ts)
// ✅ mailbox — MAILBOX_MESSAGE_RETENTION_MS = 24h, MAX_MAILBOX_MESSAGES = 256
// ✅ session register/presence — PRESENCE_HEARTBEAT_MS = 1000
// ✅ rate limit — RATE_LIMIT_CAPACITY = 240, REFILL 120/s
// ✅ disconnected session retention — 24h
// ✅ message receipt routing — route tracking + retention
// ✅ stable session ID — restart-stable addressing (stableId)
// ✅ client.ts — client-side send/ask API

// ✅ 341 async-req-reply — async request-reply pattern (nền — NQ là hạ tầng broker)
// ✅ 292 agent-lifecycle-hooks — register/unregister hooks
```

## Implementation

```typescript
// packages/intercom/src/broker/broker.ts (ĐÃ CÓ — minh họa cấu trúc)
const MAILBOX_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_MAILBOX_MESSAGES = 256;

interface MailboxMessage {
  from: string;
  to: string;
  message: BrokerMessage;
  queuedAt: number;
}

class IntercomBroker {
  private sessions = new Map<string, ConnectedSession>();
  private mailboxMessages: MailboxMessage[] = [];
  private readonly askTimeoutMs = getAskTimeoutMs(); // 10 min

  // Route message 1:1 — live hoặc mailbox
  route(from: string, target: SessionInfo, message: BrokerMessage): MessageReceipt {
    const live = this.findLiveSession(target.id);
    if (live) {
      writeMessage(live.socket, message);      // deliver ngay
      return { status: 'delivered' };
    }
    this.queueMailboxMessage(from, target, message); // offline → mailbox
    return { status: 'queued' };
  }

  // Flush mailbox khi session online lại
  flushMailboxForSession(session: ConnectedSession): void {
    const pending = this.mailboxMessages.filter(m => m.to === session.info.id);
    for (const m of pending) writeMessage(session.socket, m.message);
    this.mailboxMessages = this.mailboxMessages.filter(m => m.to !== session.info.id);
  }

  // Prune mailbox theo retention + capacity
  private pruneMailboxMessages(): void {
    const cutoff = Date.now() - MAILBOX_MESSAGE_RETENTION_MS;
    this.mailboxMessages = this.mailboxMessages.filter(m => m.queuedAt > cutoff);
    if (this.mailboxMessages.length > MAX_MAILBOX_MESSAGES) {
      this.mailboxMessages = this.mailboxMessages.slice(-MAX_MAILBOX_MESSAGES); // FIFO drop
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Session không cần biết địa chỉ nhau (broker route) | ❌ Broker là SPOF (single point of failure) |
| ✅ Offline delivery (mailbox 24h) | ❌ Overhead 1 hop (latency +1) |
| ✅ Timeout chặn treo vĩnh viễn (ask/reply) | ❌ Mailbox giới hạn (256 → FIFO drop) |
| ✅ Rate limit bảo vệ (240/120 per s) | ❌ Retention tuning (24h có thể thừa/thiếu) |

## Khác các hướng gần

| | 341 Async Req-Reply | 328 Deferred Questions | 327 Interruptible | NQ: Message Broker |
|---|---|---|---|---|
| Cái gì | Async RPC client | Defer user question | Interrupt agent | **Hạ tầng route session↔session** |
| Mailbox | ❌ | ❌ | ❌ | ✅ offline delivery |
| Timeout | ❌ | ❌ | ❌ | ✅ ask/reply 10min |
| Multi-party | ❌ (1:1) | ❌ | ❌ | ✅ broker N session |

## Khi nào chọn

- Nhiều agent session cần giao tiếp (subagent↔supervisor, peer agent)
- Recipient có thể offline (cần mailbox)
- Cần chặn treo (ask/reply timeout)
- mya ĐÃ CÓ (packages/intercom) — chỉ cần tài liệu hóa + tune retention/timeout; kết hợp 382 escalation protocol (taxonomy reason trên broker)
