# Hướng RL: Thread-Scoped Worktree — mỗi thread là git worktree riêng, fork_thread/handoff/pin

> **Nguồn gốc:** Leaks Codex (thread = worktree, fork_thread, handoff, pin); "each thread gets own worktree"; "fork_thread creates isolated branch"; "handoff transfers work between threads"; "pin locks thread to specific commit/ref"
> **Coupling:** 🟡 — thêm worktree-per-thread isolation vào session/thread management
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session/branch sẵn — chưa có worktree-per-thread + fork/handoff/pin)
> **Effort:** 3-4 tuần

## Nguồn gốc

**Leaks Codex** mô tả: mỗi **thread** (conversation branch) có **git worktree riêng** — isolated working directory trên branch riêng. **fork_thread**: tạo thread mới = `git worktree add` (copy repo state tại commit hiện tại). **handoff**: transfer work giữa threads (cherry-pick commit hoặc merge worktree changes sang thread khác). **pin**: lock thread vào commit/ref cụ thể (thread không auto-update, stuck at pinned version). Nguyên tắc: **thread = isolated workspace** — mỗi thread chỉnh file độc lập, không xung đột với thread khác; fork/handoff/pin cho phép spawn + transfer + freeze. Khác **425 branch-tree** (session tree) — RL là **worktree isolation**; khác **478 transactional** (batch rollback) — RL là **thread-level isolation**.

## Mô tả

mya thread-scoped worktree: (1) **Thread = worktree**: mỗi conversation thread có git worktree riêng (working dir trên branch riêng). (2) **fork_thread**: agent/user tạo thread mới → `git worktree add` (isolated copy). (3) **handoff**: transfer work — cherry-pick commit từ thread A → thread B (hoặc merge worktree). (4) **pin**: lock thread vào commit (thread không pull upstream — frozen state). (5) **Cleanup**: thread close → `git worktree remove` (cleanup branch). mya có session/branch — RL thêm **worktree manager** (per-thread worktree) + **fork/handoff/pin** ops.

## Kiến trúc

```
  MAIN REPO (main branch)
  ┌─────────────────────────────────────────────┐
  │  /project/  ← main worktree (main branch)     │
  └──────────────────────┬──────────────────────┘
                         │ fork_thread
                         ▼
  ┌─── THREAD WORKTREES (each = isolated workspace) ───────────┐
  │                                                               │
  │  Thread A (worktree: /project/.worktrees/a/)                  │
  │    branch: thread-a                                            │
  │    state: editing auth.ts ← changes isolated here             │
  │                                                                │
  │  Thread B (worktree: /project/.worktrees/b/)                  │
  │    branch: thread-b (forked from A)                           │
  │    state: editing auth.ts ← independent copy, no conflict     │
  │                                                                │
  │  Thread C (PINNED at commit abc123)                           │
  │    worktree: /project/.worktrees/c/                           │
  │    branch: thread-c                                            │
  │    state: frozen (no upstream pull — stuck at abc123)         │
  │                                                                │
  └───────────────────────────────────────────────────────────────┘

  FORK_THREAD:  main → spawn Thread A (git worktree add)
  HANDOFF:      Thread A commit → cherry-pick → Thread B
  PIN:          Thread C locked at abc123 (git checkout --detach)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session/branch (packages/core) — conversation branch (nền — RL = worktree per branch)
// ✅ 425 branch-tree — session tree (nền — RL = worktree isolation per node)
// ✅ 478 transactional-sandbox — batch rollback (nền — RL = thread-level isolation)

// ❌ THIẾU: worktree manager (git worktree add per thread)
// ❌ THIẾU: fork_thread (spawn new thread = new worktree)
// ❌ THIẾU: handoff (cherry-pick/merge work between threads)
// ❌ THIẾU: pin (lock thread to commit — no upstream pull)
```

## Implementation

