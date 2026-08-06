# Hướng ADN: Operational CLI Durable State — harness-cli + SQLite quản lý intake/story/trace/decision/backlog/intervention

> **Nguồn gốc:** harness-experimental | **Coupling:** 🟡 — CLI quanh SQLite, gắn vào vòng đời story | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn sqlite + audit; thiếu story CLI) | **Effort:** 2 tuần

## Nguồn gốc

**HARNESS_COMPONENTS.md** của **harness-experimental** mô tả **harness-cli** — CLI vận hành dựa trên **SQLite durable layer** quản lý các loại record: **intake, story, trace, decision, backlog, intervention**. Không phải file rời rạc mà là một database có schema — query được, join được, migration được.

Điểm đáng chú ý: **verification proof gắn vào story** — story có `verify_command` và `last_verified_result`, tức là câu chuyện "task này xong" được chứng minh bằng lệnh đã chạy + kết quả lưu lại. Batch chạy qua **`story verify-all`** — xác minh lại toàn bộ story khi cần (ví dụ trước release), không phải tin tưởng trạng thái cũ.

## Mô tả

Với mya, pattern này là một **CLI + SQLite layer** cho vòng đời task: `mya story create|update|verify|verify-all`, `mya trace score`, `mya decision log`, `mya backlog add`. Storage dùng `packages/memory` sqlite-db (WAL, transaction, checkpoint đã có sẵn). Mỗi story = một hàng có `verify_command` + `last_verified_result`; `verify-all` chạy lại toàn bộ — phát hiện story bị hỏng do refactor sau đó (nối ADH acceptance criteria ở cấp vận hành). Record decision + intervention (nối ADM taxonomy — intervention recording đang Partial).

## Kiến trúc (ASCII)

```
  harness-cli
    ├─ story create      ──► INSERT INTO story (title, verify_command)
    ├─ story update      ──► UPDATE ... (status, files_changed)
    ├─ story verify      ──► chạy verify_command → last_verified_result
    ├─ story verify-all  ──► loop mọi story chưa archived
    ├─ trace score       ──► nối ADK scoreTrace
    ├─ decision log      ──► INSERT INTO decision (context, choice, rationale)
    └─ backlog add       ──► INSERT INTO backlog (intent, priority)
            │
            ▼
  SQLite durable layer
    ├─ story     (verify_command, last_verified_result, status)
    ├─ trace     (task_summary, files_*, errors, friction)
    ├─ decision  (context, choice, rationale)
    ├─ backlog   (intent, priority)
    └─ intervention (who, when, what, why)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/sqlite-db.ts — SQLite wrapper WAL + transaction
//   (nền durable layer)
// ✅ packages/memory/src/brain-sqlite-store.ts — CRUD store pattern
// ✅ packages/audit — AuditLog (decision/intervention gần tương đương)
// ✅ packages/cron — cross-process-lock (CLI batch an toàn)
// ✅ packages/core — LaneHeartbeat (status tracking)

// ❌ THIẾU: story table + verify_command/last_verified_result
// ❌ THIẾU: CLI surface (story/trace/decision/backlog commands)
// ❌ THIẾU: verify-all batch với cross-process lock
```

## Implementation

```typescript
// packages/audit/src/story.ts (NEW)
export interface Story {
  id: string;
  title: string;
  status: "open" | "in-progress" | "verified" | "failed";
  verifyCommand?: string;
  lastVerifiedResult?: { exitCode: number; at: number };
  filesChanged: string[];
}

export class StoryStore {
  constructor(private db: Database) {}

  create(s: Story): void {
    this.db.exec(
      `INSERT INTO story (id, title, status, verify_command)
       VALUES (?, ?, ?, ?)`,
      [s.id, s.title, s.status, s.verifyCommand ?? null],
    );
  }

  async verify(id: string): Promise<{ ok: boolean; result: string }> {
    const s = this.get(id);
    if (!s?.verifyCommand) return { ok: false, result: "no verify_command" };
    const r = await runShell(s.verifyCommand);
    const ok = r.exitCode === 0;
    this.db.exec(
      `UPDATE story SET status = ?, last_verified_result = ?
       WHERE id = ?`,
      [ok ? "verified" : "failed", JSON.stringify({ exitCode: r.exitCode, at: Date.now() }), id],
    );
    return { ok, result: r.stdout };
  }

  async verifyAll(): Promise<{ ok: number; failed: number }> {
    // batch — chạy với cross-process lock (packages/cron)
    const rows = this.db.all(`SELECT id FROM story WHERE status != 'archived'`);
    let ok = 0, failed = 0;
    for (const { id } of rows) (await this.verify(id)).ok ? ok++ : failed++;
    return { ok, failed };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Verify proof gắn vào story, không tin lời | ❌ verify_command có thể stale (lệnh đổi) |
| ✅ verify-all phát hiện story hỏng do refactor | ❌ CLI thêm bề mặt cần maintain |
| ✅ SQLite query/join được — không file rời | ❌ Migration khi schema đổi |
| ✅ Decision/intervention ghi durable | ❌ Story cập nhật tay dễ quên |

## Khác các hướng gần

| | ADN Story CLI | ADK Trace | ADH Acceptance |
|---|---|---|---|
| Đơn vị | Story (task lifecycle) | Trace (turn hành trình) | Criteria (trước execution) |
| Verify | verify_command lưu trong story | score-trace | Command/artifact/manual |
| Batch | verify-all | score mọi trace | Gate từng turn |

## Khi nào chọn

- Vận hành nhiều story cần verify lại khi release
- Muốn decision/intervention có durable record
- Đã có sqlite-db + audit — thêm story table + CLI
- Cần cross-process an toàn cho batch (đã có lock)