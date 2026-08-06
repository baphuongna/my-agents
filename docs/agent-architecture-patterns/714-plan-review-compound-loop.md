# Hướng AAL: Plan-Review Compound Loop — brainstorm → plan → work → code-review → compound với 80/20 effort

> **Nguồn gốc:** compound-engineering-plugin (README.md) | **Coupling:** 🟡 — thêm vòng lặp lifecycle quanh agent loop | **Agent-agnostic:** ⚠️ — cần plan/review workflow chuẩn | **Code sẵn:** ⚠️ (có workflows + subagent — chưa có compound loop) | **Effort:** 2-3 tuần

## Nguồn gốc

**compound-engineering-plugin** có vòng lặp cốt lõi: **brainstorm → plan → work → code-review → compound** (ghi lại bài học). Phân bổ effort: **80% cho planning/review, 20% cho execution** — mỗi unit công việc làm **unit sau dễ hơn** (compound: bài học tích lũy giảm chi phí lần sau). Nguyên tắc: **học có chủ đích qua từng vòng** — không chỉ hoàn thành task mà còn làm cho pipeline tự cải thiện.

## Mô tả

mya plan-review compound loop: packages/workflows đã có runner (workflow JS file). AAL thêm **lifecycle wrapper**: mỗi task chạy qua 5 pha — `brainstorm` (đề xuất hướng, dùng council/adversarial để phản biện), `plan` (steps + repo-relative paths), `work` (execution, worktree/subagent), `code-review` (reviewer persona theo diff — nối AAM), `compound` (ghi lesson vào skill/memory — dùng memory dream-cycle + skills curator). Budget: 80% planning/review, 20% execution — đo bằng iteration budget. Compound output là skill mới/cập nhật → lần sau rẻ hơn.

## Kiến trúc

```
  TASK
   │
   ▼
  ┌─── 80% ────────────────────────────────────────────┐
  │  1. brainstorm — đề xuất hướng + phản biện          │
  │  2. plan — steps, repo-relative paths, risk         │
  │  3. code-review — reviewer persona theo diff (AAM)  │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── 20% ────────────────────────────────────────────┐
  │  4. work — execution (worktree/subagent)            │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── COMPOUND ───────────────────────────────────────┐
  │  5. ghi lesson → skill/memory (dream-cycle + curator)│
  │     → unit sau dễ hơn (chi phí giảm dần)            │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — workflow execution (nền cho loop)
// ✅ packages/agent subagent-rounds.ts — subagent execution (nền cho work)
// ✅ packages/council council.ts + adversarial.ts — phản biện (nền brainstorm/review)
// ✅ packages/council hindsight.ts — review answer (nền code-review)
// ✅ packages/memory dream-cycle.ts — consolidation (nền compound)
// ✅ packages/skills curator.ts — skill update (nền compound)
// ✅ packages/core iteration-budget.ts — budget 80/20 (nền phân bổ)

// ❌ THIẾU: 5-pha lifecycle orchestrator
// ❌ THIẾU: compound step (lesson → skill/memory)
```

## Implementation

```typescript
// packages/workflows/src/compound-loop.ts (NEW)
import type { IterationBudget } from "@my-agent/core";

export type CompoundPhase = "brainstorm" | "plan" | "work" | "review" | "compound";

export interface CompoundTask {
  id: string;
  prompt: string;
  /** Ghi chú từ unit trước — làm unit này rẻ hơn. */
  inheritedLessons: string[];
}

export interface CompoundResult {
  phaseCosts: Record<CompoundPhase, number>; // iterations per phase
  lesson: string | null;                      // compound output
}

const PLANNING_PHASES: readonly CompoundPhase[] = ["brainstorm", "plan", "review"];

/** Phân bổ 80/20: planning+review chiếm 80% budget, work 20%. */
export function allocateBudget(budget: IterationBudget, total: number): Record<CompoundPhase, number> {
  const planning = Math.floor(total * 0.8);
  const perPlanning = Math.floor(planning / PLANNING_PHASES.length);
  return { brainstorm: perPlanning, plan: perPlanning, review: planning - perPlanning * 2, work: total - planning, compound: 1 };
}

/** Chạy loop 5 pha — mỗi pha tiêu budget của nó. */
export async function runCompoundLoop(task: CompoundTask, budget: IterationBudget, run: (phase: CompoundPhase, prompt: string) => Promise<string>): Promise<CompoundResult> {
  const alloc = allocateBudget(budget, budget.remaining());
  const phaseCosts = { brainstorm: 0, plan: 0, work: 0, review: 0, compound: 0 } as Record<CompoundPhase, number>;
  let lesson: string | null = null;

  for (const phase of ["brainstorm", "plan", "work", "review"] as const) {
    let used = 0;
    while (used < alloc[phase] && budget.consume()) {
      const prompt = phase === "brainstorm"
        ? `${task.prompt}\nLessons từ trước:\n${task.inheritedLessons.join("\n")}`
        : phase === "compound" ? "" : task.prompt;
      const out = await run(phase, prompt);
      if (phase === "review" && /lesson:/i.test(out)) lesson = out; // review rút bài học
      used++;
    }
    phaseCosts[phase] = used;
  }
  // Compound: budget.consume() một lần — ghi lesson
  if (lesson && budget.consume()) {
    await run("compound", `Ghi lesson vào skill store: ${lesson}`);
    phaseCosts.compound = 1;
  }
  return { phaseCosts, lesson };
}
// Guard: mỗi pha tiêu budget riêng — work không nuốt planning budget
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Quality cao: 80% vào plan/review trước khi code | ❌ Execution ít budget — task đơn giản chạy chậm hơn |
| ✅ Compound: lesson tích lũy → unit sau rẻ hơn | ❌ Phải thiết kế lesson format (skill? memory?) |
| ✅ Phản biện trước khi làm (council/adversarial) | ❌ Loop nhiều pha — latency tăng mỗi task |
| ✅ Phân bổ đo được (iteration budget) | ❌ Over-engineering cho task trivial |

## Khác các hướng gần

| | Workflow runner | AAL: Compound Loop |
|---|---|---|
| Output | Task hoàn thành | **Task + lesson compound** |
| Budget | Toàn execution | **80/20 planning/review** |
| Học | Không | **Mỗi vòng ghi bài học** |
| Mối quan hệ | Nền | **Lifecycle wrapper trên runner** |

## Khi nào chọn

- Task phức tạp — cần plan/review trước khi execution
- Muốn agent tự cải thiện qua các vòng (compound learning)
- Đã có workflows + council + memory — ghép thành loop
- Guard: task trivial bypass loop (đi thẳng work), lesson format chuẩn, budget per-phase không vượt
