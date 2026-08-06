# Hướng IT: Offline-First — queue tác vụ, sync khi có mạng

> **Nguồn gốc:** "Offline-First" (PWA / Hood); CouchDB/PouchDB sync; Linear offline queue; Notion offline cache; "The Offline-First Manifesto"; IndexedDB outbox
> **Coupling:** 🟡 — chạm transport + task queue
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (task queue + retry sẵn — thiếu sync engine + conflict resolution)
> **Effort:** 3-4 tuần

## Nguồn gốc

Offline-first (PWA manifesto, CouchDB): app hoạt động đầy đủ **không cần mạng** — ghi local trước, sync khi có mạng. CouchDB/PouchDB: local DB replicate → conflict resolution (deterministic merge). Linear: "works offline — your actions queue locally, sync when reconnected." Notion: offline cache — edits buffer, push on reconnect. Outbox pattern (Hướng HV 230): ghi vào outbox table local → async publish khi mạng. Cốt lõi: **local-first write** (không block user đợi network), **eventual sync** (reconcile khi online), **conflict resolution** (last-write-wins / CRDT / deterministic merge).

## Mô tả

mya offline-first: khi mất kết nối LLM API / MCP server, agent vẫn nhận task → queue local (SQLite outbox). Khi mạng trở lại → drain queue, gửi đã hoãn. Conflict: nếu 2 agent offline-edit cùng file → merge strategy (3-way diff / last-write-wins với timestamp). Nối HW (231) DLQ: task sync fail quá nhiều → DLQ. Nối HV (230) outbox: local outbox = sync buffer. Edge case: token-budget tracked offline, reconcile khi online.

## Kiến trúc

```
  ┌──────────────────────────────────────────────────────────┐
  │  AGENT (offline or online)                               │
  │                                                          │
  │  task arrives ──► LOCAL QUEUE (SQLite outbox — HV 230)   │
  │                       │                                  │
  │            ┌──────────┴──────────┐                       │
  │            ▼                     ▼                       │
  │     ┌────────────┐        ┌─────────────┐                │
  │     │ ONLINE?    │        │ OFFLINE     │                │
  │     │ send now   │        │ buffer      │                │
  │     └────────────┘        └──────┬──────┘                │
  │                                   │ wait                 │
  │  ─ ─ ─ ─ mạng trở lại ─ ─ ─ ─ ─ ─ ┘                      │
  │                                   │                      │
  │                            ┌──────▼───────┐               │
  │                            │ SYNC ENGINE  │               │
  │                            │ drain queue  │               │
  │                            │ send batched │               │
  │                            └──────┬───────┘               │
  │                                   │ fail x3               │
  │                                   ▼                       │
  │                            ┌──────────────┐               │
  │                            │ DLQ (HW 231) │               │
  │                            └──────────────┘               │
  │                                                          │
  │  CONFLICT: 2 agents edit same file offline               │
  │     → 3-way merge / LWW / CRDT                           │
  └──────────────────────────────────────────────────────────┘
```

```
mya: SQLite queue + retry sẵn — thiếu: sync engine + conflict resolution + online/offline detection
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ kanban-sqlite — local task queue (sẵn)
// ✅ 203 retry-loops — retry on failure (sẵn)
// ✅ HW (231) dead-letter-queue — quarantine fail (documented)
// ✅ HV (230) outbox — atomic local write (documented)

// ❌ THIẾU: network status detection (online/offline event)
// ❌ THIẾU: sync engine (drain buffer on reconnect)
// ❌ THIẾU: conflict resolution (3-way merge / LWW / CRDT)
// ❌ THIẾU: idempotency keys (replay-safe — không double-apply)
```

## Implementation

```typescript
// packages/sync/src/offline-queue.ts (NEW)
interface QueuedOp {
  id: string;          // idempotency key — replay-safe
  type: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
}

export class OfflineQueue {
  constructor(private db: Database, private transport: Transport) {}

  // Always enqueue locally first (don't block on network)
  async enqueue(op: Omit<QueuedOp, "id" | "createdAt" | "attempts">): Promise<void> {
    this.db.prepare("INSERT INTO outbox (id,type,payload,createdAt,attempts) VALUES (?,?,?,?,0)")
      .run(crypto.randomUUID(), op.type, JSON.stringify(op.payload), Date.now());
    if (this.isOnline()) void this.drain(); // fire-and-forget if online
  }

  // On reconnect — drain buffer
  async drain(): Promise<void> {
    const pending = this.db.prepare("SELECT * FROM outbox ORDER BY createdAt").all() as QueuedOp[];
    for (const op of pending) {
      try {
        await this.transport.send(op.type, op.payload, op.id); // idempotent
        this.db.prepare("DELETE FROM outbox WHERE id=?").run(op.id);
      } catch (e) {
        this.bump(op.id);
        if (op.attempts >= 3) await this.toDlq(op, e); // HW 231
      }
    }
  }

  private isOnline(): boolean { return navigator?.onLine ?? true; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent không block khi mất mạng (CouchDB/Linear) | ❌ Conflict resolution complexity |
| ✅ User continue working offline (Notion) | ❌ Eventual consistency (sync lag) |
| ✅ Sync tự động khi reconnect | ❌ Idempotency keys cần thiết (replay-safe) |
| ✅ Nối HV (230) outbox + HW (231) DLQ | ❌ Storage growth (buffer chưa drain) |

## Khác các hướng gần

| | 203 Retry Loops | HV (230) Outbox | IT: Offline-First |
|---|---|---|---|
| Khi fail | Retry ngay | Async publish | **Queue khi offline, drain khi online** |
| Mạng | Assume online | Assume online | **Handle offline explicitly** |
| Conflict | N/A | N/A | ✅ merge |

## Khi nào chọn

- Agent chạy edge / môi trường mạng không ổn định
- User muốn continue khi mất API / MCP server
- Cần queue + sync (CouchDB / Linear pattern)
- OK với eventual consistency + conflict resolution
