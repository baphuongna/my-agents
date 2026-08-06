# Hướng RO: Session-Resume Category Snapshot — PreCompact phân loại event thành snapshot XML <2KB kèm query hint

> **Nguồn gốc:** context-mode (mksglu); PreCompact hook `buildResumeSnapshot`; "group events by category"; `<session_resume>` XML; "runnable search tool call containing exact queries"; "how_to_search instruction block"; snapshot stored then injected post-compact
> **Coupling:** 🟢 — PreCompact hook đọc session events → emit snapshot (không can thiệp core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session event tracking + compaction sẵn — chưa có category-snapshot XML + query-hint injection)
> **Effort:** 2-3 tuần

## Nguồn gốc

**context-mode** giải quyết vấn đề **mất trí sau compact**: khi agent compact hội thoại, nó quên file đang sửa, task đang làm, lỗi vừa gặp. Giải pháp: **PreCompact hook** — chạy *ngay trước* khi compact. Hook đọc **tất cả event đã capture** (file edit, task, error, decision, git, env...), **phân loại theo category**, và build một **resume snapshot XML** chứa: (1) mỗi category = section tóm tắt; (2) mỗi section kèm **`ctx_search` query hint chính xác** ("chạy tool call này để xem chi tiết đầy đủ"); (3) instruction `how_to_search` (đừng hỏi user lại, search trước). Snapshot lưu DB, **inject lại vào context sau compact** → agent "nhớ" việc đang làm mà không dump toàn bộ raw event. Nguyên tắc: **compact không phải quên — là tóm tắt tham chiếu** (snapshot nhỏ trỏ về store đầy đủ qua query). Khác **425 PI session-branch-tree** (tái dựng cây nhánh) — RO **tóm tắt category cho resume**; khác **462 QN micro-compaction** (nén per-turn) — RO **snapshot one-shot trước compact toàn session**.

## Mô tả

mya session-resume category snapshot: (1) **PreCompact trigger**: hook chạy trước mỗi compaction. (2) **Read all events**: lấy toàn bộ event session (file/task/error/decision/git/env/subagent/intent/goal). (3) **Group by category**: gom event theo 14 category. (4) **Build snapshot XML**: `<session_resume>` → section mỗi category (files touched, errors gặp, decisions chốt...) + **query hint** (`ctx_search "error" --label error`) trỏ về store đầy đủ + `how_to_search` block. (5) **Store snapshot**: lưu DB (session_resume), đánh dấu unconsumed. (6) **Inject post-compact**: turn sau compact → claim snapshot unconsumed → inject vào context → đánh dấu consumed. mya có compaction + session events — RO thêm **category-snapshot builder** + **query-hint injection**.

## Kiến trúc

```
  SESSION EVENTS (capture dần: file/task/error/decision/git/env/...)
        │
        ▼
  ┌─── PreCompact HOOK (chạy trước compact) ───────────────┐
  │  events = db.getEvents(sessionId)                       │
  │  group by category:                                     │
  │    file → [auth.ts, parser.rs, ...]                     │
  │    error → [ImportError, KeyError, ...]                 │
  │    decision → [dùng sync, bỏ retry, ...]                │
  │    git → [commit abc, branch fix-x, ...]                │
  │  buildResumeSnapshot(events):                           │
  │    mỗi section = tóm tắt + query hint chính xác         │
  │    <session_resume>                                     │
  │      <how_to_search> search trước, đừng hỏi user </...> │
  │      <files> auth.ts, parser.rs                         │
  │        → ctx_search "auth.ts" </files>                  │
  │      <errors> ImportError → ctx_search label:error      │
  │      <decisions> dùng sync → ctx_search "decision"      │
  │    </session_resume>                                    │
  │  db.upsertResume(sessionId, snapshot)  // <2KB          │
  └──────────────────────────┬─────────────────────────────┘
                             ▼
  ┌─── COMPACT (xóa raw history khỏi context) ──────────────┐
  └──────────────────────────┬─────────────────────────────┘
                             ▼
  ┌─── POST-COMPACT INJECT ─────────────────────────────────┐
  │  snapshot = db.claimUnconsumed(sessionId)                │
  │  inject <session_resume> vào context (thay raw history)  │
  │  mark consumed                                           │
  │  → agent biết file đang sửa, lỗi gặp, quyết định chốt    │
  │    (query hint → load chi tiết khi cần)                  │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ compaction (packages/ai) — context compression (nền — RO = snapshot trước compact)
// ✅ session event tracking — capture event (nền — RO = group + tóm tắt)
// ✅ 425 PI session-branch-tree — tái dựng cây nhánh (đối chiếu — RO = category snapshot)
// ✅ 462 QN micro-compaction — per-turn rolling (đối chiếu — RO = one-shot trước compact)

// ❌ THIẾU: PreCompact hook (chạy trước compact, đọc events, build snapshot)
// ❌ THIẾU: buildResumeSnapshot (group by category + section + query hint XML)
// ❌ THIẾU: how_to_search instruction (search trước, đừng hỏi user lại)
// ❌ THIẾU: claim-unconsumed / mark-consumed (inject 1 lần post-compact)
```

