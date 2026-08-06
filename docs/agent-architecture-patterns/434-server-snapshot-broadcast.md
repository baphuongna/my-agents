# Hướng PR: Server Snapshot Broadcast — session_snapshot xếp hàng broadcast tới mọi connection + revision

> **Nguồn gốc:** pi (gateway/server snapshot broadcast, multi-connection WebSocket); pi-session-manager (browser-dataset cache revision, DATASET_REVISION, BROWSER_DATASET_REFRESHED_EVENT); "snapshot broadcast"; "multi-connection sync"; "revision tracking"; "queued broadcast"
> **Coupling:** 🟡 — thêm snapshot broadcast + revision tracking vào gateway/server layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (gateway multi-connection + event broadcast sẵn — chưa có session_snapshot queue + revision trong mya)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**pi** gateway server duy trì **multi-connection WebSocket** — nhiều client connect (TUI, web, desktop) cùng xem 1 session. Khi session thay đổi → **broadcast snapshot** tới mọi connection. `pi-session-manager/browser-dataset/core.ts` dùng `DATASET_REVISION = "main-v2"` — version tag cho cache invalidation. `BROWSER_DATASET_REFRESHED_EVENT` — event broadcast khi dataset cache refresh → mọi listener update. Nguyên tắc **queued broadcast**: (1) Session thay đổi → **snapshot** (toàn bộ state: messages, tools, status). (2) **Queue** snapshot vào broadcast queue. (3) **Broadcast** tới mọi active connection (WebSocket send). (4) **Revision bump**: mỗi snapshot có `revision` number (monotonic increment) — connection check revision để biết có update hay không (skip nếu đã có revision cao hơn). (5) **Connection lifecycle**: connection join → send latest snapshot (catch up); disconnect → remove from broadcast list. Khác **393 dual-channel** (2 kênh) — PR là **1 snapshot → N connections**.

## Mô tả

mya server snapshot broadcast: session thay đổi → **broadcast snapshot tới mọi connection** — (1) **Snapshot**: serialize session state (messages, tool calls, status, tokens) thành `session_snapshot`. (2) **Revision bump**: mỗi snapshot có revision (monotonic — 1, 2, 3, …). (3) **Queue + broadcast**: snapshot vào queue → broadcast tới mọi active connection (WebSocket). (4) **Revision check**: connection nhận snapshot → check revision > last seen → apply (skip if stale). (5) **Catch up**: new connection join → send latest snapshot (revision). Mọi connection **đồng bộ** — thấy cùng state, cùng revision. mya có gateway/server — PR thêm **session_snapshot queue + revision tracking + multi-connection broadcast**.

## Kiến trúc

```
  SESSION CHANGES (new message / tool result / status)
        │
        ▼
  ┌─── SNAPSHOT ──────────────────────────────────────────┐
  │  serialize session state:                               │
  │  {                                                      │
  │    sessionId: "s1",                                     │
  │    revision: 42,          ← monotonic increment         │
  │    messages: [...],       ← current conversation         │
  │    toolCalls: [...],      ← active tool calls            │
  │    status: "thinking",    ← lifecycle status             │
  │    tokens: { ... },       ← usage stats                  │
  │    timestamp: "..."                                     │
  │  }                                                      │
  └───────────────────────┬────────────────────────────────┘
                          │
                          ▼
  ┌─── QUEUE + BROADCAST ─────────────────────────────────┐
  │                                                         │
  │  broadcast queue: [snapshot@rev42]                      │
  │                                                         │
  │  active connections:                                    │
  │    ┌──────────┐  ┌──────────┐  ┌──────────┐            │
  │    │ TUI (ws1)│  │ Web (ws2)│  │Desktop(3)│            │
  │    │ rev: 41  │  │ rev: 42  │  │ rev: 40  │            │
  │    └────┬─────┘  └────┬─────┘  └────┬─────┘            │
  │         │             │             │                   │
  │    send snapshot  skip (already  send snapshot           │
  │    rev42 > 41     has rev42)    rev42 > 40               │
  │                                                         │
  │  NEW CONNECTION join:                                   │
  │    → send latest snapshot (rev42) — catch up            │
  │                                                         │
  └─────────────────────────────────────────────────────────┘

  REVISION CHECK:
    ws1 receives rev42, last seen rev41 → APPLY (42 > 41)
    ws2 receives rev42, last seen rev42 → SKIP (42 == 42, already has)
    ws3 receives rev42, last seen rev40 → APPLY (42 > 40)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ gateway / server (packages/gateway) — multi-connection WebSocket (nền — PR = snapshot broadcast)
// ✅ 393 dual-channel — 2 kênh communication (nền — PR = 1 snapshot → N connections)
// ✅ packages/rpc — RPC transport (nền — PR = broadcast variant)

// ❌ THIẾU: session_snapshot serialization (full state → snapshot)
// ❌ THIẘU: revision tracking (monotonic increment per change)
// ❌ THIẾU: queued broadcast (queue + fan-out to all connections)
// ❌ THIẾU: revision check (skip stale snapshots)
// ❌ THIẾU: catch-up (new connection → latest snapshot)
```

