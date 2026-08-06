# Hướng AHH: Todo State Validation — todo item có schema validate (id/title/description/status not-started|in-progress|completed); TodoStats aggregate total/completed/inProgress/notStarted cho UI progress

> **Nguồn gốc:** pi-manage-todo-list | **Coupling:** 🟢 — data model thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có kanban.ts task board, nhưng KHÔNG có validated todo status enum + TodoStats aggregate) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-manage-todo-list** mỗi todo item có **schema validate**: `id` (unique), `title`, `description`, `status` ∈ `{not-started, in-progress, completed}` (enum严格的). `TodoStats` **aggregate** `total`/`completed`/`inProgress`/`notStarted` cho UI progress bar. Validate schema → reject todo hỏng (thiếu field, status sai) trước khi lưu. Aggregate → UI render progress (vd "3/5 completed") mà không scan lại list mỗi render.

Nguyên tắc: **schema validate** (id/title/description/status enum); **status enum** (3 trạng thái rõ ràng); **TodoStats aggregate** (total/completed/inProgress/notStarted); **reject hỏng trước lưu**.

## Mô tả

Với mya, packages/tools `kanban.ts` có task board (`KanbanTask { id, title, column }`) nhưng **chưa có**: (1) **validated status enum** (not-started/in-progress/completed — hiện chỉ column tự do), (2) **description field**, (3) **TodoStats aggregate**. Pattern này cho task tracking có schema chặt + progress aggregate — quan trọng khi LLM quản lý todo.

## Kiến trúc (ASCII)

```
  TodoItem { id, title, description, status }
        │
        ▼
  validateSchema(item):
    ├─ id unique, title non-empty
    ├─ description string
    └─ status ∈ {not-started, in-progress, completed}  (enum)
        │  reject nếu hỏng
        ▼
  TodoStats aggregate:
    total=5, completed=3, inProgress=1, notStarted=1
        │
        ▼
  UI: "3/5 completed" + progress bar
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/kanban.ts — KanbanTask { id, title, column } (file-backed board)
// ✅ packages/tools/src/kanban-sqlite.ts — SQLite kanban variant
// ⚠️ KHÔNG có validated status enum (not-started|in-progress|completed)
// ❌ KHÔNG có description field + TodoStats aggregate (total/completed/inProgress/notStarted)
```

## Implementation

```typescript
// packages/tools/src/todo-model.ts (NEW)
export type TodoStatus = "not-started" | "in-progress" | "completed";
export interface TodoItem { id: string; title: string; description: string; status: TodoStatus; }
export interface TodoStats { total: number; completed: number; inProgress: number; notStarted: number; }

const STATUSES: readonly TodoStatus[] = ["not-started", "in-progress", "completed"];

/** Validate schema — throw nếu hỏng (id dup, title empty, status sai). */
export function validateTodo(item: TodoItem, existing = new Set<string>()): void {
  if (!item.id || existing.has(item.id)) throw new Error(`invalid/dup id: ${item.id}`);
  if (!item.title || !item.title.trim()) throw new Error("title required");
  if (typeof item.description !== "string") throw new Error("description must be string");
  if (!STATUSES.includes(item.status)) throw new Error(`status must be one of ${STATUSES.join("|")}`);
}

/** Aggregate stats cho UI progress. */
export function todoStats(items: readonly TodoItem[]): TodoStats {
  const stats: TodoStats = { total: items.length, completed: 0, inProgress: 0, notStarted: 0 };
  for (const it of items) {
    if (it.status === "completed") stats.completed++;
    else if (it.status === "in-progress") stats.inProgress++;
    else stats.notStarted++;
  }
  return stats;
}

// Dùng: validateTodo(item, ids); store.push(item); render(`${stats.completed}/${stats.total}`);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Schema chặt (reject todo hỏng trước lưu) | ❌ Validate mỗi mutation (overhead nhẹ) |
| ✅ Status enum rõ (3 trạng thái) | ❌ Ít linh hoạt hơn column tự do (kanban) |
| ✅ TodoStats aggregate → UI progress nhanh | ❌ Migration nếu đổi schema (thêm field) |

## Khác các hướng gần

| | AHH Todo State Validation | AHI In-Memory Todo | kanban.ts |
|---|---|---|---|
| Trọng tâm | Schema validate + aggregate | In-memory CRUD thuần | File-backed board |
| Cơ chế | status enum + TodoStats | Map<id, TodoItem> | JSON column store |
| Quan hệ | Nối todo data model | Nối todo storage | Nối task board |

## Khi nào chọn

- Task tracking cần schema chặt (status enum, không rác)
- Cần TodoStats aggregate cho UI progress
- LLM quản lý todo — cần reject input hỏng
- Guard: validate trước lưu, status enum, aggregate O(n) mỗi mutation (cache nếu lớn)
