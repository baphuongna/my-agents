# Hướng AHB: Git-Backed MD Memory — memory theo project dạng git-backed markdown tại ~/.pi-memory/<project>/ với context.md/preferences.md/knowledge.md; loadProjectMemory đọc index.md và auto-append vào conversation

> **Nguồn gốc:** pi-memory-md | **Coupling:** 🟡 — bind vào memory + git | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có FileBackend markdown + brain-store, nhưng KHÔNG có git-backed + structured per-project files) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-memory-md** lưu memory **theo project** dạng **git-backed markdown** tại `~/.pi-memory/<project>/`. Mỗi project có 3 file có cấu trúc: `context.md` (ngữ cảnh dự án), `preferences.md` (sở thích người dùng), `knowledge.md` (kiến thức tích lũy). `loadProjectMemory` đọc `index.md` (mục lục) và **auto-append** vào conversation (inject vào system prompt/context). **Git-backed** nghĩa là mỗi thay đổi commit → version history, diff, rollback, sync repo. Markdown = human-readable + git-friendly.

Nguyên tắc: **per-project isolation** (mỗi project memory riêng); **structured files** (context/preferences/knowledge tách role); **git-backed** (version history, diff, sync); **auto-inject vào conversation** (loadProjectMemory → context prompt).

## Mô tả

Với mya, packages/memory `backends.ts` có `FileBackend` (append-only markdown `<dir>/<role>.md`, line 162+) + `brain-store.ts` (SQLite store). mya **đã có markdown role file**, nhưng **chưa có**: (1) **git-backed** (commit/diff/sync version history), (2) **per-project dir** có cấu trúc (`~/.pi-memory/<project>/context.md|preferences.md|knowledge.md`), (3) **loadProjectMemory auto-inject** index.md vào conversation. Pattern này cho memory version-controlled, human-editable, per-project.

## Kiến trúc (ASCII)

```
  ~/.pi-memory/<project>/
   ├─ context.md       (ngữ cảnh dự án)
   ├─ preferences.md   (sở thích người dùng)
   ├─ knowledge.md     (kiến thức tích lũy)
   └─ index.md         (mục lục / tóm tắt)
        │
        ├─ git commit mỗi thay đổi → version history, diff, rollback, sync
        │
        └─ loadProjectMemory() → đọc index.md → auto-append vào conversation
                                   (inject system prompt/context)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/backends.ts — FileBackend append-only markdown <dir>/<role>.md (line 162+)
// ✅ packages/memory/src/brain-store.ts — SqliteBrainStore (structured store)
// ✅ packages/memory/src/manager.ts — MemoryManagerImpl
// ⚠️ KHÔNG có git-backed (commit/diff/sync version history)
// ❌ KHÔNG có per-project structured dir (context/preferences/knowledge + index)
// ❌ KHÔNG có loadProjectMemory auto-inject index.md vào conversation
```

## Implementation

```typescript
// packages/memory/src/git-md-memory.ts (NEW)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const ROLES = ["context", "preferences", "knowledge"] as const;
type Role = typeof ROLES[number];

export class GitMdMemory {
  private readonly dir: string;
  constructor(project: string) {
    this.dir = join(homedir(), ".pi-memory", project);
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(join(this.dir, ".git"))) execSync(`git init -q`, { cwd: this.dir });
  }

  write(role: Role, content: string): void {
    writeFileSync(join(this.dir, `${role}.md`), content + "\n");
    this.commit(`update ${role}`);
  }

  /** Đọc index.md → auto-append vào conversation context. */
  loadProjectMemory(): string {
    const idx = join(this.dir, "index.md");
    return existsSync(idx) ? readFileSync(idx, "utf8") : "";
  }

  read(role: Role): string {
    const p = join(this.dir, `${role}.md`);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }

  private commit(msg: string): void {
    try {
      execSync(`git add -A && git commit -q -m ${JSON.stringify(msg)}`, { cwd: this.dir });
    } catch { /* nothing staged / no change → noop */ }
  }
}
// Boot: memory = new GitMdMemory(projectName); context.inject(memory.loadProjectMemory());
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Version history (git diff/rollback/sync) | ❌ Git dependency + commit overhead mỗi write |
| ✅ Human-readable markdown (edit tay được) | ❌ Markdown parse loose (không structured như DB) |
| ✅ Per-project isolation + auto-inject | ❌ ~/.pi-memory phình khi nhiều project |

## Khác các hướng gần

| | AHB Git-Backed Memory | FileBackend (mya) | brain-store.ts |
|---|---|---|---|
| Trọng tâm | Version-controlled markdown | Append-only markdown | SQLite structured |
| Cơ chế | git commit per project | appendFile <role>.md | SqliteBrainStore |
| Quan hệ | Nối memory persistence | Nối memory backend | Nối structured store |

## Khi nào chọn

- Cần memory version-controlled (diff/rollback/sync qua git)
- Muốn human-readable markdown (edit tay, review PR-style)
- Per-project isolation + auto-inject vào conversation
- Guard: git init per project, commit mỗi write, loadProjectMemory inject index