## Implementation

```typescript
// packages/agent/src/session-resume-snapshot.ts (MỚI)
interface StoredEvent { id: string; category: string; data: string; priority: number; }

const CATEGORIES = ["file","task","error","decision","git","env","subagent","intent","goal"] as const;

function buildResumeSnapshot(events: StoredEvent[], searchTool: string, compactCount = 1): string {
  const byCat = new Map<string, StoredEvent[]>();
  for (const e of events) {
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category)!.push(e);
  }
  const sections: string[] = [];
  sections.push(`  <how_to_search>\n  Mỗi section tóm tắt việc trước đây. Chi tiết đầy đủ: chạy ctx_search dưới mỗi section. Đừng hỏi user lại — search trước.\n  </how_to_search>`);

  for (const cat of CATEGORIES) {
    const evs = byCat.get(cat);
    if (!evs?.length) continue;
    const summary = evs.map(e => e.data).slice(0, 5).join(", ");   // tóm tắt ≤5 item
    const query = evs.map(e => `"${e.data.slice(0, 30)}"`).join(" ");
    sections.push(`  <${cat}s count="${evs.length}">\n    ${summary}\n    → ${searchTool} ${query}\n  </${cat}s>`);
  }

  const now = new Date().toISOString();
  return `<session_resume events="${events.length}" compact_count="${compactCount}" generated_at="${now}">\n\n${sections.join("\n\n")}\n\n</session_resume>`;
}

interface SnapshotStore {
  upsert(sessionId: string, snapshot: string, eventCount: number): void;
  claimUnconsumed(sessionId: string): string | null;   // inject 1 lần
  markConsumed(sessionId: string): void;
}

// PreCompact hook: chạy trước compact
function onPreCompact(db: SnapshotStore, sessionId: string, events: StoredEvent[]): void {
  const stats = { compactCount: 1 };                       // đọc từ db
  const snapshot = buildResumeSnapshot(events, "ctx_search", stats.compactCount + 1);
  db.upsert(sessionId, snapshot, events.length);
}

// Post-compact: inject snapshot vào context
function onPostCompactInject(db: SnapshotStore, sessionId: string): string | null {
  const snap = db.claimUnconsumed(sessionId);
  if (snap) db.markConsumed(sessionId);                    // tránh inject 2 lần
  return snap;
}

// Usage:
// onPreCompact(db, "sess-1", events);              // trước compact → build snapshot
// const snap = onPostCompactInject(db, "sess-1");  // sau compact → inject
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent nhớ việc sau compact (file/task/error/decision) | ❌ Snapshot phải nhỏ (≤2KB — tóm tắt, không raw) |
| ✅ Query hint trỏ về store đầy đủ (load khi cần) | ❌ Phải capture event chất lượng (snapshot phụ thuộc event) |
| ✅ how_to_search giảm hỏi user lại | ❌ PreCompact phải crash-resilient (không chặn compact khi lỗi) |
| ✅ Category rõ ràng (agent biết nhóm việc) | ❌ Stale nếu event cũ sai (cần verify như 482 RN) |

## Khác các hướng gần

| | 425 Session-Branch-Tree | 462 Micro-Compaction | RO: Category-Snapshot |
|---|---|---|---|
| Cái gì | Tái dựng cây nhánh | Nén per-turn rolling | **Snapshot category trước compact** |
| Khi | Resume session | Mỗi turn | **Trước compact toàn session** |
| Đầu ra | Cây nhánh active | Context nén | **XML snapshot + query hint** |

## Khi nào chọn

- Agent hay mất trí sau compact (quên file/task/error đang làm)
- Muốn compact mà vẫn "nhớ" việc đang dở (không hỏi user lại)
- Cần query hint trỏ về store đầy đủ (snapshot nhỏ, detail load khi cần)
- Nối compaction (RO = PreCompact hook + snapshot) + session events (RO = group category); guard crash-resilience (PreCompact lỗi → vẫn compact, không block) + snapshot size (≤2KB, tóm tắt) + claim-consumed (inject đúng 1 lần post-compact) + event quality (snapshot phụ thuộc capture chính xác)
