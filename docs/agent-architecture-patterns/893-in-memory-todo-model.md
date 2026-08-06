# Hướng AHI: In-Memory Todo Model — todo state quản lý in-memory thuần với CRUD + validation thay vì DB phức tạp, đủ cho task tracking nhúng trong agent session

> **Nguồn gốc:** pi-manage-todo-list | **Coupling:** 🟢 — in-memory state thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có kanban file-backed, nhưng KHÔNG có in-memory thuần todo model) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-manage-todo-list** quản lý todo state **in-memory thuần** (Map/Array) với **CRUD** (create/read/update/delete) + **validation** — **không DB** (SQLite/JSON file phức tạp). Lý do: task tracking nhúng trong **agent session** (tạm thời, per-session) không cần persist lâu dài — in-memory đủ, đơn giản, nhanh, không I/O. Khi session kết thúc, todo biến mất (đúng ngữ nghĩa "scratch task list"). Pattern **YAGNI**: chọn storage mức độ vừa đủ, không over-engineer DB khi in-memory thỏa.

Nguyên tắc: **in-memory thuần** (Map/Array, không I/O); **CRUD + validation** (đủ operation); **per-session** (tạm thời, không persist); **YAGNI** (không DB khi không cần).

## Mô tả

Với mya, packages/tools `kanban.ts` là **file-backed** (`~/.mya/kanban.json` persist). mya **chưa có** **in-memory thuần** todo model (scratch, per-session, không I/O). Pattern này cho task list tạm trong agent session — nhanh, đơn giản, không persist khi không cần. Bổ sung kanban (persist) bằng in-memory (scratch).

## Kiến trúc (ASCII)

```
  agent session (tạm thời)
        │
        ▼
  InMemoryTodoStore (Map<id, TodoItem>)  ← KHÔNG DB, KHÔNG file I/O
        │
        ├─ create(item) → validate → map.set(id, item)
        ├─ read(id) → map.get(id)
        ├─ update(id, patch) → validate → merge
        └─ delete(id) → map.delete(id)
        │
        ▼
  session kết thúc → todo biến mất (đúng scratch semantics)
  ── YAGNI: không DB khi in-memory đủ
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/kanban.ts — file-backed board (~/.mya/kanban.json, persist)
// ✅ packages/memory/src/backends.ts — InMemoryBackend (cache tier, pattern tương tự)
// ⚠️ KHÔNG có in-memory thuần todo model (scratch, per-session, không I/O)
// ❌ KHÔNG có CRUD + validation in-memory cho todo
```

## Implementation

```typescript
// packages/tools/src/todo-store.ts (NEW)
import type { TodoItem, TodoStatus } from "./todo-model.js";
import { validateTodo } from "./todo-model.js";

/** In-memory todo store — scratch, per-session, không DB/file I/O. */
export class InMemoryTodoStore {
  private items = new Map<string, TodoItem>();

  create(item: TodoItem): void {
    validateTodo(item, new Set(this.items.keys()));
    this.items.set(item.id, item);
  }

  read(id: string): TodoItem | undefined { return this.items.get(id); }

  list(): TodoItem[] { return [...this.items.values()]; }

  update(id: string, patch: Partial<Omit<TodoItem, "id">>): TodoItem | undefined {
    const cur = this.items.get(id);
    if (!cur) return undefined;
    const next: TodoItem = { ...cur, ...patch, id };   // id immutable
    validateTodo(next, new Set([...this.items.keys()].filter((k) => k !== id)));
    this.items.set(id, next);
    return next;
  }

  delete(id: string): boolean { return this.items.delete(id); }

  clear(): void { this.items.clear(); }   // session kết thúc → scratch biến mất
}

// Dùng (tool): store.create({ id, title, description, status: "not-started" });
// không persist — chỉ sống trong session.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đơn giản, nhanh, không I/O | ❌ Mất todo khi session kết thúc (không persist) |
| ✅ YAGNI — không DB over-engineer | ❌ Không share giữa process/session |
| ✅ Scratch semantics đúng (tạm) | ❌ Restart mất task (chỉ khi cần persist → kanban) |

## Khác các hướng gần

| | AHI In-Memory Todo | AHH Todo Validation | kanban.ts |
|---|---|---|---|
| Trọng tâm | In-memory CRUD thuần | Schema validate + aggregate | File-backed board |
| Cơ chế | Map<id, TodoItem> | status enum + TodoStats | JSON persist |
| Quan hệ | Nối todo storage | Nối todo data model | Nối task board persist |

## Khi nào chọn

- Task tracking tạm trong agent session (scratch, không cần persist)
- Muốn đơn giản, nhanh, không I/O (YAGNI — không DB)
- Per-session todo (biến mất khi session kết thúc)
- Guard: validate mỗi CRUD, id immutable, clear khi session end; dùng kanban khi cần persist
