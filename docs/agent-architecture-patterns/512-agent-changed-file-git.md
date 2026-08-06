# Hướng SR: Agent-Changed-File Git — IPC AGENT_CHANGED_FILES {count,files} cho git panel commit msg

> **Nguồn gốc:** openpi `IPC.AGENT_CHANGED_FILES` (`electron/pi/messages.ts`, `preload/git.ts`, `GitAgentBanner`, `GitChangesList`); "agent-changed files committed or reverted"; "git panel commit message scope from changed files"; "IPC bridge agent write → git UI" | **Coupling:** 🟢 — thêm changed-file event từ agent-write hook → git UI panel | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (edit/write tools + IPC sẵn — chưa có changed-file tracker + git panel bridge) | **Effort:** 2-3 tuần

## Nguồn gốc

**openpi** bắc **IPC bridge** giữa agent và **git panel UI**: mỗi khi agent kết thúc một đợt sửa file, main process chạy `git status` lấy danh sách file đã đổi, rồi `webContents.send(IPC.AGENT_CHANGED_FILES, { count, files })` → renderer hiển thị banner "Agent changed files" + list trong **Git panel**. Mục đích: user thấy **chính xác agent đã chạm file nào** → viết commit message có scope (common path prefix), commit/revert có chủ đích. Nguyên tắc: **agent write → git diff surface** — không để file bị thay đổi "âm thầm"; UI luôn biết agent touched gì. Khác **K Git-as-IPC** (giao tiếp qua commit) — SR là **changed-file telemetry → git UI**; khác file-watcher thuần — SR **gắn source = agent**.

## Mô tả

mya agent-changed-file git: (1) **Write hook**: mỗi edit/write tool chạm file → mark "agent-touched". (2) **Diff snapshot**: kết thúc turn/phase → `git status --porcelain` lấy changed files, so với agent-touched set → `agentChangedFiles`. (3) **IPC emit**: `{ count, files }` → UI (git panel/banner). (4) **Scope hint**: common path prefix → gợi ý commit scope. (5) **Clear**: khi commit/revert → clear banner. mya có edit/write tools + IPC transport — SR thêm **agent-write tracker** + **git-diff bridge** + **git panel UI**.

## Kiến trúc

```
  AGENT sửa file qua edit/write tool
        │ (write hook: mark agent-touched)
        ▼
  ┌─── AGENT-WRITE TRACKER ──────────────────────────────┐
  │  src/parser.rs        ✓ touched (edit)                 │
  │  tests/parser.test.ts ✓ touched (write)                │
  │  README.md            ✗ (user sửa, không phải agent)    │
  └───────────────────────┬─────────────────────────────┘
                          │ (turn end → git status)
                          ▼
  ┌─── GIT-DIFF BRIDGE (git status --porcelain) ─────────┐
  │  changed files ∩ agent-touched → AGENT_CHANGED_FILES  │
  │  { count: 2, files: [parser.rs, parser.test.ts] }     │
  └───────────────────────┬─────────────────────────────┘
                          │ (IPC emit → UI)
                          ▼
  ┌─── GIT PANEL (commit msg scope) ─────────────────────┐
  │  🔔 Agent changed 2 files                              │
  │  scope hint: src/parser (common prefix)                │
  │  [Commit] [Revert]                                     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools edit/write — file mutation (nền — SR hook ở đây)
// ✅ packages/rpc IPC transport — event channel (nền — SR emit AGENT_CHANGED_FILES)
// ✅ bash git status — diff (nền — SR snapshot changed files)

// ❌ THIẾU: agent-write tracker (mark file agent-touched, distinct from user)
// ❌ THIẾU: git-diff bridge (turn end → git status → agentChangedFiles)
// ❌ THIẾU: git panel UI (banner + list + scope hint)
// ❌ THIẾU: clear-on-commit (commit/revert → clear agent-changed banner)
```

## Implementation

```typescript
// packages/agent/src/agent-changed-files.ts (MỚI)
interface ChangedFiles { count: number; files: string[] }

class AgentChangedFileTracker {
  private agentTouched = new Set<string>();
  constructor(
    private gitStatus: (cwd: string) => Promise<string[]>, // porcelain parse
    private emit: (payload: ChangedFiles) => void,
  ) {}

  // called from edit/write tool
  markTouched(path: string): void { this.agentTouched.add(path); }

  // turn/phase end → diff agent-touched ∩ git-changed
  async snapshot(cwd: string): Promise<void> {
    const changed = await this.gitStatus(cwd);
    const agentChanged = changed.filter(f => this.agentTouched.has(f));
    if (agentChanged.length > 0) this.emit({ count: agentChanged.length, files: agentChanged });
  }

  // commit scope hint (common path prefix)
  scopeHint(files: string[]): string {
    if (files.length === 0) return '';
    const parts = files.map(f => f.split('/'));
    let prefix: string[] = [];
    for (let i = 0; i < Math.min(...parts.map(p => p.length)); i++) {
      const seg = parts[0][i];
      if (parts.every(p => p[i] === seg)) prefix.push(seg); else break;
    }
    return prefix.join('/');
  }

  clear(): void { this.agentTouched.clear(); }
}

// Usage:
// tracker.markTouched('src/parser.rs');              // edit hook
// await tracker.snapshot(cwd);                        // turn end → IPC
// → UI: "Agent changed 2 files", scope="src/parser"
// on commit/revert → tracker.clear()
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User thấy agent chạm file nào (không thay âm thầm) | ❌ Tracker state (agent-touched set phình) |
| ✅ Commit scope hint (common prefix → commit msg tốt) | ❌ Git không có sẵn (non-git workspace → no-op) |
| ✅ Phân biệt agent-touched vs user-edited | ❌ Race (user sửa giữa chừng →混 support) |
| ✅ Revert dễ (banner → 1 click) | ❌ Submodule/renames khó theo dõi |

## Khác các hướng gần

| | K Git-as-IPC | 06 File-Watcher | SR: Agent-Changed-Files |
|---|---|---|---|
| Cái gì | Giao tiếp qua commit | Watch mọi thay đổi | **Agent-touched diff → git UI** |
| Source | Commit | Any | **Agent (distinct)** |
| Đích | Coordination | Trigger | **Commit message scope** |

## Khi nào chọn

- Agent sửa file nhiều — user cần biết agent chạm gì
- Có git panel / commit workflow — muốn commit scope tự động
- Muốn phân biệt agent-touched vs user-edit (revert có chủ đích)
- Nối packages/tools edit/write (write hook) + packages/rpc IPC (emit) + git status (diff); guard non-git workspace (no-op gracefully), race (user edit giữa chừng → re-snapshot), và submodule/rename tracking; SR = agent-write telemetry cho git UI, kết hợp K Git-as-IPC