## Implementation

```typescript
// packages/agent/src/snapshot-broadcast.ts (MỚI)
interface SessionSnapshot {
  sessionId: string;
  revision: number;          // monotonic increment
  messages: unknown[];       // current conversation
  toolCalls: unknown[];      // active tool calls
  status: string;            // lifecycle status
  tokens: { input: number; output: number; cacheRead: number };
  timestamp: string;
}

interface Connection {
  id: string;
  send: (data: unknown) => void;
  lastRevision: number;
}

class SnapshotBroadcaster {
  private connections = new Map<string, Connection>();
  private currentRevision = 0;
  private broadcastQueue: SessionSnapshot[] = [];
  private broadcasting = false;

  // Register a new connection (sends latest snapshot for catch-up)
  register(connId: string, send: (data: unknown) => void, latestSnapshot?: SessionSnapshot): void {
    this.connections.set(connId, { id: connId, send, lastRevision: 0 });
    if (latestSnapshot) {
      this.connections.get(connId)!.send(latestSnapshot);
      this.connections.get(connId)!.lastRevision = latestSnapshot.revision;
    }
  }

  unregister(connId: string): void {
    this.connections.delete(connId);
  }

  // Snapshot changed session → queue + broadcast
  snapshotChanged(snapshot: Omit<SessionSnapshot, 'revision'>): void {
    this.currentRevision++;
    const full: SessionSnapshot = { ...snapshot, revision: this.currentRevision };
    this.broadcastQueue.push(full);
    this.flushQueue();
  }

  // Flush broadcast queue → fan-out to all connections
  private flushQueue(): void {
    if (this.broadcasting || this.broadcastQueue.length === 0) return;
    this.broadcasting = true;
    while (this.broadcastQueue.length > 0) {
      const snapshot = this.broadcastQueue.shift()!;
      for (const conn of this.connections.values()) {
        // Revision check: skip if connection already has this revision or higher
        if (snapshot.revision <= conn.lastRevision) continue;
        conn.send(snapshot);
        conn.lastRevision = snapshot.revision;
      }
    }
    this.broadcasting = false;
  }

  // Get latest snapshot (for new connection catch-up)
  getLatest(): SessionSnapshot | undefined {
    // Return most recent snapshot (highest revision)
    return this.broadcastQueue.at(-1);
  }
}

// Usage:
// broadcaster.register("ws1", (data) => ws.send(JSON.stringify(data)), latestSnapshot);
// broadcaster.snapshotChanged({ sessionId: "s1", messages: [...], ... });
// → broadcasts to all connections (with revision check)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Multi-connection sync (TUI + Web + Desktop — cùng state) | ❌ Broadcast overhead (N connections × snapshot size) |
| ✅ Revision tracking (monotonic — biết stale hay không) | ❌ Queue memory (snapshots queue nếu broadcast chậm) |
| ✅ Catch-up (new connection → latest snapshot ngay) | ❌ Serialization cost (full state → JSON mỗi change) |
| ✅ Skip stale (revision check — không apply cũ) | ❌ Connection lifecycle (disconnect detection + cleanup) |

## Khác các hướng gần

| | 393 Dual-Channel | PR: Snapshot-Broadcast |
|---|---|---|
| Cái gì | 2 kênh communication | **1 snapshot → N connections** |
| Fan-out | ❌ (point-to-point) | ✅ (broadcast) |
| Revision | ❌ | ✅ monotonic tracking |
| Catch-up | ❌ | ✅ new connection gets latest |

## Khi nào chọn

- Multi-connection (TUI + Web + Desktop cùng xem 1 session)
- Muốn sync real-time (session change → mọi connection update)
- Muốn revision tracking (skip stale, monotonic)
- Nối 393 dual-channel (PR = broadcast on top of channel) + gateway (PR = snapshot fan-out); guard broadcast overhead (large snapshot × N connections → bandwidth)
