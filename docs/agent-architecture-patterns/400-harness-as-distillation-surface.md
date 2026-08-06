# Hướng OJ: Harness as Distillation Surface — trajectory harness thực làm bề mặt distill + RL

> **Nguồn gốc:** Papers Composer (trajectory synthesis for distillation); "harness as curriculum"; "real execution trajectory distillation"; "on-policy trajectory collection"; "distillation from real runs not synthetic"
> **Coupling:** 🟡 — thêm trajectory-collection + distillation pipeline (training-time)
> **Agent-agnostic:** ⚠️ (cần model fine-tuning — model-specific)
> **Code sẵn:** ⚠️ (eval + test-harness sẵn — chưa có trajectory distillation pipeline)
> **Effort:** 5-7 tuần

## Nguồn gốc

**Composer**: thay vì distill model từ **synthetic data** (human-written examples), dùng **real execution trajectories** — harness thực chạy task → thu thập trajectory (mỗi step: state → action → outcome). Trajectory thực có **signal giàu** hơn synthetic: tool call đúng/sai, recovery từ error, multi-step reasoning verified bởi execution. **Harness as curriculum**: harness (task suite) đóng vai trò **curriculum** — task từ dễ → khó, mỗi trajectory là **bề mặt distill** (teacher model trajectory → student model học). **On-policy trajectory collection**: student tự chạy harness → trajectory → RL/DPO fine-tune. Nguyên tắc: **harness thực = distillation surface** — không cần synthetic, dùng trajectory verified bởi execution. Khác **399 OI** (RL reward) — OJ là **trajectory-level distillation** (full sequence, không chỉ reward).

## Mô tả

mya harness as distillation surface: **harness** (task suite — `packages/eval` + `tool-test-harness`) chạy task → thu thập **full trajectory** (state → action → tool-call → result → next-state → ...). (1) **Teacher run**: capable model (opus) chạy harness → high-quality trajectory (verified by execution). (2) **Distill**: student model (haiku/sonnet) học teacher trajectory — SFT (sequence-level) hoặc DPO (preferred/rejected pairs). (3) **On-policy RL**: student tự chạy → trajectory → RL fine-tune (nối 399 OI). Trajectory thực có **verified correctness** (harness check) → distillation signal đáng tin hơn synthetic. mya có `packages/eval` + `tool-test-harness` — OJ thêm **trajectory collector** + **distillation pipeline** + **curriculum ordering**.

## Kiến trúc

```
  HARNESS (task suite — packages/eval):
  ┌─────────────────────────────────────────────────────┐
  │  Task 1 (easy):   "add function to utils.ts"        │
  │  Task 2 (med):    "fix failing test in auth"        │
  │  Task 3 (hard):   "refactor module to plugin arch"  │
  │  ...                                                 │
  │  → curriculum ordering (easy → hard)                │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── TRAJECTORY COLLECTION ──────────────────────────┐
  │                                                     │
  │  TEACHER (opus — capable):                          │
  │    run harness task → full trajectory:              │
  │      step 1: read utils.ts → result                 │
  │      step 2: search similar function → result       │
  │      step 3: write function → result                │
  │      step 4: run test → PASS ✓                      │
  │    → verified trajectory (execution-grounded)       │
  │                                                     │
  │  Each trajectory = (states, actions, outcomes)      │
  │  → execution-verified (test pass = correct)         │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── DISTILLATION ───────────────────────────────────┐
  │                                                     │
  │  SFT (sequence-level):                              │
  │    student learns teacher trajectory step-by-step   │
  │    loss = −Σ log π_student(action|state)             │
  │                                                     │
  │  DPO (preference pairs):                            │
  │    preferred = teacher (verified) trajectory        │
  │    rejected = student failed trajectory             │
  │                                                     │
  │  On-policy RL (nối 399 OI):                          │
  │    student self-run → trajectory → reward → RL      │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  RESULT: student model improves — learned from
          real verified trajectories (not synthetic)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — evaluation harness (nền — OJ harness = eval suite)
// ✅ scripts/tool-test-harness — test execution (nền — OJ verification)
// ✅ 399 OI rl-execution-feedback — RL reward (nền — OJ = trajectory-level)
// ✅ 112 learning-from-corrections — learn from trajectory (nền)
// ✅ 105 self-improving-agents — self-tune (nền — OJ = distillation formalization)

// ❌ THIẾU: trajectory collector (record full state-action-outcome sequence)
// ❌ THIẾU: distillation pipeline (SFT / DPO from trajectories)
// ❌ THIẾU: curriculum ordering (task easy → hard)
// ❌ THIẾU: teacher/student model runner (capable → small distill)
```

