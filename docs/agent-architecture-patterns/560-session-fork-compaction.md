# Hướng UN: Session Fork-Compaction — Session JSON checkpoint + SessionFork (branching), compaction record, heartbeat/liveness, prompt entries reload

> **Nguồn gốc:** claw-code `session/` (`session.json`, `SessionFork`, compaction record, `heartbeat`/liveness, prompt entries); "checkpoint per turn"; "fork session = branch conversation tree"; "compaction summarize + keep summary record"; "reload prompt entries on resume" | **Coupling:** 🟡 — thêm session-checkpoint format + fork/compaction vào session store | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session persist/restore sẵn — chưa có fork-branching + compaction record + heartbeat) | **Effort:** 4-5 tuần

## Nguồn gốc

**claw-code** lưu session dưới dạng **JSON checkpoint**: mỗi turn ghi entry (prompt, tool calls, response) vào `session.json`. Khi user muốn **thử hướng khác** mà không mất lịch sử → **SessionFork** (branching): fork session hiện tại thành branch mới (giống git branch — history chia nhánh, mỗi branch tiến độc lập). Khi context **phình quá** → **compaction**: summarize lịch sử cũ thành 1 record ngắn, **giữ compaction record** (audit được — biết đã compact gì). **Heartbeat/liveness**: session ghi nhịp sống (timestamp định kỳ) để phát hiện session treo/crash. **Prompt entries reload**: khi resume, nạp lại prompt entries đầy đủ (không chỉ summary). Nguyên tắc: **session = checkpoint tree có thể fork + compact + audit**.

## Mô tả

mya session fork-compaction: (1) **Checkpoint**: mỗi turn → entry (prompt, tools, response) append vào session JSON. (2) **Fork**: tạo branch từ checkpoint — history chia nhánh, 2 branch tiến độc lập (không mất gốc). (3) **Compaction**: khi context phình → summarize entries cũ thành 1 record (giữ compaction record để audit). (4) **Heartbeat**: ghi timestamp định kỳ → phát hiện treo/crash (stale = chết). (5) **Reload**: resume → nạp đầy đủ prompt entries (không chỉ summary). mya có session persist/restore — UN thêm **fork-branching** + **compaction record** + **heartbeat/liveness**.

## Kiến trúc

```
  SESSION TREE (checkpoint per turn, có thể fork)
       t0: "viết parser"
       │
       t1: tool: read lexer.rs
       │
       ├── FORK A ──────────────┐
       │  t2A: "dùng Pratt"      │  (branch độc lập)
       │  t3A: response A        │
       │  ✗ context phình        │
       │  → COMPACTION: summarize t0-t3A → record C
       │  t4A: continue (ctx gọn)│
       │                         │
       └── FORK B ───────────────┘
          t2B: "dùng recursive descent"
          t3B: response B

  COMPACTION RECORD (audit): { range: t0-t3A, summary: "...", kept: [t2A] }

  HEARTBEAT: session.json ghi ts mỗi 10s
    → stale (no update > 60s) = treo/crash → flag liveness
  RELOAD: resume → nạp đầy đủ prompt entries (từ checkpoint)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent session persist/restore — save/resume (nền — UN checkpoint)
// ✅ 73 durable-execution — bền vững (nền — UN heartbeat)
// ✅ 121 long-context-management — context handling (nền — UN compaction)

// ❌ THIẾU: session fork (branch conversation tree)
// ❌ THIẾU: compaction record (summarize + keep audit record)
// ❌ THIẾU: heartbeat/liveness (stale detection)
// ❌ THIẾU: prompt-entries reload (nạp đầy đủ khi resume)
```

## Implementation

```typescript
// packages/agent/src/session-fork-compaction.ts (MỚI)
interface SessionEntry { id: string; parentId: string | null; ts: number; prompt?: string; tools?: unknown[]; response?: string }
interface CompactionRecord { id: string; range: [string, string]; summary: string; kept: string[] }
interface Session {
  id: string; entries: SessionEntry[]; compactions: CompactionRecord[];
  heads: string[]; // active leaf ids (branches)
  heartbeat: number;
}

class SessionStore {
  constructor(private now: () => number) {}

  // checkpoint per turn
  append(s: Session, parentId: string, e: Omit<SessionEntry, 'id' | 'parentId' | 'ts'>): SessionEntry {
    const entry: SessionEntry = { id: cryptoId(), parentId, ts: this.now(), ...e };
    s.entries.push(entry);
    s.heartbeat = this.now();
    return entry;
  }

  // fork: branch từ checkpoint → branch mới (history chia nhánh)
  fork(s: Session, fromId: string): Session {
    const branch: Session = { ...s, id: cryptoId(), entries: s.entries.slice() };
    branch.heads = branch.heads.includes(fromId) ? branch.heads : [...branch.heads, fromId];
    return branch;
  }

  // compaction: summarize range → 1 record (giữ audit)
  compact(s: Session, range: [string, string], summary: string, keep: string[]): CompactionRecord {
    const rec: CompactionRecord = { id: cryptoId(), range, summary, kept };
    s.compactions.push(rec);
    // drop non-kept entries in range (ctx gọn)
    s.entries = s.entries.filter(e => e.id === range[0] || !inRange(e.id, range, s) || keep.includes(e.id));
    return rec;
  }

  // heartbeat: stale = treo/crash
  beat(s: Session): void { s.heartbeat = this.now(); }
  isAlive(s: Session, staleMs: number): boolean { return this.now() - s.heartbeat < staleMs; }

  // reload: nạp đầy đủ prompt entries
  reloadPrompts(s: Session): string[] { return s.entries.filter(e => e.prompt).map(e => e.prompt!); }
}
function cryptoId(): string { return Math.random().toString(36).slice(2); }
function inRange(_id: string, _range: [string, string], _s: Session): boolean { return true; }

// Usage:
// store.append(session, parent, { prompt: "viết parser" });
// const branch = store.fork(session, t1);  // fork từ t1
// store.compact(branch, [t0, t3], "summarized…", [t2]); // ctx gọn + audit
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fork branching (thử hướng khác, không mất gốc) | ❌ Branch complexity (quá nhiều branch → rối) |
| ✅ Compaction audit (giữ record, biết đã compact gì) | ❌ Compaction loss (summarize mất chi tiết) |
| ✅ Heartbeat liveness (phát hiện treo/crash) | ❌ Heartbeat overhead (ghi ts mỗi cycle) |
| ✅ Full reload (resume đầy đủ, không chỉ summary) | ❌ JSON phình (nhiều entry → file lớn) |

## Khác các hướng gần

| | 73 Durable-Execution | 121 Long-Context | UN: Session-Fork-Compaction |
|---|---|---|---|
| Cái gì | Bền vững exec | Quản lý context | **Checkpoint tree + fork + compact** |
| Branch | ❌ | ❌ | **✅ SessionFork** |
| Audit | ❌ | ❌ | **compaction record** |

## Khi nào chọn

- Session cần branching (thử hướng khác, A/B conversation)
- Context phình → cần compaction nhưng vẫn audit được
- Muốn phát hiện session treo/crash (heartbeat liveness)
- Nối packages/agent session persist + 73 durable-execution + 121 long-context-management; guard compaction fidelity (summarize giữ đủ context), branch GC (dọn branch cũ/con mồ côi), và heartbeat staleness threshold (hợp lý, không false-positive); UN = session fork-compaction, kết hợp 136 time-travel-debugging (replay checkpoint) + 522 branch-atlas-session-tree-ui
