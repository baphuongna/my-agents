# Hướng AH: CQRS — tách command path khỏi query path

> **Nguồn gốc:** Command Query Responsibility Segregation (Fowler, 2010; from Bertrand Meyer's CQS)
> **Coupling:** 🟡 Separate read/write models
> **Agent-agnostic:** ✅ — commands và queries độc lập
> **Effort:** 2-3 tuần

## Nguồn gốc

CQRS (Fowler, 2010): tách operations thành Commands (thay đổi state — write) và Queries (đọc state — read). Commands và queries có models riêng. Write model optimized cho writes, read model optimized cho reads. Eventual consistency giữa 2 models.

## Mô tả

mya CQRS: **Command path** = agents thực hiện (tool calls, edits, deployments) → write events vào event store. **Query path** = dashboard/API đọc (session status, memory facts, cost reports) → read model (projections). Agents không bao giờ đọc trực tiếp state — chỉ nhận commands, emit events.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   COMMAND PATH (write)              QUERY PATH (read)        │
│                                                              │
│   ┌──────────────┐                 ┌──────────────────┐      │
│   │ User/Cron    │                 │ Web Dashboard    │      │
│   │ Channels     │                 │ API clients      │      │
│   │ API          │                 │ TUI              │      │
│   └──────┬───────┘                 └────────┬─────────┘      │
│          │ commands                          │ queries       │
│          ▼                                   ▼               │
│   ┌──────────────┐                 ┌──────────────────┐      │
│   │ COMMAND      │                 │ QUERY HANDLER    │      │
│   │ HANDLER      │                 │                  │      │
│   │              │                 │  GET /status     │      │
│   │ spawn agent  │                 │  GET /sessions   │      │
│   │ run tool     │                 │  GET /memory     │      │
│   │ edit file    │                 │  GET /cost       │      │
│   │ deploy       │                 │  GET /logs       │      │
│   └──────┬───────┘                 └────────┬─────────┘      │
│          │                                   ▲               │
│          │ emits                             │ reads         │
│          ▼                                   │               │
│   ┌─────────────────────────────────────────┐│              │
│   │          EVENT STORE                    ││              │
│   │  (append-only, immutable)               ││              │
│   │                                         ││              │
│   │  [e1: agent_spawned]                    ││              │
│   │  [e2: turn_start]                       ││              │
│   │  [e3: tool_call:edit]                   ││              │
│   │  [e4: tool_result:ok]                   ││              │
│   │  [e5: turn_end]                         ││              │
│   └──────────────┬──────────────────────────┘│              │
│                  │                           │              │
│                  ▼                           │              │
│   ┌────────────────────────────┐             │              │
│   │   READ MODEL PROJECTIONS   │             │              │
│   │                            │             │              │
│   │  · sessions view           │─────────────┘              │
│   │  · memory facts view       │  (materialized,            │
│   │  · cost totals view        │   denormalized,            │
│   │  · audit chain view        │   query-optimized)         │
│   │  · status matrix view      │                             │
│   └────────────────────────────┘                             │
│                                                              │
│   AGENTS: receive commands → execute → emit events.          │
│   DASHBOARD: read projections (never agents directly).       │
│   Eventually consistent (projection lag).                    │
└──────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/cqrs/src/index.ts
// Commands (write side)
interface Command {
  type: string;
  payload: Record<string, unknown>;
}

class CommandBus {
  private handlers = new Map<string, CommandHandler>();

  register(type: string, handler: CommandHandler): void {
    this.handlers.set(type, handler);
  }

  async dispatch(command: Command): Promise<void> {
    const handler = this.handlers.get(command.type);
    if (!handler) throw new Error(`No handler for command: ${command.type}`);
    await handler.handle(command);
    // Command handler emits events to event store
  }
}

// Queries (read side)
interface Query<T> {
  type: string;
  params: Record<string, unknown>;
}

class QueryBus {
  private handlers = new Map<string, QueryHandler>();

  register<T>(type: string, handler: QueryHandler<T>): void {
    this.handlers.set(type, handler);
  }

  async ask<T>(query: Query<T>): Promise<T> {
    const handler = this.handlers.get(query.type);
    if (!handler) throw new Error(`No handler for query: ${query.type}`);
    return handler.handle(query.params);
  }
}

// Projections (materialized read models)
class Projection {
  private sessions = new Map<string, SessionView>();
  private facts: Fact[] = [];
  private costs = new Map<string, number>();

  // Subscribe to events, update projections
  apply(event: AgentEvent): void {
    switch (event.type) {
      case "agent_spawned":
        this.sessions.set(event.sessionId, {
          id: event.sessionId, status: "idle", startedAt: event.timestamp,
        });
        break;
      case "turn_start":
        this.sessions.get(event.sessionId)!.status = "working";
        break;
      case "tool_call":
        this.sessions.get(event.sessionId)!.lastTool = event.toolName;
        break;
      case "turn_end":
        this.sessions.get(event.sessionId)!.status = "idle";
        const cost = this.costs.get(event.sessionId) ?? 0;
        this.costs.set(event.sessionId, cost + event.usage?.totalCost ?? 0);
        break;
      case "message_end":
        if (event.role === "assistant") {
          this.facts.push(...autoCapture(event.content));
        }
        break;
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Independent scaling (read/write models) | ❌ Eventual consistency (projection lag) |
| ✅ Query-optimized views (denormalized) | ❌ Complexity (2 models + projections) |
| ✅ Command audit trail (event store) | ❌ Data duplication (events + projections) |
| ✅ Agents not blocked by reads | ❌ Projection rebuild on schema change |
| ✅ Natural separation of concerns | |

## Khi nào chọn

- High read/write asymmetry (many dashboard reads, fewer commands)
- Want audit trail (event store as source of truth)
- Agents shouldn't block on reads
- Need query-optimized views (materialized projections)
- OK with eventual consistency
