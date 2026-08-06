# Hướng MX: Event-Sourced Session Continuity — index mọi event FTS5, compact không mất data

> **Nguồn gốc:** Event sourcing; SQLite FTS5 full-text search; "compaction without data loss"; session resume/continuity; "time-travel state"; event log; pi-vcc (versioned context control)
> **Coupling:** 🟡 — thêm event log + FTS5 index vào session store
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (230 event-sourcing-outbox + 242 memory-rollback sẵn — chưa có FTS5 event index)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Event sourcing**: mọi thay đổi state được lưu thành **event bất biến** (append-only log) — state hiện tại = replay events. **Vấn đề context window**: để agent "nhớ" mọi việc đã làm, phải giữ toàn bộ history → tràn context. **Giải pháp**: **index mọi event** vào FTS5 (full-text search) — context window chỉ giữ **compact summary**, nhưng **bất kỳ event nào** (edit, git commit, decision, tool call) đều **tìm lại được** qua FTS5 query. Compact **không mất data** — data nằm trong event log, chỉ "ra khỏi context window". Nguyên tắc: **context window ≠ memory** — window là "RAM làm việc" (compact), memory là "ổ cứng" (event log + index, full). Khác **121 DQ long-context** (giữ nhiều trong window) — MX **đẩy ra ngoài window + index**; khác **230 HV event-sourcing-outbox** (reliable delivery) — MX **session memory + search**.

## Mô tả

mya event-sourced session continuity: mỗi hành động (file edit, git op, decision, tool call, user message) → **event bất biến** ghi vào SQLite event log + **FTS5 index**. Khi context window đầy → **compact** (summarize history cũ) nhưng **event log giữ nguyên**. Agent cần chi tiết cũ → **FTS5 search** ("hiển thị commit sửa auth.ts tuần trước") → trả event. Kết quả: agent có " trí nhớ vĩnh viễn" (event log) + "RAM gọn" (compact window). Nối 242 IH memory-rollback (replay event) — MX là **searchable continuity**.

## Kiến trúc

```
  MỌI HÀNH ĐỘNG trong session
   · file edit    · git commit   · tool call   · decision   · user msg
        │
        ▼
  ┌─── EVENT LOG (append-only, bất biến) ──────────────┐
  │  evt#1 { type:'edit', file:'auth.ts', diff:'...' } │
  │  evt#2 { type:'git',   msg:'fix login' }           │
  │  evt#3 { type:'decision', rationale:'...' }        │
  └──┬──────────────────────────────────────────────────┘
     │ index
     ▼
  ┌─── FTS5 INDEX (full-text, query nhanh) ─┐
  │  "auth" → evt#1, evt#2                   │
  │  "login" → evt#2                         │
  └─────────────────────────────────────────┘
        │
  CONTEXT WINDOW đầy?
        │
        ▼
  COMPACT (summarize history cũ trong window)
   · event log KHÔNG bị xóa (data an toàn)
   · window chỉ giữ summary + event pointer
        │
        ▼
  Agent cần chi tiết cũ?
   → FTS5 search → trả event nguyên bản
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 230 HV event-sourcing-outbox — event log (nền — MX thêm FTS5 index)
// ✅ 242 IH memory-rollback — replay event (nền)
// ✅ 182 FZ conversational-memory — history (nền)
// ✅ 264 JD temporal-knowledge — time-based memory (nền)

// ❌ THIẾU: FTS5 event index (full-text search over events)
// ❌ THIẾU: compaction policy (window đầy → summarize, giữ pointer)
// ❌ THIẾU: event search API (agent query event by keyword/time/type)
```

## Implementation

```typescript
// packages/agent/src/event-session.ts (NEW)
import { Database } from 'node:sqlite'; // Node 22 native or better-sqlite3

interface SessionEvent {
  id: number;
  type: 'edit' | 'git' | 'tool' | 'decision' | 'message';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

class EventSourcedSession {
  private db: Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT, content TEXT, metadata TEXT, timestamp INTEGER
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        content, type, content='events', content_rowid='id'
      );
    `);
  }

  append(e: Omit<SessionEvent, 'id'>): number {
    const tx = this.db.prepare(
      'INSERT INTO events (type, content, metadata, timestamp) VALUES (?,?,?,?)'
    );
    const r = tx.run(e.type, e.content, JSON.stringify(e.metadata), e.timestamp);
    this.db.prepare('INSERT INTO events_fts (rowid, content, type) VALUES (?,?,?)')
      .run(r.lastInsertRowid, e.content, e.type);
    return Number(r.lastInsertRowid);
  }

  // FTS5 search — agent tìm lại event cũ
  search(query: string, limit = 10): SessionEvent[] {
    return this.db.prepare(
      `SELECT e.* FROM events_fts f JOIN events e ON e.id = f.rowid
       WHERE events_fts MATCH ? ORDER BY rank LIMIT ?`
    ).all(query, limit) as SessionEvent[];
  }

  // Compact — trả summary pointer (data vẫn trong log)
  compact(upToId: number): string {
    const count = this.db.prepare('SELECT COUNT(*) c FROM events WHERE id <= ?')
      .get(upToId) as { c: number };
    return `[${count.c} events before #${upToId} — search to recall]`;
  }
}

// Usage:
// session.append({ type:'edit', content:'auth.ts: fix token refresh', metadata:{file:'auth.ts'}, timestamp: Date.now() });
// const found = session.search('auth token');  // → events
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Compact không mất data (event log bất biến) | ❌ Event log wächst vô hạn (cần retention) |
| ✅ Tìm lại bất kỳ event (FTS5 query nhanh) | ❌ SQLite dependency (FFI) |
| ✅ Session resume — replay events (242 IH) | ❌ Search không thay thế context (model phải query) |
| ✅ Nối 230 HV + 242 IH (event + rollback) | ❌ Indexing overhead mỗi event |

## Khác các hướng gần

| | 121 Long-Context Mgmt | 230 Event Sourcing Outbox | 242 Memory Rollback | MX: Event-Sourced Continuity |
|---|---|---|---|---|
| Cái gì | Giữ nhiều trong window | Reliable delivery | Replay undo | **Index mọi event + compact** |
| FTS5 search | ❌ | ❌ | ❌ | ✅ |
| Data loss | ❌ (giữ hết) | ❌ | ❌ | ✅ (compact nhưng event giữ) |
| Search recall | ❌ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Session dài (nhiều edit/git/decision) — context window không đủ
- Cần "không bao giờ mất" chi tiết đã làm (compact an toàn)
- Muốn agent tìm lại event cũ bằng keyword
- Kết hợp 230 HV (event log) + MX (FTS5 index + compact) + 242 IH (rollback/replay); design retention policy (purge event cũ)
