# Hướng AEA: Context Save Restore — checkpoint git state + decisions, resume qua workspaces

> **Nguồn gốc:** gstack | **Coupling:** 🟡 — gắn git state + session, cần checkpoint store | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn memory + session-branch; thiếu checkpoint CLI) | **Effort:** 2 tuần

## Nguồn gốc

**gstack** có hai lệnh: **`/context-save`** chụp **git state + decisions + remaining work** vào **checkpoint**; **`/context-restore`** resume từ checkpoint — kể cả qua **Conductor workspaces** (đổi workspace vẫn resume được). Checkpoint ghi lại: nhánh git, commit hiện tại, diff state, quyết định đã chốt, việc còn lại.

Kèm theo: **learnings tích lũy dạng JSONL theo project slug** — `~/.gstack/projects/{slug}/learnings.jsonl`, với **search tự động khi >5 entries** — khi learnings đủ nhiều, agent tự tìm trong learnings trước khi hành động. Pattern kết hợp **checkpoint (tạm dừng/resume)** + **learning accumulation (dài hạn)**.

## Mô tả

Với mya, checkpoint nối vào `packages/core` **session-branch.ts** — đã có khái niệm branch/compression/delegate (SessionChildType). Pattern thêm: **CheckpointStore** trong `packages/memory` — lưu git state + decisions + remaining work (SQLite hoặc JSONL — brain-store đã dùng JSONL). Restore: tạo session mới (hoặc branch) nạp checkpoint state. Learnings: `packages/memory` Brain đã có auto-capture + search; thêm **project slug key** + ngưỡng >5 entries tự search. Gap: chưa có checkpoint format chuẩn + restore qua workspace đổi.

## Kiến trúc (ASCII)

```
  /context-save
    ├─ git state (branch, commit, diff)
    ├─ decisions (đã chốt gì)
    └─ remaining work (việc còn lại)
         │
         ▼ CHECKPOINT STORE (SQLite/JSONL)
  /context-restore (kể cả qua Conductor workspaces)
    └─ tạo session/branch mới ← nạp checkpoint state
         │
         ▼
  LEARNINGS (JSONL theo project slug)
    ~/.gstack/projects/{slug}/learnings.jsonl
    ├─ ≤5 entries: nạp thủ công
    └─ >5 entries: SEARCH TỰ ĐỘNG trước khi hành động
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/session-branch.ts — SessionChildType branch/compression/delegate
//   (nền restore = tạo branch session)
// ✅ packages/memory/src/brain-store.ts — JSONL append-only (nền learnings.jsonl)
// ✅ packages/memory — Brain auto-capture + search (nền learning search)
// ✅ packages/memory/src/sqlite-db.ts — SQLite (nền checkpoint store)
// ✅ packages/audit — AuditLog (decisions — nền checkpoint content)

// ❌ THIẾU: checkpoint format (git state + decisions + remaining work)
// ❌ THIẾU: /context-save + /context-restore CLI
// ❌ THIẾU: project slug key + ngưỡng >5 entries auto-search
```

## Implementation

```typescript
// packages/memory/src/checkpoint.ts (NEW)
export interface Checkpoint {
  id: string;
  projectSlug: string;
  git: { branch: string; commit: string; dirty: boolean };
  decisions: string[];
  remainingWork: string[];
  createdAt: number;
}

export class CheckpointStore {
  constructor(private db: Database) {}

  save(cp: Checkpoint): void {
    this.db.exec(
      `INSERT INTO checkpoint (id, project_slug, git, decisions, remaining_work, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cp.id, cp.projectSlug, JSON.stringify(cp.git), JSON.stringify(cp.decisions),
       JSON.stringify(cp.remainingWork), cp.createdAt],
    );
  }

  restore(id: string): Checkpoint | null {
    const row = this.db.get(`SELECT * FROM checkpoint WHERE id = ?`, [id]);
    if (!row) return null;
    return {
      id: row.id, projectSlug: row.project_slug,
      git: JSON.parse(row.git), decisions: JSON.parse(row.decisions),
      remainingWork: JSON.parse(row.remaining_work), createdAt: row.created_at,
    };
  }

  // nối session-branch — restore tạo branch session từ checkpoint
  resume(cp: Checkpoint, session: BranchableSession): void {
    session.branch({ kind: "branch", note: `resume ${cp.id}` });
    for (const d of cp.decisions) session.remember(d);
    for (const w of cp.remainingWork) session.enqueue(w);
  }
}

// learnings: project slug key + >5 entries → auto search
export function shouldAutoSearch(learnings: string[]): boolean {
  return learnings.length > 5;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Resume qua workspace đổi — không mất việc | ❌ Checkpoint stale nếu code đổi giữa chừng |
| ✅ Decisions + remaining work nạp lại đủ | ❌ Git state chỉ chụp được nếu repo sạch |
| ✅ Learnings tích lũy dài hạn theo project | ❌ JSONL lớn → search chậm (cần index) |
| ✅ Nối session-branch — restore sạch | ❌ Quá nhiều checkpoint → khó chọn cái nào |

## Khác các hướng gần

| | AEA Context Save | ADG tmux Team | ADO Learn Failures |
|---|---|---|---|
| Lưu gì | Git + decisions + work | Worker state | Corrections từ failure |
| Resume | Qua workspace | Attach lại pane | Guidance lần sau |
| Dài hạn | Learnings JSONL | — | AGENTS.md rules |

## Khi nào chọn

- Session dài phải tạm dừng/resume (đổi máy, workspace)
- Muốn learnings theo project tích lũy + tự search
- Đã có memory + session-branch — thêm checkpoint store
- Cần resume kể cả khi đổi workspace