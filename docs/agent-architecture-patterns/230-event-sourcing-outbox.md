# Hướng HV: Event Sourcing + Outbox — mọi thay đổi là event, replay để khôi phục

> **Nguồn gốc:** Fowler "Event Sourcing" (EAA); transactional outbox pattern (Microservices.io); Conduktor "Event Sourcing with Kafka"; Axon Framework
> **Coupling:** 🟢 — event store tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (AuditLog sẵn — thiếu event store + outbox)
> **Effort:** 2-3 tuần

## Nguồn gốc

Event sourcing (Fowler EAA): "all changes to application state are stored as a sequence of events" — state không lưu trực tiếp, mà **replay events** để rebuild. Transactional outbox: giải dual-write problem — ghi state + event trong cùng transaction (outbox table), rồi async publish. AxonOps: "eliminates the dual-write by writing both the entity and the message to the database in a single operation." Conduktor: outbox ensures reliable event publishing — store event in DB tx → separate process reads + publishes to Kafka. Replay: đọc events từ đầu → rebuild state (Fowler: "Complete Rebuild").

## Mô tả

mya event sourcing: mọi thay đổi state (session create, tool call, memory write, cron fire) ghi vào **event store** (append-only). State hiện tại = replay tất cả events. Outbox: event ghi cùng transaction với state change → async publish tới subscribers. Khác audit trail (198 — chỉ ghi log, không rebuild state): event sourcing dùng events làm **source of truth**, state materialized là projection. Replay cho: crash recovery, time-travel debug (136), audit (198).

## Kiến trúc

```
  COMMAND (create_session, tool_call, cron_fire)
        │
        ▼
  ┌──────────────────────────────────────────┐
  │  AGGREGATE (state + business logic)      │
  │                                          │
  │  1. Validate command                     │
  │  2. Produce event                        │
  │  3. Append event to store + outbox       │
  │     (SINGLE TRANSACTION)                 │
  └──────────────────┬───────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ EVENT     │          │ OUTBOX TABLE     │
  │ STORE     │          │ (in same DB tx)  │
  │ (append)  │          │                  │
  │           │          │  async publisher │
  │ [e1,e2..] │          │  reads + sends   │
  └─────┬─────┘          └────────┬─────────┘
        │                         │
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ PROJECTION│          │ SUBSCRIBERS      │
  │ (rebuild  │          │ (memory, notify, │
  │  state by │          │  webhook, ...)   │
  │  replay)  │          │                  │
  └───────────┘          └──────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 198 audit trails — append-only log (nhưng chỉ ghi, không rebuild state)
// ✅ 12 event-stream — streaming events (nhưng không source of truth)
// ✅ session JSONL — có thể replay (nhưng không formal event store)
// ✅ 73 durable execution — replay từ history (gần event sourcing!)
// ✅ kanban-sqlite — state transitions (có thể event-source)

// ❌ THIẾU: formal event store (append-only, versioned events)
// ❌ THIẾU: outbox table (atomic state+event write)
// ❌ THIẜU: projection rebuild (state = replay events)
// ❌ THIẾU: event schema versioning (evolve without breaking replay)
```

## Implementation

```typescript
// packages/eventstore/src/index.ts (NEW)
interface AgentEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: unknown;
  version: number;
  timestamp: number;
}

class EventStore {
  constructor(private db: Database) {}

  // Atomic: append event + outbox in single transaction
  async append(event: AgentEvent): Promise<void> {
    this.db.transaction(() => {
      // 1. Append to event store
      this.db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?)").run(...);
      // 2. Write to outbox (same tx — dual-write problem solved)
      this.db.prepare("INSERT INTO outbox VALUES (?,?,?,?,?)").run(...);
      // 3. Apply to aggregate state
      this.applyToProjection(event);
    })();
  }

  // Replay: rebuild state from events
  async replay(aggregateId: string): Promise<AgentState> {
    const events = this.db.prepare(
      "SELECT * FROM events WHERE aggregateId = ? ORDER BY version"
    ).all(aggregateId);
    let state = initialState();
    for (const e of events) state = reduce(state, e);
    return state;
  }
}

// Outbox publisher (async, separate process)
class OutboxPublisher {
  async poll(): Promise<void> {
    const pending = this.db.prepare("SELECT * FROM outbox WHERE published = 0").all();
    for (const e of pending) {
      await this.messageBus.publish(e.type, e.payload);
      this.db.prepare("UPDATE outbox SET published = 1 WHERE id = ?").run(e.id);
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Crash recovery (replay events → rebuild state) | ❌ Complexity (event schema, projections) |
| ✅ Audit trail (events = source of truth) | ❌ Latency (projection lag) |
| ✅ Time-travel debug (replay to point T) | ❌ Event schema evolution (versioning) |
| ✅ Outbox: atomic state+event (no dual-write) | ❌ Storage growth (append-only, never delete) |
| ✅ 73 durable execution rất gần | ❌ Eventually consistent projections |

## Khác các hướng gần

| | 198 Audit Trail | 12 Event Stream | HV: Event Sourcing |
|---|---|---|---|
| Mục | Ghi log (evidence) | Stream realtime | **Source of truth** |
| Rebuild state | ❌ | ❌ | ✅ replay |
| Atomic write | ❌ | ❌ | ✅ outbox |
| Dual-write safe | N/A | ❌ | ✅ |

## Khi nào chọn

- Cần crash recovery (replay → rebuild state)
- Audit quan trọng (events = immutable evidence)
- Time-travel debug (replay to point T → inspect)
- Outbox: cần publish events reliably (no dual-write gap)
- OK với eventually consistent projections
