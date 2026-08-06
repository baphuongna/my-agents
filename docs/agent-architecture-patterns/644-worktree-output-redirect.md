# Hướng XT: Worktree Output Redirect — Phát hiện git worktree bằng cách so git-dir với git-common-dir, redirect output graph về main repo root

> **Nguồn gốc:** Understand-Anything (worktree detection + output redirect) | **Coupling:** 🟢 — thêm worktree-aware path resolver, không đụng graph build | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có tools path — chưa có worktree detection) | **Effort:** 1 tuần

## Nguồn gốc

**Understand-Anything** gặp vấn đề: khi user chạy trong **git worktree** (linked working tree), output (graph, intermediate) ghi vào worktree dir sẽ **không thấy** từ main repo — mỗi worktree có graph riêng, mất tích khi worktree xóa. Giải pháp: phát hiện worktree bằng **so sánh `git rev-parse --git-dir` vs `--git-common-dir`** — nếu khác (git-dir = `.git` trong worktree, git-common-dir = main `.git`) thì đang ở worktree → **redirect output về main repo root** (resolve common-dir → repo root). Nguyên tắc: **output về main, phân tích ở worktree** — graph trung tâm, không phân mảnh theo worktree.

## Mô tả

mya worktree output redirect: khi build graph / ghi intermediate, detect worktree (git-dir ≠ git-common-dir) → resolve **main repo root** từ git-common-dir → ghi output (graph, cache, SECURITY.md) vào main root. Nhờ đó mọi worktree chia sẻ graph chung — phân tích 1 lần, dùng nhiều nơi. mya có packages/tools (file/path tools) — XT thêm **worktree detector** + **main-root resolver** + **output redirect**.

## Kiến trúc

```
  WORKTREE: /repo-wt/feature-x    (linked working tree)
        │
        ▼
  ┌─── DETECT WORKTREE ────────────────────────────────────┐
  │  gitDir     = git rev-parse --git-dir     → .git (wt)   │
  │  commonDir  = git rev-parse --git-common-dir → /repo/.git│
  │  if gitDir != commonDir → IS WORKTREE                    │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── RESOLVE MAIN ROOT ──────────────────────────────────┐
  │  commonDir = /repo/.git                                  │
  │  mainRoot  = dirname(commonDir) = /repo                  │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── REDIRECT OUTPUT ────────────────────────────────────┐
  │  ❌ KHÔNG:  /repo-wt/feature-x/.mya/graph.json           │
  │  ✅ CÓ:    /repo/.mya/graph.json        ← main root      │
  │  → mọi worktree chia sẻ graph chung                      │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools — path/file tools (nền — XT resolver dùng)
// ✅ packages/tools codegraph.ts — buildCodegraph(root) (nền — XT root = main root)
// ✅ packages/agent — cwd resolution (nền — XT detect worktree ở đây)
// ✅ packages/sync — git ops (nền — XT git rev-parse analog)

// ❌ THIẾU: worktree detector (git-dir vs git-common-dir)
// ❌ THIẾU: main-root resolver (common-dir → repo root)
// ❌ THIẾU: output redirect (write vào main root, không worktree)
```

## Implementation

```typescript
// packages/tools/src/worktree-redirect.ts (MỚI)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
const exec = promisify(execFile);

async function gitVar(cwd: string, name: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", `--${name}`], { cwd });
  return stdout.trim();
}

interface WorktreeInfo { isWorktree: boolean; mainRoot?: string }

async function detectWorktree(cwd: string): Promise<WorktreeInfo> {
  const [gitDir, commonDir] = await Promise.all([
    gitVar(cwd, "git-dir").catch(() => ""),
    gitVar(cwd, "git-common-dir").catch(() => ""),
  ]);
  // gitDir ≠ commonDir → linked worktree
  if (gitDir && commonDir && resolve(cwd, gitDir) !== resolve(cwd, commonDir)) {
    const mainRoot = dirname(resolve(cwd, commonDir)); // /repo/.git → /repo
    return { isWorktree: true, mainRoot };
  }
  return { isWorktree: false };
}

async function outputRoot(cwd: string, sub: string): Promise<string> {
  const wt = await detectWorktree(cwd);
  const root = wt.isWorktree && wt.mainRoot ? wt.mainRoot : cwd;
  return resolve(root, sub);
}

// Usage:
// const graphPath = await outputRoot(process.cwd(), ".mya/graph.json");
// // worktree → /repo/.mya/graph.json (main); non-worktree → cwd/.mya/graph.json
// await writeFile(graphPath, JSON.stringify(graph));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Graph trung tâm (mọi worktree chia sẻ) | ❌ Path confusion (output ở main, phân tích ở wt) |
| ✅ Survive worktree delete (graph ở main) | ❌ Race condition (2 worktree build cùng lúc) |
| ✅ Một lần build (không rebuild mỗi worktree) | ❌ Permission (worktree user ≠ main owner) |
| ✅ Consistent view (dashboard từ main root) | ❌ Stale (main graph ≠ worktree state nếu wt đổi nhiều) |

## Khác các hướng gần

| | Per-cwd output | XT: Worktree Redirect | Symlink hack |
|---|---|---|---|
| Worktree-aware | ❌ | **✅ (git-dir diff)** | ⚠️ (fragile) |
| Graph trung tâm | ❌ (phân mảnh) | **✅ (main root)** | ⚠️ |
| Survive wt delete | ❌ | **✅** | ❌ |

## Khi nào chọn

- User dùng git worktree (feature branch isolate) → cần graph chung
- Muốn output survive (graph ở main root, không bị xóa với worktree)
- Dashboard serve từ main root (640 XP) → cần output ở main
- Nối packages/tools + packages/sync + packages/agent (cwd); guard race-write (lock khi nhiều worktree build cùng graph), permission-check (main root writable), và stale-detection (worktree đổi nhiều → invalidate main graph + rebuild); XT = worktree output redirect, kết hợp 640 XP token-gated-dashboard (dashboard serve main root) + 639 XO incremental-fingerprint-analysis (graph main update incrementally)
