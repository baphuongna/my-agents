# Hướng MB: Event Schema Registry — shared contract cho pub/sub event

> **Nguồn gốc:** Confluent Schema Registry; Apache Avro/Protobuf; "schema registry for events"; "topic-based pub/sub"; CloudEvents specification; event-driven architecture contract
> **Coupling:** 🟡 — thêm schema registry + event bus
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (event-sourcing sẵn — chưa có schema registry cho event)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**Schema Registry** (Confluent): Kafka producer gửi event → registry kiểm schema compatible trước khi publish → consumer biết format. **CloudEvents** (CNCF): chuẩn format cho event (source, type, subject, time, data). **Event-driven architecture**: service publish event → subscriber consume — nhưng cần **shared contract** (schema) để producer/consumer hiểu nhau. Khác **294 message-contracts** (point-to-point message giữa agent) — MB là **pub/sub event** (1 publisher → N subscriber); khác **230 event-sourcing** (log state) — MB là **schema registry** cho event type.

## Mô tả

mya event schema registry: mỗi event type (task.completed, tool.failed, agent.spawned) có **schema đăng ký**. Publisher (agent, tool) publish event → registry check compatible → N subscriber (audit, metrics, feedback flywheel) consume. CloudEvents format: `{ source, type, subject, time, data }`. Khi schema nâng version → registry check backward compat (294). mya có 230 event-sourcing — MB thêm **schema registry** + **typed event** + **multi-subscriber**.

## Kiến trúc

```
  PUBLISHER (agent/tool)
        │
        │  publish(event)
        ▼
  ┌─── SCHEMA REGISTRY ──────────────────────┐
  │                                          │
  │  Event: "task.completed"                  │
  │  Schema v2: { taskId, duration, status }  │
  │  Compat: v2 = v1 + {duration} (ok)        │
  │         │                                │
  │    check ✓ → accept event                 │
  │         │                                │
  │  CloudEvents format:                      │
  │   { source: "agent-1",                    │
  │     type: "task.completed",               │
  │     subject: "task-42",                   │
  │     time: 2026-08-06T...,                 │
  │     data: { taskId, duration, status } }  │
  └──────────┬───────────────────────────────┘
             │
        ┌────┼────┬────────┐
        ▼    ▼    ▼        ▼
      AUDIT  METRICS FLYWHEEL ALERT
      (198)  (338)  (335)    (331)
     (subscriber 1..N)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 230 HV event-sourcing — event log (nền — MB thêm schema)
// ✅ 294 KH message-contracts — compat check (MB reuse)
// ✅ 198 GP audit — event subscriber
// ✅ 335 LW feedback-flywheel — event subscriber
// ✅ 338 LZ tool-usage-insights — event subscriber

// ❌ THIẾU: event schema registry (per event type, versioned)
// ❌ THIẾU: CloudEvents format (source/type/subject/time/data)
// ❌ THIẾU: pub/sub bus (1 publisher → N subscriber)
// ❌ THIẾU: schema compat check per publish
```

## Implementation

```typescript
// packages/events/src/registry.ts (NEW)
interface CloudEvent<T = unknown> {
  source: string;      // who published
  type: string;        // event type (e.g. "task.completed")
  subject: string;     // entity id
  time: number;
  data: T;
  schemaVersion: number;
}

type EventHandler<T> = (event: CloudEvent<T>) => Promise<void>;

class EventSchemaRegistry {
  private schemas = new Map<string, Map<number, Record<string, string>>>();
  private subscribers = new Map<string, { version: number; handler: EventHandler }[]>();

  registerSchema(eventType: string, version: number, fields: Record<string, string>): void {
    if (!this.schemas.has(eventType)) this.schemas.set(eventType, new Map());
    this.schemas.get(eventType)!.set(version, fields);
  }

  subscribe<T>(eventType: string, version: number, handler: EventHandler<T>): void {
    if (!this.subscribers.has(eventType)) this.subscribers.set(eventType, []);
    this.subscribers.get(eventType)!.push({ version, handler: handler as EventHandler });
  }

  async publish<T>(event: CloudEvent<T>): Promise<void> {
    // Schema compat check
    const schema = this.schemas.get(event.type)?.get(event.schemaVersion);
    if (schema) {
      for (const field of Object.keys(schema)) {
        if (!(field in (event.data as object))) throw new Error(`schema violation: missing "${field}"`);
      }
    }
    // Fan-out to all subscribers (version-aware — older subscriber ignores new fields)
    const subs = this.subscribers.get(event.type) ?? [];
    await Promise.all(subs.map(s => s.handler(event)));
  }
}

// Usage
// registry.registerSchema('task.completed', 2, { taskId: 'string', duration: 'number', status: 'string' });
// registry.subscribe('task.completed', 2, (e) => metrics.record(e.data));
// registry.publish({ source: 'agent-1', type: 'task.completed', subject: 'task-42', time: Date.now(), data: {...}, schemaVersion: 2 });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Shared contract — publisher/consumer hiểu nhau (Confluent) | ❌ Registry = thêm infrastructure |
| ✅ Fan-out 1→N subscriber (pub/sub decoupling) | ❌ Schema compat rule cần maintain |
| ✅ CloudEvents chuẩn (CNCF interop) | ❌ Late subscriber miss event (cần replay) |
| ✅ Nối 198/335/338 (subscriber) | ❌ Schema evolve complex (version chain) |

## Khác các hướng gần

| | 294 Message Contracts | 230 Event Sourcing | MB: Schema Registry |
|---|---|---|---|
| Pattern | Point-to-point | Log state | **Pub/sub event** |
| Subscriber | 1 consumer | Replay | **N subscriber fan-out** |
| Schema | Versioned msg | ❌ | ✅ registry per type |
| Format | Custom | Custom | **CloudEvents** |

## Khi nào chọn

- Nhiều component cần react cùng event (audit, metrics, flywheel, alert)
- Muốn shared contract (schema) cho event
- CloudEvents interop (CNCF chuẩn)
- Kết hợp 230 event-sourcing (log) + 294 contracts (compat) — MB thêm pub/sub + registry
