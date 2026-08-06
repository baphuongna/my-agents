# Hướng AHK: Delegated Subagent Protocol — chain step có thể delegate sang subagent với worktree support cho parallel delegation — mỗi nhánh parallel chạy worktree riêng cô lập

> **Nguồn gốc:** pi-prompt-template-model | **Coupling:** 🔴 — bind vào subagent spawn + git worktree | **Agent-agnostic:** ❌ (cốt lõi agent delegation) | **Code sẵn:** ⚠️ (mya có spawnSubagent + workflows parallel, nhưng KHÔNG có worktree-per-branch isolation) | **Effort:** 2 tuần

## Nguồn gốc

**pi-prompt-template-model** chain step có thể **delegate sang subagent**. Khi delegation trong **parallel branch**, mỗi nhánh chạy **git worktree riêng** — cô lập filesystem (mỗi branch checkout dir độc lập, không xung đột file khi chạy song song). Worktree = `git worktree add <dir> <branch>` → nhiều working directory cùng repo, branch khác nhau, thay đổi file không đè nhau. Pattern này cho **parallel delegation an toàn**: N subagent cùng sửa code mà không conflict filesystem.

Nguyên tắc: **delegate sang subagent** (mỗi step = task focused); **worktree per parallel branch** (cô lập fs); **parallel-safe** (không conflict file); **cleanup worktree** (xóa dir khi xong).

## Mô tả

Với mya, packages/agent `index.ts` có `spawnSubagent(goal, { allowedTools, signal })` + `maxSpawnDepth` (depth control), và packages/workflows `runner.ts` có `parallel(tasks)` + `agent(goal)` (spawn). Nhưng mya **chưa có** **worktree-per-branch isolation**: mỗi parallel delegation branch chạy trong git worktree riêng (cô lập fs). Pattern này cho parallel subagent cùng sửa code an toàn.

## Kiến trúc (ASCII)

```
  chain: step1 -> parallel(delegateA, delegateB) -> merge
                        │              │
                        ▼              ▼
              spawnSubagent(A)   spawnSubagent(B)
                  │ worktree       │ worktree
                  ▼                ▼
              /tmp/wt-A/        /tmp/wt-B/      ← git worktree riêng, cô lập fs
              (branch-A)        (branch-B)
                  │ sửa file       │ sửa file (không conflict)
                  ▼                ▼
              output A          output B → merge
  ── cleanup: git worktree remove /tmp/wt-A /tmp/wt-B
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent/src/index.ts — spawnSubagent(goal, { allowedTools, signal }) + maxSpawnDepth
// ✅ packages/workflows/src/runner.ts — parallel(tasks) + agent(goal) spawn (line 93+)
// ✅ packages/agent/src/subagent.test.ts — subagent lifecycle tested
// ⚠️ KHÔNG có worktree-per-branch isolation (cô lập fs cho parallel delegation)
// ❌ KHÔNG có git worktree create/cleanup lifecycle cho delegate branch
```

## Implementation

```typescript
// packages/agent/src/worktree-delegation.ts (NEW)
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WorktreeBranch { dir: string; branch: string; cleanup(): void; }

/** Tạo git worktree riêng cho một parallel delegation branch (cô lập fs). */
export function createWorktree(repoRoot: string, branchName: string): WorktreeBranch {
  const dir = mkdtempSync(join(tmpdir(), "mya-wt-"));
  const branch = `mya/delegate/${branchName}`;
  execSync(`git -C ${repoRoot} worktree add -b ${branch} ${dir}`, { stdio: "pipe" });
  return {
    dir, branch,
    cleanup: () => {
      try { execSync(`git -C ${repoRoot} worktree remove --force ${dir}`, { stdio: "pipe" }); } catch {}
      try { execSync(`git -C ${repoRoot} branch -D ${branch}`, { stdio: "pipe" }); } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Delegate song song: mỗi task → worktree riêng → spawnSubagent trong dir đó. */
export async function parallelDelegated(
  agent: { spawnSubagent(goal: string, o?: { cwd?: string }): { wait(): Promise<string> } },
  repoRoot: string,
  tasks: Array<{ name: string; goal: string }>,
): Promise<string[]> {
  const branches = tasks.map((t) => ({ t, wt: createWorktree(repoRoot, t.name) }));
  try {
    const handles = branches.map(({ t, wt }) => agent.spawnSubagent(t.goal, { cwd: wt.dir }));
    return await Promise.all(handles.map((h) => h.wait()));   // song song, fs cô lập
  } finally {
    branches.forEach(({ wt }) => wt.cleanup());               // luôn cleanup worktree
  }
}
// Hook workflow parallel: parallelDelegated(agent, repoRoot, [{name, goal}, ...]);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parallel delegation an toàn (không conflict fs) | ❌ Git worktree overhead (create/cleanup) |
| ✅ Mỗi branch checkout độc lập (review/merge riêng) | ❌ Cleanup leak nếu crash (orphan worktree) |
| ✅ Cô lập thay đổi file giữa subagent | ❌ Disk space (N worktree = N× repo size) |

## Khác các hướng gần

| | AHK Delegated Subagent | AHL Spawn Allowlist | AHM Fanout Semaphore |
|---|---|---|---|
| Trọng tâm | Worktree-per-branch cô lập | Giới hạn agent spawnable | Bound parallel subagent |
| Cơ chế | git worktree + spawnSubagent | subagent_agents allowlist + env | maxConcurrency semaphore |
| Quan hệ | Nối delegation isolation | Nối spawn permission | Nối parallel bound |

## Khi nào chọn

- Parallel subagent cùng sửa code → cần cô lập fs (worktree)
- Mỗi delegation branch checkout riêng (review/merge độc lập)
- Tránh conflict file khi N subagent chạy song song
- Guard: worktree create/cleanup luôn (try/finally), depth limit, disk budget, merge strategy rõ