## Implementation

```typescript
// packages/eval/src/harness-distillation.ts (MỚI)
interface TrajectoryStep {
  state: string;      // context/observation at this step
  action: string;     // tool call / reasoning / code
  outcome: string;    // tool result / error
  verified: boolean;  // execution check at this step?
}

interface Trajectory {
  taskId: string;
  steps: TrajectoryStep[];
  finalVerified: boolean;  // test pass at end?
  model: string;           // 'opus' (teacher) | 'haiku' (student)
}

class HarnessDistillation {
  // Collect trajectory — model runs task, record every step
  async collect(
    taskId: string,
    runAgent: (task: string) => AsyncIterable<{ state: string; action: string; outcome: string }>,
    verify: (trajectory: TrajectoryStep[]) => Promise<boolean>,
  ): Promise<Trajectory> {
    const steps: TrajectoryStep[] = [];
    for await (const step of runAgent(taskId)) {
      steps.push({ ...step, verified: false });
    }
    const finalVerified = await verify(steps);
    return { taskId, steps, finalVerified, model: 'teacher' };
  }

  // Distill — student learns from teacher trajectories (SFT)
  async distillSFT(
    teacherTrajectories: Trajectory[],
    fineTune: (sequences: { states: string[]; actions: string[] }[]) => Promise<void>,
  ): Promise<void> {
    // Only use verified (execution-pass) trajectories
    const verified = teacherTrajectories.filter(t => t.finalVerified);
    const sequences = verified.map(t => ({
      states: t.steps.map(s => s.state),
      actions: t.steps.map(s => s.action),
    }));
    await fineTune(sequences);
  }

  // DPO — preferred (teacher pass) vs rejected (student fail)
  async distillDPO(
    pairs: { preferred: Trajectory; rejected: Trajectory }[],
    dpoTrain: (pairs: { preferred: string[]; rejected: string[] }[]) => Promise<void>,
  ): Promise<void> {
    const formatted = pairs.map(p => ({
      preferred: p.preferred.steps.map(s => s.action),
      rejected: p.rejected.steps.map(s => s.action),
    }));
    await dpoTrain(formatted);
  }

  // Curriculum — order tasks easy → hard
  curriculum(tasks: { id: string; difficulty: number }[]): string[] {
    return tasks.sort((a, b) => a.difficulty - b.difficulty).map(t => t.id);
  }
}

// Usage:
// const teacherTraj = await distill.collect(task, runOpus, verifyTest);
// await distill.distillSFT([teacherTraj], sftFineTune);  // student learns
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Distill từ trajectory thực (verified — không synthetic) | ❌ Teacher run cost (capable model chạy harness — đắt) |
| ✅ Full sequence signal (step-level, không chỉ reward) | ❌ Trajectory storage (full state-action — large) |
| ✅ Curriculum (easy → hard — progressive learning) | ❌ Distribution shift (teacher ≠ student capability) |
| ✅ Nối 399 OI ( OJ = trajectory, OI = reward) | ❌ Verification dependency (test suite quality → distill quality) |

## Khác các hướng gần

| | 399 OI RL-Feedback | 112 Learning-Corrections | 105 Self-Improving | OJ: Harness-Distillation |
|---|---|---|---|---|
| Cái gì | RL từ execution reward | Learn from fixes | Runtime self-tune | **Trajectory distillation** |
| Signal | Scalar reward | Corrections | Prompt | **Full trajectory sequence** |
| Source | Execution | Human fix | Self | **Teacher trajectory (verified)** |
| Level | Reward | Correction | Prompt | **Sequence (SFT/DPO)** |

## Khi nào chọn

- Muốn distill capable model → small model (cost reduction)
- Có harness thực (task suite với verification — test pass)
- Muốn signal giàu (full trajectory, không chỉ scalar reward)
- Nối 399 OI (reward-level RL) + OJ (trajectory-level distillation) + 112 learning-from-corrections; teacher (opus) chạy harness → verified trajectory → SFT/DPO student (haiku); curriculum easy → hard; guard distribution shift + verification quality
