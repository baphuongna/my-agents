# Hướng L: Message Broker — Redis/NATS giữa agents

> **Coupling:** 🟢 Redis/NATS — agents pub/sub topics
> **Agent-agnostic:** ✅ — bất kỳ agent connect broker
> **Code sẵn:** ⚠️ Anticipated (collab relay → Redis tier 4)

## Mô tả

Agents giao tiếp qua message broker (Redis/NATS/RabbitMQ). Mỗi agent subscribe topics + publish messages. Broker handles routing, durability, retry, dead-letter. Agents hoàn toàn independent — chỉ biết topic names.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│              Message Broker (Redis / NATS)               │
│                                                          │
│   Topics:                                                │
│   · tasks.build    ← agents consume                      │
│   · tasks.review   ← agents consume                      │
│   · events.status  ← mya subscribes                      │
│   · events.tool    ← mya subscribes (audit)              │
│   · events.message ← mya subscribes (memory)             │
│                                                          │
│   ┌──────┐  publish   ┌─────────┐  consume  ┌──────┐    │
│   │ mya  │──────────►│  Broker │──────────►│ pi   │    │
│   │daemon│◄──────────│         │◄──────────│      │    │
│   └──────┘  subscribe└─────────┘  publish  └──────┘    │
│                                                          │
│   ┌──────┐              ┌─────────┘  consume  ┌──────┐   │
│   │claude│◄─────────────│         │◄──────────│open- │   │
│   │      │─────────────►│         │──────────►│code  │   │
│   └──────┘   publish    └─────────┘  publish  └──────┘   │
│                                                          │
│   Durable delivery · competing consumers · dead-letter   │
│   Language-agnostic · horizontally scalable              │
└──────────────────────────────────────────────────────────┘
```

## mya ĐÃ ANTICIPATE

```typescript
// packages/collab/src/relay.ts — comment:
// "Tier 4: swap to Redis/CRDT for multi-host"

// Current: in-memory EventBus (Tier 3)
// Future: Redis pub/sub (Tier 4)
```

## Patterns

### Request-Reply (synchronous)
```
mya → publish("tasks.build", { id: "t1", code: "..." })
pi  → consume("tasks.build") → work → publish("results.t1", { output: "..." })
mya ← subscribe("results.t1")
```

### Pub-Sub (fan-out)
```
pi → publish("events.status", { session: "s1", status: "working" })
mya ← subscribe("events.status") → update dashboard
claude ← subscribe("events.status") → know pi is busy
```

### Work Queue (competing consumers)
```
mya → push("tasks.ready", task1)
mya → push("tasks.ready", task2)
mya → push("tasks.ready", task3)
pi     → pop("tasks.ready") → task1 (atomic)
claude → pop("tasks.ready") → task2 (atomic)
opencode → pop("tasks.ready") → task3 (atomic)
```

### Scatter-Gather (fan-out + collect)
```
mya → publish("review.request", { code: "..." })
pi     → publish("review.response", { score: 8, notes: "..." })
claude → publish("review.response", { score: 9, notes: "..." })
mya ← collect all responses → aggregate
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Industry-standard infra (Redis/NATS) | ❌ Infrastructure dependency |
| ✅ Durable delivery (survive restart) | ❌ Serialization overhead |
| ✅ Natural load balancing (competing consumers) | ❌ Eventual consistency |
| ✅ Scales horizontally | ❌ Debugging distributed flows |
| ✅ Language-agnostic | ❌ Message schema evolution |
| ✅ Dead-letter queues (error handling) | |

## Khi nào chọn

- Multi-host deployment (agents trên khác máy)
- Need durable delivery (messages survive crash)
- Need horizontal scaling (many agents)
- OK with infrastructure dependency (Redis/NATS)
- Want industry-standard patterns (pub/sub, work queue)