```typescript
// packages/agent/src/thread-worktree.ts (MỚI)
import { execSync } from 'node:child_process';

interface ThreadWorktree {
  threadId: string;
  worktreePath: string;   // isolated working dir
  branch: string;         // git branch
  pinnedCommit?: string;  // if pinned, commit hash
}

class ThreadWorktreeManager {
  private threads = new Map<string, ThreadWorktree>();
  private repoRoot: string;
  private worktreeBase: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.worktreeBase = `${repoRoot}/.worktrees`;
  }

  // fork_thread: create new thread = new worktree (isolated workspace)
  forkThread(threadId: string, fromBranch = 'main'): ThreadWorktree {
    const branch = `thread-${threadId}`;
    const worktreePath = `${this.worktreeBase}/${threadId}`;
    // git worktree add <path> -b <branch> <fromBranch>
    execSync(`git worktree add "${worktreePath}" -b "${branch}" "${fromBranch}"`, { cwd: this.repoRoot });
    const tw: ThreadWorktree = { threadId, worktreePath, branch };
    this.threads.set(threadId, tw);
    return tw;
  }

  // handoff: transfer work from source thread → target thread (cherry-pick)
  handoff(fromThread: string, toThread: string, commitHash: string): void {
    const target = this.threads.get(toThread);
    if (!target) throw new Error(`thread ${toThread} not found`);
    // cherry-pick commit from source into target worktree
    execSync(`git cherry-pick ${commitHash}`, { cwd: target.worktreePath });
  }

  // pin: lock thread to specific commit (no upstream pull — frozen)
  pin(threadId: string, commitHash: string): void {
    const tw = this.threads.get(threadId);
    if (!tw) throw new Error(`thread ${threadId} not found`);
    // detach HEAD at specific commit (frozen state)
    execSync(`git checkout ${commitHash}`, { cwd: tw.worktreePath });
    tw.pinnedCommit = commitHash;
  }

  // unpin: release pin, allow upstream updates again
  unpin(threadId: string): void {
    const tw = this.threads.get(threadId);
    if (!tw) return;
    execSync(`git checkout ${tw.branch}`, { cwd: tw.worktreePath });
    tw.pinnedCommit = undefined;
  }

  // Get worktree path for a thread (agent works in isolated dir)
  getWorktree(threadId: string): string | undefined {
    return this.threads.get(threadId)?.worktreePath;
  }

  // Cleanup: remove thread worktree
  removeThread(threadId: string): void {
    const tw = this.threads.get(threadId);
    if (!tw) return;
    execSync(`git worktree remove "${tw.worktreePath}" --force`, { cwd: this.repoRoot });
    this.threads.delete(threadId);
  }
}

// Usage:
// const mgr = new ThreadWorktreeManager('/project');
// mgr.forkThread('a');                    // Thread A = isolated worktree
// mgr.forkThread('b', 'thread-a');        // Thread B forked from A
// mgr.handoff('a', 'b', 'abc123');        // cherry-pick A's commit → B
// mgr.pin('c', 'def456');                 // Thread C frozen at def456
// // agent in Thread A edits auth.ts → isolated, no conflict with B or C
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thread isolation (mỗi thread = worktree riêng, không xung đột) | ❌ Disk overhead (mỗi worktree = copy repo) |
| ✅ fork_thread (spawn isolated workspace dễ) | ❌ Worktree management (create/remove/cleanup) |
| ✅ handoff (transfer work between threads) | ❌ Cherry-pick conflict (handoff có thể conflict) |
| ✅ pin (freeze thread state — reproducible) | ❌ Pin staleness (pinned thread miss upstream fix) |

## Khác các hướng gần

| | 425 Branch-Tree | 478 Transactional-Sandbox | RL: Thread-Worktree |
|---|---|---|---|
| Cái gì | Session tree | Batch rollback | **Worktree per thread** |
| Isolation | Session-level | Action-level | **Thread-level (git worktree)** |
| Fork/handoff | ❌ | ❌ | ✅ fork_thread + handoff |

## Khi nào chọn

- Multi-thread agent (nhiều conversation branch chỉnh song song)
- Muốn isolation (thread không xung đột file)
- Cần fork/handoff/pin (spawn + transfer + freeze threads)
- Nối session/branch (RL = worktree per branch) + 425 branch-tree (RL = worktree per tree node); guard disk overhead (cleanup removed thread worktree) + handoff conflict (cherry-pick fail → manual resolve)
