# Hướng AAN: Worktree-Based Execution — ce-work thực thi plan trong worktrees, phân loại complexity để chọn route

> **Nguồn gốc:** compound-engineering-plugin (plugins/compound-engineering/skills/ce-work/SKILL.md) | **Coupling:** 🟡 — thêm worktree execution vào workflow runner | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có subagent + workflows — chưa có worktree + complexity routing) | **Effort:** 2 tuần

## Nguồn gốc

**compound-engineering-plugin** lệnh **ce-work** thực thi plan **trong worktrees** với task tracking. Trước khi chạy, **phân loại complexity** (**trivial / small-medium / large**) để chọn route: (1) **task list** — chia nhỏ theo dõi; (2) **implement thẳng** — không cần plan rườm rà; (3) **đề nghị brainstorm/plan trước** — task lớn chưa đủ rõ. Worktree cho phép nhiều task chạy song song không đụng main working tree; task tracking theo dõi trạng thái từng task. Nguyên tắc: **route theo độ phức tạp** — không dùng một quy trình cho mọi task.

## Mô tả

mya worktree-based execution: packages/agent subagent-rounds.ts + packages/workflows runner.ts có execution nền. AAN thêm: (1) **complexity classifier** — đoán trivial/small-medium/large từ plan (số bước, files đụng, risk keyword); (2) **route selector** — trivial → implement thẳng; small-medium → task list + worktree; large → yêu cầu brainstorm/plan trước (nối AAL); (3) **worktree executor** — `git worktree add` per task, chạy trong đó, merge khi xong; (4) **task tracking** — mỗi task {id, status, worktree, branch}. Permission gate vẫn chạy — worktree không bypass tool permission.

## Kiến trúc

```
  PLAN
   │
   ▼
  ┌─── COMPLEXITY CLASSIFIER ─────────────────────────┐
  │  trivial      → implement thẳng (không worktree)   │
  │  small-medium → task list + worktree               │
  │  large        → đề nghị brainstorm/plan trước      │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── WORKTREE EXECUTOR ─────────────────────────────┐
  │  git worktree add <task-branch>                   │
  │  chạy task trong worktree (subagent)              │
  │  task tracking: {id, status, worktree, branch}    │
  │  merge khi task xong → xóa worktree               │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent subagent-rounds.ts — execution (nền chạy task)
// ✅ packages/workflows runner.ts — workflow run (nền route)
// ✅ packages/workflows worker.ts — worker_thread execution (nền isolation)
// ✅ packages/core iteration-budget.ts — budget (nền complexity cap)
// ✅ packages/tools codeexec.ts — bidirectional bridge (nền task loop)

// ❌ THIẾU: complexity classifier (trivial/small/large)
// ❌ THIẾU: worktree executor (git worktree add/merge/remove)
// ❌ THIẾU: task tracking (status per task)
```

## Implementation

```typescript
// packages/workflows/src/worktree-exec.ts (NEW)
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export type Complexity = "trivial" | "small-medium" | "large";

export interface PlanSummary { steps: number; touchedFiles: string[]; hasRiskKeywords: boolean }

const RISK_RE = /\b(drop|delete|migrat|refactor|rewrite|force|permission|auth)\b/i;

/** Phân loại complexity từ plan — quyết định route. */
export function classifyComplexity(p: PlanSummary): Complexity {
  if (p.steps <= 2 && !p.hasRiskKeywords) return "trivial";
  if (p.steps <= 6 && p.touchedFiles.length <= 8) return "small-medium";
  return "large";
}

/** Chọn route theo complexity. */
export function selectRoute(c: Complexity): "direct" | "tasks" | "plan-first" {
  switch (c) {
    case "trivial": return "direct";
    case "small-medium": return "tasks";
    case "large": return "plan-first";
  }
}

export interface WorktreeTask { id: string; branch: string; path: string; status: "pending" | "running" | "done" | "failed" }

/** Tạo worktree cho task — cách ly khỏi main working tree. */
export function createTaskWorktree(baseBranch: string, baseDir: string): WorktreeTask {
  const id = randomUUID().slice(0, 8);
  const branch = `task/${id}`;
  execFileSync("git", ["worktree", "add", "-b", branch, `${baseDir}/.wt/${id}`], { cwd: baseDir });
  return { id, branch, path: `${baseDir}/.wt/${id}`, status: "pending" };
}

/** Chạy task trong worktree qua executor — merge khi xong. */
export async function runInWorktree(
  task: WorktreeTask,
  run: (worktreePath: string) => Promise<boolean>,
  baseDir: string,
): Promise<"done" | "failed"> {
  task.status = "running";
  const ok = await run(task.path);
  task.status = ok ? "done" : "failed";
  if (ok) {
    execFileSync("git", ["-C", task.path, "add", "-A"]);
    execFileSync("git", ["-C", task.path, "commit", "-m", `task ${task.id}`, "--allow-empty"]);
    execFileSync("git", ["-C", baseDir, "merge", task.branch, "--no-edit"]);
  }
  execFileSync("git", ["worktree", "remove", task.path, "--force"], { cwd: baseDir });
  return task.status;
}
// Route: trivial → run trực tiếp; tasks → worktree; plan-first → trả về đề nghị
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cách ly task — không đụng main tree khi fail | ❌ Git worktree overhead (branch/merge management) |
| ✅ Route theo complexity — trivial không bị rườm rà | ❌ Classifier heuristic — task ranh giới dễ sai |
| ✅ Nhiều task song song không conflict | ❌ Merge conflict vẫn phải xử lý thủ công |
| ✅ Task tracking rõ trạng thái | ❌ Worktree + permission phải test kỹ (không bypass gate) |

## Khác các hướng gần

| | Subagent (trong process) | AAN: Worktree Execution |
|---|---|---|
| Isolation | Session riêng | **Git worktree riêng** |
| Route | Một cách | **Theo complexity** |
| Merge | Không (cùng tree) | **Merge khi done** |
| Mối quan hệ | Nền | **Bổ sung isolation + routing** |

## Khi nào chọn

- Nhiều task chạy song song cần cách ly file-level
- Task phức tạp khác nhau — không muốn một quy trình cho tất cả
- Đã có subagent + workflows — thêm worktree executor + classifier
- Guard: worktree không bypass permission gate, merge conflict fallback, classify test phủ ranh giới
