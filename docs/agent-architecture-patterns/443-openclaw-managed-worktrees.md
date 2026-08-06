# Hướng QA: Managed Worktrees — mỗi task 1 git worktree riêng + worktreeinclude chèn config

> **Nguồn gốc:** OpenClaw (managed worktrees, worktreeinclude); "git worktree per task"; "parallel isolated workspaces"; "worktree-level config injection"; "multi-agent repo isolation"
> **Coupling:** 🟡 — cần git worktree management + config injection layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (git tools + bash sẵn — chưa có worktree lifecycle manager + worktreeinclude)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenClaw** cấp mỗi task/agent 1 **git worktree** riêng: cùng repo nhưng **working directory độc lập** → nhiều agent sửa song song không xung đột file. Git worktree (`git worktree add`) cho phép nhiều checkout của cùng repo trên disk. **worktreeinclude**: cơ chế **chèn config** vào mỗi worktree (`.agent.toml`, env, tool config) khi tạo — mỗi worktree có config riêng (tool whitelist, permission scope). Giống **container isolation** nhưng ở filesystem level (git worktree). Nguyên tắc: **isolation bằng filesystem, không bằng process** — mỗi agent có cây file riêng. Khác **86 agent-topology** (agent orchestration) — QA là **workspace isolation**; khác **124 dynamic-permissions** (per-tool auth) — QA là **per-worktree config**.

## Mô tả

mya managed worktrees: khi task cần sửa code → **worktree manager** tạo worktree mới (`git worktree add ../task-NNN`). **worktreeinclude** đọc template config + inject vào worktree (`.mya/worktree.toml`: tool whitelist, permission scope, branch name). Agent chạy trong worktree đó → thay đổi không ảnh hưởng worktree khác. Khi task xong → **merge** (worktree branch → main) hoặc **cleanup** (git worktree remove). Nhiều agent song song → nhiều worktree, 0 xung đột. Nối 86 agent-topology + 124 dynamic-permissions + git tools.

## Kiến trúc

```
  REPO: /home/bom/my-agent/
  ├── .git/                      (shared object store)
  ├── src/                       (main worktree — main branch)
  │
  ├── ../worktrees/task-A/       (worktree — branch task-A)
  │   ├── src/                   (isolated checkout)
  │   └── .mya/worktree.toml     (← worktreeinclude injected)
  │       tool-whitelist: [read, edit, bash]
  │       permission-scope: src/auth/
  │
  ├── ../worktrees/task-B/       (worktree — branch task-B)
  │   ├── src/                   (isolated checkout)
  │   └── .mya/worktree.toml     (← worktreeinclude injected)
  │       tool-whitelist: [read, grep, test]
  │       permission-scope: src/api/
  │
  AGENT-A runs in task-A/  ──►  edits src/auth/  (no conflict)
  AGENT-B runs in task-B/  ──►  edits src/api/   (no conflict)
  → parallel, isolated, 0 file conflict
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ git tools (bash git) — git worktree add/remove (nền)
// ✅ 86 agent-topology — multi-agent orchestration (nền — QA = workspace layer)
// ✅ 124 dynamic-permissions — per-tool auth (nền — QA = per-worktree config)
// ✅ 396 repository-graph-planning — repo analysis (relate)

// ❌ THIẾU: worktree lifecycle manager (create/merge/cleanup)
// ❌ THIẾU: worktreeinclude (config injection per worktree)
// ❌ THIẾU: worktree-level permission scoping (tool whitelist per worktree)
// ❌ THIẾU: worktree registry (track active worktrees, cleanup orphan)
```

## Implementation

```typescript
// packages/agent/src/worktree-manager.ts (NEW)
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

interface WorktreeConfig {
  branch: string;
  path: string;
  toolWhitelist: string[];
  permissionScope: string;   // allowed subpaths
}

class WorktreeManager {
  private registry = new Map<string, WorktreeConfig>();

  create(taskId: string, baseBranch: string, includeConfig?: Record<string, unknown>): WorktreeConfig {
    const branch = `task-${taskId}`;
    const wtPath = join(this.repoRoot, '..', 'worktrees', `task-${taskId}`);
    // git worktree add
    execSync(`git worktree add -b ${branch} ${wtPath} ${baseBranch}`, { cwd: this.repoRoot });
    // worktreeinclude: inject config into worktree
    if (includeConfig) {
      mkdirSync(join(wtPath, '.mya'), { recursive: true });
      writeFileSync(join(wtPath, '.mya', 'worktree.toml'), this.serializeToml(includeConfig));
    }
    const config: WorktreeConfig = {
      branch, path: wtPath,
      toolWhitelist: (includeConfig?.['toolWhitelist'] as string[]) ?? ['read', 'edit', 'bash'],
      permissionScope: (includeConfig?.['permissionScope'] as string) ?? '.',
    };
    this.registry.set(taskId, config);
    return config;
  }

  merge(taskId: string, targetBranch: string): void {
    const cfg = this.registry.get(taskId);
    if (!cfg) throw new Error(`Worktree ${taskId} not found`);
    execSync(`git checkout ${targetBranch} && git merge ${cfg.branch}`, { cwd: this.repoRoot });
    this.cleanup(taskId);
  }

  cleanup(taskId: string): void {
    const cfg = this.registry.get(taskId);
    if (!cfg) return;
    if (existsSync(cfg.path)) {
      execSync(`git worktree remove ${cfg.path} --force`, { cwd: this.repoRoot });
    }
    this.registry.delete(taskId);
  }

  list(): WorktreeConfig[] { return [...this.registry.values()]; }
  private serializeToml(obj: Record<string, unknown>): string { return ''; /* TOML serialize */ }
  private repoRoot = process.cwd()!;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parallel isolation (nhiều agent sửa song song, 0 conflict) | ❌ Disk space (mỗi worktree = full checkout) |
| ✅ Per-worktree config (tool whitelist, permission scope riêng) | ❌ Merge complexity (worktree branch → main) |
| ✅ Safe experimentation (worktree dùng thử, xóa nếu hỏng) | ❌ Orphan cleanup (quên remove → rác disk) |
| ✅ Atomic task boundary (mỗi task = 1 worktree = 1 branch) | ❌ Cross-worktree deps (agent A cần file agent B đang sửa) |

## Khác các hướng gần

| | 86 Agent-Topology | 124 Dynamic-Permissions | 396 Repo-Graph | QA: Worktrees |
|---|---|---|---|---|
| Trọng tâm | Agent orchestration | Per-tool auth | Repo analysis | **Workspace isolation** |
| Isolation | Process | Tool-level | — | **Filesystem (git worktree)** |
| Config | Global | Per-tool | — | **Per-worktree (worktreeinclude)** |

## Khi nào chọn

- Nhiều agent sửa code song song trong cùng repo
- Cần isolation (thử nghiệm không ảnh hưởng main)
- Mỗi task cần config/permission riêng (scoped)
- Muốn atomic task boundary (1 task = 1 branch = 1 worktree)
- Nối 86 agent-topology + 124 dynamic-permissions + 396 repository-graph-planning
