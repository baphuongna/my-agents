# Hướng L: Event-Sourced Ledger — append-only log, derive state

> **Coupling:** 🟢 Log — agents produce events, mya consumes
> **Agent-agnostic:** ✅ — bất kỳ agent emit events
> **Code sẵn:** ✅ AuditLog (Merkle) + AcpEventLedger

## Mô tả

Mọi agent action là immutable event appended vào ordered log. Log IS the state — agent state derived bằng replay events. Checkpoints cho fast-forward. Multiple consumers đọc cùng log → different views. No direct state mutation.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│              Append-Only Event Log (JSONL)               │
│                                                          │
│  [e1: spawn pi] [e2: turn_start] [e3: tool_call:read]    │
│  [e4: tool_result] [e5: message:assistant] [e6: turn_end]│
│  [e7: spawn claude] [e8: task_start] [e9: tool_call:bash]│
│  [e10: tool_result] [e11: task_done] ...                 │
│                                                          │
│         ┌─────────────────┼─────────────────┐            │
│         ▼                 ▼                 ▼            │
│   ┌──────────┐     ┌──────────┐      ┌──────────┐        │
│   │ Memory   │     │ Audit    │      │ Web UI   │        │
│   │projection│     │projection│      │projection│        │
│   │          │     │          │      │          │        │
│   │ facts ←  │     │ hash ←   │      │ status ← │        │
│   │ messages │     │ tool_    │      │ turn_    │        │
│   │          │     │ calls    │      │ events   │        │
│   └──────────┘     └──────────┘      └──────────┘        │
│                                                          │
│   Agents PRODUCE events. mya CONSUMES + derives state.   │
│   Multiple consumers = different views from same log.    │
└──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// packages/audit/src/index.ts — MERKLE AUDIT LOG
export class AuditLog {
  private chain: AuditRecord[] = [];
  private prevHash = "";

  append(record: Omit<AuditRecord, "hash" | "prevHash">): void {
    const full: AuditRecord = {
      ...record,
      prevHash: this.prevHash,
      hash: sha256(this.prevHash + JSON.stringify(record)),
    };
    this.chain.push(full);
    this.prevHash = full.hash;
    // Checkpoint every 100 records
    if (this.chain.length % 100 === 0) this.checkpoint();
  }

  verify(): boolean {
    // Recompute hash chain from beginning
    let prevHash = "";
    for (const record of this.chain) {
      const computed = sha256(prevHash + JSON.stringify(record));
      if (computed !== record.hash) return false;
      prevHash = record.hash;
    }
    return true;
  }
}

// packages/acp/src/index.ts — BOUNDED REPLAYABLE LEDGER
export class AcpEventLedger {
  private events: AcpEvent[] = [];
  private cursor = 0;

  append(event: AcpEvent): void {
    this.events.push(event);
    // Bounded: keep last N events
    if (this.events.length > MAX_LEDGER_SIZE) {
      this.events.shift();
      this.cursor--;
    }
  }

  replay(since: number): AcpEvent[] {
    return this.events.slice(since);
  }
}
```

## Event schema

```typescript
interface AgentEvent {
  // Identity
  id: string;              // UUID
  sessionId: string;       // Which agent session
  timestamp: number;       // nowWallclock()

  // Type (discriminated union)
  type:
    | "spawn"               // Agent started
    | "turn_start"          // LLM turn began
    | "turn_end"            // LLM turn finished
    | "message_start"       // Message (user/assistant)
    | "message_end"
    | "tool_call"           // Tool invoked
    | "tool_result"         // Tool returned
    | "model_change"        // Model switched
    | "compact"             // Context compacted
    | "error"               // Error occurred
    | "done"                // Session done
    ;

  // Payload (type-specific)
  payload: Record<string, unknown>;

  // Causality
  parentId?: string;        // Parent event (causal chain)
  agentId?: string;         // Which agent produced this
}
```

## Projections (derived state)

```typescript
// Memory projection: extract facts from messages
function memoryProjection(events: AgentEvent[]): Fact[] {
  return events
    .filter(e => e.type === "message_end" && e.payload.role === "assistant")
    .flatMap(e => autoCapture(e.payload.content));
}

// Audit projection: hash-chain of tool calls
function auditProjection(events: AgentEvent[]): AuditRecord[] {
  return events
    .filter(e => e.type === "tool_call" || e.type === "tool_result")
    .map(e => ({ ts: e.timestamp, kind: "tool", ...e.payload }));
}

// Status projection: current session states
function statusProjection(events: AgentEvent[]): Map<string, string> {
  const states = new Map<string, string>();
  for (const e of events) {
    if (e.type === "turn_start") states.set(e.sessionId, "working");
    if (e.type === "turn_end") states.set(e.sessionId, "idle");
    if (e.type === "done") states.set(e.sessionId, "done");
  }
  return states;
}

// Cost projection: accumulate token usage
function costProjection(events: AgentEvent[]): Map<string, number> {
  const costs = new Map<string, number>();
  for (const e of events) {
    if (e.type === "message_end" && e.payload.usage) {
      const current = costs.get(e.sessionId) ?? 0;
      costs.set(e.sessionId, current + e.payload.usage.totalTokens);
    }
  }
  return costs;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Perfect audit trail (immutable) | ❌ Storage growth (accumulate events) |
| ✅ Time travel (replay from any point) | ❌ State is derived (projection cost) |
| ✅ Multiple views from same log | ❌ Schema evolution (old events must parse) |
| ✅ Natural debugging (replay) | ❌ Eventual consistency (projection lag) |
| ✅ Crash recovery (replay from checkpoint) | ❌ Agents must emit events (cooperation) |
| ✅ Merkle hash-chain = tamper-evident | |

## Khác File Watcher (Hướng F)

| | F: File Watcher | K: Event Stream |
|---|---|---|
| Direction | FROM agent (passive read) | FROM agent (active emit) |
| Agent cooperation | None (just writes logs) | Must emit events |
| Format | Agent's native log format | Standardized event schema |
| Real-time | ⚠️ (fs.watch delay) | ✅ (push events) |
| Multiple consumers | ❌ (each reads files independently) | ✅ (fan-out from log) |

## Khi nào chọn

- Muốn perfect audit + time travel
- OK với agents cooperating (emitting events)
- Multiple consumers need different views
- Need crash recovery (replay from checkpoint)
- Want tamper-evident log (Merkle)
