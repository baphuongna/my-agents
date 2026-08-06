# Hướng JC: Collaborative Sessions — nhiều user chia sẻ phiên agent realtime

> **Nguồn gốc:** Google Docs / Figma realtime collaboration; CRDT (Yjs/Automerge); "Multi-User Shared State"; OT (Operational Transform); Liveblocks; collaborative editing research
> **Coupling:** 🔴 — chạm session state + transport + conflict resolution
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (single-session sẵn — thiếu CRDT merge + presence)
> **Effort:** 4-6 tuần

## Nguồn gốc

Collaborative sessions: **nhiều user cùng xem/sửa 1 phiên agent** — như Google Docs realtime. CRDT (Yjs, Automerge): Conflict-free Replicated Data Type — mỗi user có local copy, edits merge tự động không xung đột. Operational Transform (OT): Google Docs/Jupiter — transform concurrent edits để converge. Liveblocks: realtime presence + shared state. Thách thức: (1) **concurrent edit** — 2 user sửa cùng input; (2) **presence** — ai đang gõ/đang nhìn gì; (3) **agent output stream** — multiple viewers nhận cùng stream; (4) **permission** — ai được edit vs read-only. CRDT > OT: không cần central server transform, offline-friendly (IT 254).

## Mô tả

mya collaborative: phiên agent (chat history, tool output) chia sẻ realtime. User A gõ input → User B thấy ngay (presence). Agent output stream tới tất cả viewer. Khi 2 user sửa cùng prompt → CRDT merge (Automerge). Permission: owner / editor / viewer. Nối HU (229) distributed-lock: khi edit file (destructive) → lock tránh conflict. Nối IT (254) offline-first: user offline vẫn edit local, merge khi reconnect. Nối HV (230) event-sourcing: shared state = event log, replay per user.

## Kiến trúc

```
  ┌──────────┐       ┌──────────┐       ┌──────────┐
  │ USER A   │       │ USER B   │       │ USER C   │
  │ (editor) │       │ (editor) │       │ (viewer) │
  │ gõ: "fix"│       │ gõ: "ref"│       │ watching │
  └────┬─────┘       └────┬─────┘       └────┬─────┘
       │ edit event        │ edit event        │ subscribe
       ▼                   ▼                   ▼
  ┌──────────────────────────────────────────────────────┐
  │  COLLAB SESSION BROKER                               │
  │  PRESENCE: A typing... B typing... C viewing         │
  │  CRDT DOC (Automerge):                               │
  │    merge A's "fix" + B's "ref" → "fix ref"           │
  │    (conflict-free — no central transform)            │
  │  AGENT OUTPUT STREAM:                                │
  │    broadcast → all viewers (fan-out)                 │
  │  PERMISSION: A,B edit | C read-only                  │
  └──────────────────────────────────────────────────────┘
                     ▼  AGENT (shared session)
```

```
mya: single-session + transport sẵn — thiếu: CRDT doc + presence + multi-user fan-out + permission
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session JSONL — chat history (sẵn — single user)
// ✅ transport layer — streaming (sẵn)
// ✅ HV (230) event-sourcing — event log (documented)
// ✅ HU (229) distributed-locking — file edit lock (documented)
// ✅ IT (254) offline-first — local queue (documented)

// ❌ THIẾU: CRDT shared doc (Automerge/Yjs)
// ❌ THIẾU: presence (who's online/typing)
// ❌ THIẾU: multi-user fan-out (broadcast agent stream)
// ❌ THIẾU: session permission (owner/editor/viewer)
```

## Implementation

```typescript
// packages/session/src/collaborative.ts (NEW)
import { Doc, change } from "@automerge/automerge";

interface CollabSession {
  doc: Doc<{ prompt: string; history: ChatMsg[] }>;
  presence: Map<string, UserState>;
  permission: Map<string, "owner" | "editor" | "viewer">;
}

export class CollabBroker {
  private sessions = new Map<string, CollabSession>();

  join(sessionId: string, userId: string, role: "editor" | "viewer"): CollabSession {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { doc: Doc.init(), presence: new Map(), permission: new Map() };
      this.sessions.set(sessionId, s);
    }
    s.permission.set(userId, role);
    s.presence.set(userId, { online: true, typing: false });
    return s;
  }

  // CRDT merge — conflict-free, no central transform
  applyEdit(sessionId: string, userId: string, patch: (d: { prompt: string }) => void): void {
    const s = this.sessions.get(sessionId)!;
    if (s.permission.get(userId) === "viewer") throw new Error("read-only");
    s.doc = change(s.doc, (d) => patch(d)); // Automerge CRDT
    this.broadcast(sessionId, "sync", s.doc); // fan-out to all
  }

  // Agent output → all viewers
  broadcastAgent(sessionId: string, msg: ChatMsg): void {
    this.broadcast(sessionId, "agent-msg", msg);
  }

  private broadcast(sessionId: string, type: string, payload: unknown): void {
    const s = this.sessions.get(sessionId)!;
    for (const [uid] of s.presence) {
      if (s.presence.get(uid)?.online) this.send(uid, type, payload);
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhiều user cùng xem/sửa (Google Docs/Figma) | ❌ CRDT complexity (Automerge learning curve) |
| ✅ Conflict-free merge (no OT central server) | ❌ Bandwidth (fan-out to all viewers) |
| ✅ Presence — biết ai đang làm gì | ❌ Permission model (owner/editor/viewer) |
| ✅ Offline-friendly (CRDT — merge on reconnect IT 254) | ❌ Latency for remote users |

## Khác các hướng gần

| | Single Session | IT (254) Offline | JC: Collaborative |
|---|---|---|---|
| User | 1 | 1 (offline) | **N (realtime shared)** |
| Merge | N/A | LWW/conflict | **CRDT (conflict-free)** |
| Presence | ❌ | ❌ | ✅ |

## Khi nào chọn

- Team review agent output cùng lúc (pair programming 115)
- Multiple operator điều phối agent
- Cần realtime collaboration (Google Docs pattern)
- Nối IT (254) offline + HU (229) lock + HV (230) event-store
