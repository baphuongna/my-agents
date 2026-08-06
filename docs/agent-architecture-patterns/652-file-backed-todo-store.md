# Hướng YB: File-Backed Todo Store — todos.ts lưu mỗi todo thành file markdown riêng `<id>.md` có JSON frontmatter + file `.lock` khi session đang edit, settings.json điều khiển GC (gcDays) — todo độc lập session (extensions/todos.ts)

> **Nguồn gốc:** agent-stuff (extensions/todos.ts) | **Coupling:** 🟢 — file-based store, không đụng runtime lõi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có kanban-sqlite + kanban.json — chưa có markdown-per-todo + lock) | **Effort:** 2-3 tuần

## Nguồn gốc

**agent-stuff** `todos.ts` chọn lưu todo bằng **file markdown riêng per todo**: mỗi todo là `<id>.md` với **JSON frontmatter** (title, status, tags, created, due) + body markdown tự do. Khi session đang edit một todo, tồn tại file **`.lock`** cạnh nó chống ghi đè đồng thời. `settings.json` điều khiển **GC** (`gcDays`). Lý do chọn file thay vì DB: **todo độc lập session** — todo sống qua session đổi, có thể grep/diff/review bằng công cụ thường, không bị khóa trong một session store.

## Mô tả

mya áp dụng file-backed-todo-store: thư mục `~/.mya/todos/` chứa `<id>.md`. Mỗi file: frontmatter JSON (id, title, status: open|done|cancelled, tags, createdAt, doneAt) + body ghi chú. CRUD = đọc/ghi file (atomic: write temp + rename). **Lock**: khi session mở todo để sửa, tạo `<id>.md.lock` chứa sessionId + ts; session khác thấy lock → báo busy (stale lock quá 5 phút → reclaim). **GC**: cron chạy theo settings.json `gcDays` (mặc định 30) — todo đóng quá hạn → chuyển `.archived` hoặc xóa. Todo độc lập session → reload/đổi session vẫn còn. mya có sẵn kanban.json (tools/kanban.ts) + kanban-sqlite (tools/kanban-sqlite.ts) + cron — YB thêm **todo file layout** + **lock manager** + **GC sweep**.

## Kiến trúc

```
  ~/.mya/todos/
    ├─ 9f3a2.md           ← todo: JSON frontmatter + markdown body
    ├─ 9f3a2.md.lock      ← session đang edit (sessionId + ts)
    ├─ b21cc.md
    └─ b21cc.md.lock      ← stale (ts > 5ph) → reclaim được

  CRUD:   write temp + rename (atomic)  |  đọc: parse frontmatter
  Lock:   create lock → edit → remove lock
  GC:     cron đọc settings { gcDays: 30 } → todo cũ → .archived
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools kanban.ts — kanban.json board (nền — YB todo tương tự nhưng per-file)
// ✅ packages/tools kanban-sqlite.ts — kanban SQLite (nền — YB so sánh: DB vs file)
// ✅ packages/cron — runner sweep định kỳ (nền — YB GC)
// ✅ packages/tools path-safety.ts — sanitize tên (nền — YB id → filename an toàn)

// ❌ THIẾU: markdown-per-todo layout (frontmatter + body)
// ❌ THIẾU: lock file manager (sessionId, stale reclaim)
// ❌ THIẾU: GC sweep theo settings.json gcDays
```

## Implementation (TS)

```typescript
// packages/tools/src/todo-store.ts (MỚI)
import { readFile, writeFile, rename, unlink, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface Todo { id: string; title: string; status: "open" | "done" | "cancelled"; tags: string[]; createdAt: string; doneAt?: string; }

const LOCK_TTL_MS = 5 * 60_000; // stale lock sau 5 phút

export class TodoStore {
  constructor(private dir: string) {}

  private file(id: string) { return join(this.dir, `${id}.md`); }
  private lock(id: string) { return join(this.dir, `${id}.md.lock`); }

  async save(todo: Todo, body = ""): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const md = `---\n${JSON.stringify(todo, null, 2)}\n---\n\n${body}`;
    const tmp = `${this.file(todo.id)}.tmp`;
    await writeFile(tmp, md, "utf8");
    await rename(tmp, this.file(todo.id)); // atomic
  }

  async lock(id: string, sessionId: string): Promise<boolean> {
    const l = this.lock(id);
    try {
      const cur = JSON.parse(await readFile(l, "utf8")) as { sessionId: string; ts: number };
      if (cur.sessionId !== sessionId && Date.now() - cur.ts < LOCK_TTL_MS) return false; // busy
    } catch { /* không có lock hoặc hỏng → reclaim */ }
    await writeFile(l, JSON.stringify({ sessionId, ts: Date.now() }), "utf8");
    return true;
  }

  async unlock(id: string, sessionId: string): Promise<void> {
    const l = this.lock(id);
    try {
      const cur = JSON.parse(await readFile(l, "utf8")) as { sessionId: string };
      if (cur.sessionId === sessionId) await unlink(l);
    } catch { /* lock mất rồi */ }
  }

  async gc(gcDays: number): Promise<number> { // done/cancelled quá hạn → xóa
    const cutoff = Date.now() - gcDays * 86_400_000;
    let removed = 0;
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith(".md") || f.endsWith(".lock")) continue;
      const todo = JSON.parse((await readFile(join(this.dir, f), "utf8")).split("---\n")[1] ?? "{}") as Todo;
      const done = todo.status === "done" || todo.status === "cancelled";
      if (done && new Date(todo.doneAt ?? 0).getTime() < cutoff) { await unlink(join(this.dir, f)); removed++; }
    }
    return removed;
  }
}

// Usage:
// const todos = new TodoStore(join(homedir(), ".mya", "todos"));
// await todos.lock("9f3a2", session.id);
// await todos.save({ id: "9f3a2", title: "ship v2", status: "open", tags: [], createdAt: new Date().toISOString() });
// await todos.unlock("9f3a2", session.id);
// await todos.gc(30); // cron dọn todo cũ 30 ngày
```

## Được

- ✅ Todo độc lập session — sống qua reload/đổi session
- ✅ Tool-friendly — grep/diff/review bằng công cụ thường
- ✅ Lock chống ghi đè — hai session không giẫm chân nhau

## Mất

- ❌ Nhiều file nhỏ — thư mục lớn, ls chậm khi hàng nghìn todo
- ❌ Lock stale phức tạp — crash giữa edit để lock rác (TTL reclaim)
- ❌ Frontmatter parse — file hỏng làm parse fail cần fallback

## Khác các hướng gần

| | Kanban JSON (kanban.ts) | Kanban SQLite (kanban-sqlite.ts) | YB: File-Backed Todo |
|---|---|---|---|
| Lưu trữ | 1 file JSON | SQLite | **1 md per todo** |
| Độc lập session | trong store | trong DB | **độc lập, grep được** |
| Concurrency | không lock | DB lock | **.lock file + TTL** |
| GC | không | query | **settings gcDays** |

## Khi nào chọn

- Todo cần sống độc lập session và được grep/diff bằng tool thường
- Cần lock chống ghi đè giữa các session (mya chạy multi-session)
- Có kanban + cron + path-safety sẵn — YB thêm file layout + lock + GC
- Nối packages/tools kanban.ts (board tổng) + path-safety.ts (id→filename) + cron (GC sweep); guard id-sanitize (không path traversal), lock-stale (TTL reclaim), gc-whitelist (todo open không bị GC); YB = file-backed todo, kết hợp 651 YA session-log-backstate (so sánh DB-less) + 653 YC throttled-repo-cache (cùng tư tưởng file-local)
