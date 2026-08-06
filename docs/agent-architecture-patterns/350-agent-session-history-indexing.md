# Hướng ML: Agent Session History Indexing — index transcript 30+ harness về SQLite, tìm kiếm có citation

> **Nguồn gốc:** ctx (index conversation transcript vào SQLite, query có citation); "conversation search"; "session transcript mining"; grep-as-context anti-pattern; SQLite FTS5; "token saving via indexed search"
> **Coupling:** 🟡 — thêm transcript indexer cạnh event stream
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (SQLite store + event-stream + ragfs sẵn — chưa có transcript FTS indexer)
> **Effort:** 2-3 tuần

## Nguồn gốc

**ctx**: index **toàn bộ transcript** (user message, agent action, tool result, decision) vào SQLite local với FTS5 (full-text search). Khi cần tra cứu — query index thay vì `grep` raw log. Tiết kiệm **~50x token**: grep trả cả file (~thousands tokens), query index trả chỉ đoạn liên quan (~tens tokens) + **citation** (đoạn nào, session nào, timestamp). Nguyên tắc: **transcript là kho dữ liệu có cấu trúc** — không thể `grep` hiệu quả vì dài + phi cấu trúc. Index → search → trả relevant snippet + provenance. Khác **12 event-stream** (append log) — ML **index + query** event stream; khác **362 event-sourced-session** (compact) — ML **search** chứ không compact.

## Mô tả

mya session history indexing: mỗi turn (user → agent → tool → result) → index vào SQLite FTS5 (nối sqlite-store.ts). Fields: session_id, timestamp, role, content, tool_name, action_type. Agent query: "lần cuối tôi chạy vitest?" → FTS5 trả snippet + citation ("session abc123, turn 42, 2026-08-05"); "gần đây tôi sửa gì trong graph.ts?" → search content. **~50x token saving** so với grep raw log. Nối 12 event-stream (source), 362 event-sourced-session (compact), ragfs (search interface). mya có sqlite-recall.ts + ragfs.ts — ML thêm **transcript-specific FTS5 index**.

## Kiến trúc

```
  AGENT LOOP (mỗi turn)
       │
       ▼
  ┌─── TRANSCRIPT INDEXER ─────────────────────┐
  │                                             │
  │  INSERT INTO transcript_fts                 │
  │  (session, turn, ts, role, content, tool)   │
  │  VALUES (...)                               │
  │                                             │
  │  FTS5 index — tokenize content              │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  ┌─── SESSION SEARCH ──────────────────────────┐
  │                                             │
  │  "lần cuối vitest fail?"                    │
  │  → SELECT snippet(transcript_fts)           │
  │    WHERE transcript_fts MATCH 'vitest fail' │
  │    ORDER BY ts DESC LIMIT 5                 │
  │                                             │
  │  RETURN: snippet + citation (session/turn)  │
  │  ~50 tokens (vs ~2500 grep raw log)         │
  └─────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/sqlite-store.ts — SQLite backend (nền storage)
// ✅ packages/memory/src/sqlite-recall.ts — FTS5 recall (memory, chưa có transcript)
// ✅ packages/memory/src/ragfs.ts — search interface (nền)
// ✅ 12 event-stream — append events (source cho indexer)
// ✅ packages/core — event types (turn, action, tool result)

// ❌ THIẾU: transcript FTS5 table (session/turn/ts/role/content/tool)
// ❌ THIẾU: transcript indexer (agent loop → INSERT per turn)
// ❌ THIẾU: session search with citation (snippet + session/turn provenance)
// ❌ THIẾU: cross-session query (tìm qua nhiều session cũ)
```

## Implementation

```typescript
// packages/memory/src/transcript-index.ts (NEW)
import type { SqliteDatabase } from "./sqlite-db.js";

interface TranscriptRow {
  session: string; turn: number; ts: number;
  role: string; content: string; tool?: string;
}

class TranscriptIndex {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
        session, turn, ts, role, content, tool,
        tokenize = 'unicode61'
      );
    `);
  }

  index(row: TranscriptRow): void {
    this.db.run(
      `INSERT INTO transcript_fts (session, turn, ts, role, content, tool)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.session, row.turn, row.ts, row.role, row.content, row.tool ?? ''],
    );
  }

  // Search transcript — return snippets with citation
  search(query: string, opts: { limit?: number; session?: string } = {}): SearchResult[] {
    const limit = opts.limit ?? 5;
    const sessionFilter = opts.session ? `AND session = '${opts.session}'` : '';
    const rows = this.db.all<{ session: string; turn: number; ts: number; snippet: string }>(`
      SELECT session, turn, ts, snippet(transcript_fts, 4, '<<', '>>', '…') as snippet
      FROM transcript_fts WHERE transcript_fts MATCH ? ${sessionFilter}
      ORDER BY ts DESC LIMIT ?`,
      [query, limit]);
    return rows.map(r => ({
      citation: { session: r.session, turn: r.turn, timestamp: r.ts },
      snippet: r.snippet,  // ~50 tokens vs ~2500 raw
    }));
  }
}

interface SearchResult { citation: { session: string; turn: number; timestamp: number }; snippet: string; }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ ~50x token saving (snippet vs grep raw log) (ctx) | ❌ Index storage overhead (SQLite size) |
| ✅ Citation (session/turn/timestamp — truy ngược được) | ❌ Index lag (async insert) |
| ✅ Cross-session search (tra cứu nhiều phiên cũ) | ❌ FTS5 tokenize (CJK cần custom tokenizer) |
| ✅ Nối event-stream (index tự nhiên) | ❌ Old sessions accumulation (retention policy) |

## Khác các hướng gần

| | 12 Event Stream | 362 Event-Sourced Session | 350 ML: Transcript Index |
|---|---|---|---|
| Cái gì | Append log | Compact continuity | **FTS5 search + citation** |
| Query | ❌ (chỉ append) | ❌ (compact) | **✅ MATCH search** |
| Token | Raw (nhiều) | Reduced | **~50x savings** |

## Khi nào chọn

- Nhiều session dài — cần tra cứu "lần cuối X xảy ra"
- grep raw log tốn token (mỗi search ~thousands tokens)
- Muốn cross-session continuity (hỏi về session cũ)
- Kết hợp 12 event-stream (source) + 362 event-sourced (compact) + sqlite-store (storage) + ragfs (search)
