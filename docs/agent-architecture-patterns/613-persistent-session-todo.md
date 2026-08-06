# Hướng WO: Persistent Session Todo — todo tool viết TodoTable với session_id + position order; giữ todo trạng thái trong session

> **Nguồn gốc:** opencode `todo tool` (viết `TodoTable` với `session_id` + `position` order; todo state persist trong session); "todo tool writes TodoTable", "session_id + position order", "persist todo state across turns" | **Coupling:** 🟢 — thêm todo tool + session-scoped TodoTable vào tool/session layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session + tools sẵn — chưa có todo tool + session-scoped TodoTable + position order) | **Effort:** 1-2 tuần

## Nguồn gốc

**opencode** có `todo` tool cho agent tự quản lý task list. Todo được lưu thành **TodoTable** — mỗi row có: `session_id` (thuộc session nào), `position` (thứ tự hiển thị), `content` (task text), `status` (pending/in_progress/done). Đặc biệt: todo **persist trong session** — sau compact, sau nhiều turn, todo state vẫn còn (không mất). Agent dùng todo để track tiến độ: thêm task, mark done, reorder. Nguyên tắc: **structured todo + session-scoped persistence + ordered**.

## Mô tả

mya persistent session todo: (1) **Todo tool**: agent gọi `todo` → add/update/delete/reorder task. (2) **TodoTable**: storage có `session_id` (scope theo session), `position` (order), `status` (pending/in_progress/done). (3) **Persist**: todo lưu trong session → survive compact (không mất sau summarize). (4) **Render**: todo hiển thị trong UI/TUI (checkbox list). (5) **Position order**: task xếp theo position → agent reorder khi reprioritize. mya có session + tools — WO thêm **todo tool** + **session-scoped TodoTable** + **position order persistence**.

## Kiến trúc

```
  AGENT TURN: gọi todo tool
        │
        ▼
  ┌─── TODO TOOL ────────────────────────────────────────┐
  │  todo(action: "add", content: "implement auth")      │
  │  todo(action: "update", id: 2, status: "in_progress")│
  │  todo(action: "reorder", id: 3, position: 1)         │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── TODOTABLE (session-scoped storage) ───────────────┐
  │  session_id: "sess-abc"                               │
  │  ┌──┬─────────────────────┬──────────┬─────────┐     │
  │  │id│ content              │ status   │position │     │
  │  ├──┼─────────────────────┼──────────┼─────────┤     │
  │  │ 3│ write tests          │ pending  │    1    │     │
  │  │ 1│ implement auth       │ done     │    2    │     │
  │  │ 2│ add validation       │ in_prog  │    3    │     │
  │  └──┴─────────────────────┴──────────┴─────────┘     │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── PERSIST (survive compact) ─────────────────────────┐
  │  compact summarize history → TodoTable KHÔNG compact   │
  │  (session-scoped storage — không trong history)        │
  │  → todo state còn nguyên sau compact                   │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── RENDER (UI/TUI) ───────────────────────────────────┐
  │  [ ] write tests          (position 1)                 │
  │  [✓] implement auth       (position 2, done)           │
  │  [~] add validation       (position 3, in_progress)    │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — session storage (nền — WO session_id scope)
// ✅ packages/tools — tool system (nền — WO todo tool)
// ✅ packages/core laneboard.ts — laneboard/order (nền — WO position order analog)
// ✅ packages/tui — UI render (nền — WO todo render)

// ❌ THIẾU: todo tool (add/update/delete/reorder action)
// ❌ THIẾU: session-scoped TodoTable (session_id + position + status)
// ❌ THIẾU: compact-survive persistence (todo không mất sau compact)
```

## Implementation

```typescript
// packages/tools/src/persistent-session-todo.ts (MỚI)
type TodoStatus = "pending" | "in_progress" | "done";

interface TodoRow {
  id: number;
  sessionId: string;
  content: string;
  status: TodoStatus;
  position: number;
}

class SessionTodoTable {
  private rows = new Map<string, TodoRow[]>(); // sessionId → rows
  private nextId = 1;

  // todo tool action dispatch
  todo(sessionId: string, action: { op: string; [k: string]: unknown }): TodoRow[] {
    const list = this.rows.get(sessionId) ?? [];
    switch (action.op) {
      case "add":
        list.push({ id: this.nextId++, sessionId, content: action.content as string, status: "pending", position: list.length + 1 });
        break;
      case "update": {
        const row = list.find(r => r.id === action.id);
        if (row && action.status) row.status = action.status as TodoStatus;
        break;
      }
      case "reorder": {
        const row = list.find(r => r.id === action.id);
        if (row) row.position = action.position as number;
        list.sort((a, b) => a.position - b.position); // re-sort by position
        break;
      }
      case "delete":
        this.rows.set(sessionId, list.filter(r => r.id !== action.id));
        return this.list(sessionId);
    }
    this.rows.set(sessionId, list);
    return this.list(sessionId);
  }

  // list ordered by position (render)
  list(sessionId: string): TodoRow[] {
    return (this.rows.get(sessionId) ?? []).slice().sort((a, b) => a.position - b.position);
  }
}

// Usage:
// const table = new SessionTodoTable();
// table.todo("sess-abc", { op: "add", content: "implement auth" });
// table.todo("sess-abc", { op: "update", id: 1, status: "done" });
// const todos = table.list("sess-abc"); // ordered by position
```

## Được

- ✅ Progress tracking (agent biết đã làm gì, còn gì — không redo)
- ✅ Compact-survive (todo persist — không mất sau summarize)
- ✅ Ordered (position → priority order rõ ràng)
- ✅ Session-scoped (mỗi session todo riêng — không cross-contaminate)

## Mất

- ❌ Token overhead (todo inject vào context mỗi turn)
- ❌ State drift (agent quên update todo → stale)
- ❌ Position conflict (reorder sai → position trùng/gap)
- ❌ Cross-session (todo không share giữa session — manual export)

## Khác

Khác **366 NB seamless-compaction** (todo-state checkpoint trong summary) — WO **structured table** (TodoTable storage, không chỉ summary). Khác **611 WM subagent-depth-gating** (subagent tracking) — WO **task tracking** (todo list cho agent tự quản lý). Khác **543 TW durable-context-projection** (re-project context) — WO **task list** (todo, không context).

## Khi nào chọn

- Agent làm task nhiều bước → cần track tiến độ (không quên, không redo)
- Muốn compact-survive (todo persist — không mất sau summarize)
- Cần ordered priority (position → task nào trước)
- Nối packages/core session.ts + packages/tools + laneboard.ts + packages/tui; guard position-uniqueness (reorder → renumber không gap), compact-inject (todo inject mỗi turn — token budget), và status-validation (chỉ pending/in_progress/done — không arbitrary); WO = persistent session todo, kết hợp 366 NB seamless-compaction (compact survive) + packages/core laneboard (order)
