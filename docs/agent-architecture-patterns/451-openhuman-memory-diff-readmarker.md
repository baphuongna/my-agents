# Hướng QI: Memory Diff Readmarker — memory git repo, read-marker biết cái gì đổi chưa đọc, diff

> **Nguồn gốc:** OpenHuman (memory diff readmarker); "memory as versioned git repo"; "read-marker tracking"; "unread memory diff"; "git-backed memory store"
> **Coupling:** 🟡 — cần git-backed memory store + read-marker tracking
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory store + git tools sẵn — chưa có git-backed memory + read-marker + diff)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenHuman** lưu memory là **git repo**: mỗi memory = file, mỗi cập nhật = commit. **Read-marker** theo dõi agent/user đã đọc đến commit nào. Khi memory thay đổi (new commit), **diff** compute: cái gì mới, cái gì sửa, cái gì chưa đọc. Giống **unread notification** (blue dot cho unread) nhưng cho memory. Nguyên tắc: **memory có lịch sử (versioned), agent biết cái gì đổi chưa đọc**. Lợi thế: audit trail (ai đổi gì khi nào), diff (thấy chính xác thay đổi), read-marker (không đọc lại cái đã đọc). Khác **82 memory-consolidation** (compress) — QI là **version tracking**; khác **88 hybrid-graph-vector** (retrieval) — QI là **change detection**.

## Mô tả

mya memory diff readmarker: memory store = **git repo** (`~/.mya/memory/`). Mỗi memory file, mỗi update = commit. **Read-marker** = last-read commit hash per consumer (agent, user). Khi memory cập nhật: **diff** compute (since last-read) → unread changes. Agent load **chỉ unread diff** (không reload toàn bộ). User thấy **unread indicator** (như git log unread). Nối 82 memory-consolidation + 88 hybrid-graph-vector + 165 hierarchical-memory.

## Kiến trúc

```
  MEMORY GIT REPO (~/.mya/memory/):
  ├── preferences.toml       (user coding style)
  ├── auth-knowledge.md      (auth module insights)
  ├── project-context.md     (project state)
  └── .git/
      ├── commits: abc123 → def456 → ghi789
      └── ...

  READ-MARKER (per consumer):
  ┌──────────────────────────────────────────────────┐
  │  agent-session-42:  last-read = abc123           │
  │  agent-session-43:  last-read = def456           │
  │  user-alice:        last-read = abc123           │
  └──────────────────────────────────────────────────┘

  UNREAD DIFF (session-42, since abc123):
  ┌──────────────────────────────────────────────────┐
  │  git diff abc123..HEAD:                           │
  │                                                    │
  │  preferences.toml:                                 │
  │  + prefers TypeScript over JavaScript             │
  │                                                    │
  │  auth-knowledge.md:                                │
  │  + JWT token refresh bug fixed in commit xyz      │
  │                                                    │
  │  → 2 files changed, 2 additions                   │
  │  → agent loads ONLY this diff (not full memory)   │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ memory store — memory persistence (nền — QI = git-backed version)
// ✅ git tools (bash git) — git operations (nền)
// ✅ 82 memory-consolidation — memory updates (nền — QI = version tracking)
// ✅ 88 hybrid-graph-vector-memory — retrieval (relate — QI = change detection)
// ✅ 165 hierarchical-memory — memory tiers (relate)

// ❌ THIẾU: git-backed memory repo (memory = files, commit per update)
// ❌ THIẾU: read-marker (last-read commit hash per consumer)
// ❌ THIẾU: unread diff computation (git diff since last-read)
// ❌ THIẾU: unread indicator (blue dot for changed memory)
```

## Implementation

```typescript
// packages/agent/src/memory-readmarker.ts (NEW)
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

class MemoryDiffReadmarker {
  private memoryRepo: string;
  private markerFile: string;

  constructor(repoPath: string) {
    this.memoryRepo = repoPath;
    this.markerFile = join(repoPath, '.readmarkers.json');
  }

  // Write/update memory → git commit
  commitMemory(file: string, content: string, message: string): string {
    const filePath = join(this.memoryRepo, file);
    writeFileSync(filePath, content);
    execSync(`git add ${file} && git commit -m "${message}"`, { cwd: this.memoryRepo });
    return execSync('git rev-parse HEAD', { cwd: this.memoryRepo }).toString().trim();
  }

  // Get unread diff since last-read for a consumer
  getUnreadDiff(consumer: string): { files: string[]; diff: string; hasUnread: boolean } {
    const markers = this.loadMarkers();
    const lastRead = markers[consumer] ?? execSync('git rev-list --max-parents=0 HEAD', { cwd: this.memoryRepo }).toString().trim();
    const head = execSync('git rev-parse HEAD', { cwd: this.memoryRepo }).toString().trim();

    if (lastRead === head) return { files: [], diff: '', hasUnread: false };

    const diff = execSync(`git diff ${lastRead}..${head}`, { cwd: this.memoryRepo }).toString();
    const files = execSync(`git diff --name-only ${lastRead}..${head}`, { cwd: this.memoryRepo })
      .toString().trim().split('\n').filter(Boolean);
    return { files, diff, hasUnread: files.length > 0 };
  }

  // Mark as read (update read-marker to HEAD)
  markRead(consumer: string): void {
    const markers = this.loadMarkers();
    markers[consumer] = execSync('git rev-parse HEAD', { cwd: this.memoryRepo }).toString().trim();
    writeFileSync(this.markerFile, JSON.stringify(markers, null, 2));
  }

  private loadMarkers(): Record<string, string> {
    if (!existsSync(this.markerFile)) return {};
    return JSON.parse(readFileSync(this.markerFile, 'utf-8'));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Version history (audit trail: ai đổi gì khi nào) | ❌ Git overhead (commit per update = nhiều commit) |
| ✅ Unread diff (load chỉ cái đổi, không reload toàn bộ) | ❌ Merge complexity (multi-agent ghi cùng memory file) |
| ✅ Read-marker (biết cái gì chưa đọc, không đọc lại) | ❌ Repo bloat (nhiều commit = repo phình) |
| ✅ Token-efficient (diff < full reload) | ❌ Git lock (concurrent write → conflict) |

## Khác các hướng gần

| | 82 Memory-Consolidation | 88 Graph-Vector-Memory | 165 Hierarchical-Memory | QI: Memory-Diff-Readmarker |
|---|---|---|---|---|
| Trọng tâm | Compress memory | Retrieve memory | Tier memory | **Version + change detection** |
| Lịch sử | ❌ (overwrite) | ❌ | ❌ | **✅ (git commits)** |
| Unread | ❌ | ❌ | ❌ | **✅ (read-marker + diff)** |

## Khi nào chọn

- Memory thay đổi thường xuyên (cần biết cái gì đổi)
- Cần version history (audit trail, rollback)
- Muốn token-efficient reload (diff < full)
- Multi-consumer (agent + user đều có read-marker riêng)
- Nối 82 memory-consolidation + 88 hybrid-graph-vector-memory + 165 hierarchical-memory
