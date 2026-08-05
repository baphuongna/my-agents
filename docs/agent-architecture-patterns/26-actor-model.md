# Hướng Z: Actor Model — tất cả là actor

> **Nguồn gốc:** Hewitt (1973). Popularized bởi Erlang/Akka.
> **Coupling:** 🟡 Mailbox + message passing
> **Agent-agnostic:** ✅ — bất kỳ actor
> **Effort:** 2-3 tuần

## Nguồn gốc

Actor Model (Carl Hewitt, 1973) — everything is an actor. Mỗi actor có mailbox, xử lý messages tuần tự, tạo actors mới. Location transparency: actor có thể ở cùng process, khác process, khác máy — giao tiếp giống nhau.

## Mô tả

MỌI THỨ là actor trong mya:
- pi process = actor (mailbox: stdin)
- claude process = actor (mailbox: stdin)
- memory service = actor (mailbox: HTTP/socket)
- cron scheduler = actor (mailbox: timer)
- gateway = actor (mailbox: HTTP requests)
- mỗi tool = actor (mailbox: tool call)

Location transparency + fault tolerance (supervisors restart crashed actors).

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                    ACTOR MODEL                            │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  pi actor   │  │ claude actor│  │ memory actor│      │
│  │             │  │             │  │             │      │
│  │ [mailbox]   │  │ [mailbox]   │  │ [mailbox]   │      │
│  │  stdin      │  │  stdin      │  │  HTTP       │      │
│  │             │  │             │  │             │      │
│  │ receive:    │  │ receive:    │  │ receive:    │      │
│  │  prompt     │  │  prompt     │  │  recall     │      │
│  │  abort      │  │  abort      │  │  record     │      │
│  │  steer      │  │  steer      │  │  consolidate│      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │              │
│         └───────┬────────┘                │              │
│                 ▼                         │              │
│         ┌───────────────┐                │              │
│         │  supervisor   │                │              │
│         │  actor        │                │              │
│         │               │                │              │
│         │ watches:      │                │              │
│         │ · pi crash →  │                │              │
│         │   restart     │                │              │
│         │ · claude crash│                │              │
│         │   → restart   │                │              │
│         └───────────────┘                │              │
│                                          ▼              │
│         ┌───────────────┐  ┌──────────────────────┐    │
│         │  cron actor   │  │  gateway actor       │    │
│         │               │  │                      │    │
│         │ [mailbox:     │  │ [mailbox:            │    │
│         │  timer]       │  │  HTTP requests]      │    │
│         │ receive:      │  │ receive:             │    │
│         │  schedule     │  │  POST /sessions      │    │
│         │  fire         │  │  GET /status         │    │
│         └───────────────┘  └──────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## Actor primitives

```typescript
// packages/actor/src/index.ts
interface Actor {
  send(message: Message): void;        // fire-and-forget into mailbox
  receive(pattern: MessagePattern): Promise<Message>;  // block for match
  spawn(actor: ActorFactory): Actor;   // create new actor
}

// Location transparency
interface ActorRef {
  send(message: Message): void;
  // Same interface whether actor is:
  // · In-process (direct function call)
  // · Subprocess (JSON-RPC over stdio)
  // · Remote machine (HTTP/WS)
}
```

## Erlang-style supervision

```typescript
class Supervisor {
  private children: Map<string, ActorRef> = new Map();
  private strategy: "one-for-one" | "one-for-all";

  // Watch child actors
  watch(childId: string, actor: ActorRef) {
    this.children.set(childId, actor);
    // Subscribe to crash events
    actor.on("crash", (err) => {
      if (this.strategy === "one-for-one") {
        // Restart only crashed child
        const replacement = this.restart(childId);
        this.children.set(childId, replacement);
      } else {
        // Restart all children
        this.restartAll();
      }
    });
  }

  private restart(childId: string): ActorRef {
    const config = this.childConfigs.get(childId);
    const fresh = spawn(config.factory);
    log(`[supervisor] restarted ${childId} after crash`);
    return fresh;
  }
}
```

## Mapping mya components to actors

| Hiện tại | Actor model |
|---|---|
| RuntimePool | Supervisor (watches session actors) |
| PiInProcessRuntime | pi actor (mailbox: stdin JSON-RPC) |
| ClaudeRuntime | claude actor (mailbox: stdin JSON-RPC) |
| MemoryManager | memory actor (mailbox: recall/record) |
| CronScheduler | cron actor (mailbox: timer events) |
| Gateway | gateway actor (mailbox: HTTP requests) |
| ChannelRouter | channel actor (mailbox: inbound messages) |
| AuditLog | audit actor (mailbox: append/verify) |

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Location transparency (same API, any location) | ❌ Mailbox overhead (message serialization) |
| ✅ Fault tolerance (supervisors restart) | ❌ No shared state (everything via messages) |
| ✅ Scalability (add actors horizontally) | ❌ Debugging (message flow tracing) |
| ✅ Testability (send message, assert response) | ❌ Backpressure handling |
| ✅ "Let it crash" philosophy | ❌ Async (no synchronous guarantee) |

## Khi nào chọn

- Want unified abstraction (everything = actor)
- Need fault tolerance (supervisors auto-restart)
- Want location transparency (same code, any deployment)
- Building distributed system (many processes/machines)
- OK with message-passing overhead
