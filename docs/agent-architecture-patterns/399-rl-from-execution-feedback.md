# Hướng OI: RL from Execution Feedback — RL từ compiler/test/fuzzer feedback

> **Nguồn gốc:** Papers RLTF (Reinforcement Learning from Test/Execution Feedback); RLCEF; "compiler-in-the-loop"; "execution-grounded reward"; "fuzzer feedback reward"; "environment-grounded RL for code"
> **Coupling:** 🟡 — thêm RL reward-from-execution layer (training-time, không chạm inference core)
> **Agent-agnostic:** ⚠️ (cần model fine-tuning pipeline — model-specific)
> **Code sẵn:** ⚠️ (tool-test-harness + eval sẵn — chưa có RL reward pipeline + execution-grounded training loop)
> **Effort:** 6-8 tuần

## Nguồn gốc

**RLTF**: thay vì RL từ human preference (RLHF — chậm, đắt) hoặc từ rule-based reward (dễ game), dùng **execution feedback** làm reward — compiler (compile pass?), test suite (test pass?), fuzzer (crash/inconsistency?), type checker (type safe?). Reward **đến từ môi trường thực**, không phải heuristic. **RLCEF** (RL from Compiler/Execution Feedback): compiler error/warning → negative reward, clean compile → positive. **Fuzzer feedback**: fuzzer tìm crash → negative reward cho code gây crash. Nguyên tắc: **ground truth là execution** — model học từ "code có chạy đúng không", không từ "human thích không". Khác **105 self-improving** (runtime self-tune) — OI là **training-time RL**; khác **398 OH test-gated** (inference convergence) — OI là **model training**.

## Mô tả

mya RL from execution feedback: **training pipeline** thu thập execution outcome (compile result, test result, fuzzer result) → compute **execution-grounded reward** → fine-tune model (policy gradient / DPO). (1) **Sample trajectories**: model generate code for tasks. (2) **Execute**: compile + test + fuzz each sample. (3) **Compute reward**: compile pass +1, test pass +0.5 each, fuzz stable +0.3, crash −1. (4) **Fine-tune**: RL update (reward → policy gradient) hoặc DPO (preferred/rejected pairs từ execution outcome). Không chạm inference core — chỉ training-time. mya có `tool-test-harness` + `packages/eval` — OI thêm **execution reward pipeline** + **RL training loop**.

## Kiến trúc

```
  TRAINING LOOP (offline, not inference):
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  ① SAMPLE: model generates code for task batch      │
  │     task → model → code_candidate                   │
  │                                                     │
  │  ② EXECUTE: run each candidate in sandbox           │
  │     ┌─ compiler ──→ compile pass/fail?             │
  │     ├─ test suite → N passed / M failed?           │
  │     ├─ type check → type safe?                     │
  │     └─ fuzzer ────→ crash? inconsistency?           │
  │                                                     │
  │  ③ COMPUTE REWARD (execution-grounded):             │
  │     reward = w₁·compile_pass                        │
  │            + w₂·test_pass_ratio                     │
  │            + w₃·type_safe                            │
  │            + w₄·fuzz_stable                          │
  │            − w₅·crash_penalty                        │
  │                                                     │
  │  ④ FINE-TUNE (policy gradient / DPO):               │
  │     RL update: ∇θ J = E[reward · ∇log π(code|task)] │
  │     OR DPO: prefer high-reward over low-reward      │
  │                                                     │
  │  ⑤ REPEAT → model improves at writing correct code  │
  └─────────────────────────────────────────────────────┘

  REWARD SOURCES (all execution-grounded):
    compiler:  error/warning count → negative
    test:      pass ratio → positive
    type:      type errors → negative
    fuzzer:    crash found → strong negative
    runtime:   timeout/oom → negative
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ scripts/tool-test-harness — test execution (nền — OI reward from test)
// ✅ packages/eval — evaluation harness (nền — OI reward measurement)
// ✅ 117 toolchain-feedback-loop — compile/test feedback (nền — OI reward source)
// ✅ 110 process-reward — reward signal (nền — OI = execution-grounded reward)
// ✅ 112 learning-from-corrections — learn from fixes (nền — OI = RL formalization)

// ❌ THIẾU: execution reward pipeline (compile/test/fuzz → reward score)
// ❌ THIẾU: RL training loop (policy gradient / DPO fine-tune)
// ❌ THIẾU: sandbox execution (isolate code execution for reward)
// ❌ THIẾU: trajectory buffer (collect samples + rewards for training)
```

## Implementation

```typescript
// packages/eval/src/rl-execution-feedback.ts (MỚI)
interface ExecutionOutcome {
  compilePass: boolean;
  compileErrors?: number;
  testPassed: number;
  testTotal: number;
  typeErrors?: number;
  fuzzCrash?: boolean;
  runtimeMs?: number;
  timeout?: boolean;
}

interface Trajectory {
  task: string;
  code: string;
  outcome: ExecutionOutcome;
  reward: number;
}

class RLExecutionFeedback {
  // Compute execution-grounded reward
  computeReward(outcome: ExecutionOutcome): number {
    const w = { compile: 1.0, test: 0.5, type: 0.3, fuzz: 0.4, crash: -1.0, timeout: -0.5 };
    let reward = 0;
    reward += w.compile * (outcome.compilePass ? 1 : -1);
    reward += w.test * (outcome.testTotal > 0 ? outcome.testPassed / outcome.testTotal : 0);
    reward -= w.type * (outcome.typeErrors ?? 0) * 0.1;
    reward += w.fuzz * (outcome.fuzzCrash ? -1 : 1);
    if (outcome.fuzzCrash) reward += w.crash;
    if (outcome.timeout) reward += w.timeout;
    return reward;
  }

  // Execute code in sandbox → outcome
  async execute(task: string, code: string): Promise<ExecutionOutcome> {
    const compile = await this.runCompiler(code);
    const tests = compile.pass ? await this.runTests(code) : { passed: 0, total: 0 };
    const types = await this.runTypeCheck(code);
    const fuzz = compile.pass ? await this.runFuzzer(code) : { crash: false };
    return {
      compilePass: compile.pass,
      compileErrors: compile.errors,
      testPassed: tests.passed,
      testTotal: tests.total,
      typeErrors: types.errors,
      fuzzCrash: fuzz.crash,
    };
  }

  // Collect trajectory batch → fine-tune
  async collectAndTrain(
    tasks: string[],
    generate: (task: string) => Promise<string>,
    fineTune: (trajectories: Trajectory[]) => Promise<void>,
  ): Promise<void> {
    const trajectories: Trajectory[] = [];
    for (const task of tasks) {
      const code = await generate(task);
      const outcome = await this.execute(task, code);
      const reward = this.computeReward(outcome);
      trajectories.push({ task, code, outcome, reward });
    }

    // Sort by reward for DPO pairs (preferred = high reward, rejected = low)
    trajectories.sort((a, b) => b.reward - a.reward);
    await fineTune(trajectories); // policy gradient or DPO
  }

  private async runCompiler(code: string) { return { pass: true, errors: 0 }; }
  private async runTests(code: string) { return { passed: 0, total: 0 }; }
  private async runTypeCheck(code: string) { return { errors: 0 }; }
  private async runFuzzer(code: string) { return { crash: false }; }
}

// Reward weights tunable per domain:
// safety-critical → high fuzz/crash weight
// performance → high runtime weight
// correctness → high test weight
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ground truth thực (compile/test/fuzz — không heuristic) | ❌ Training cost (RL fine-tune — GPU-intensive) |
| ✅ Khó game (fuzzer tìm edge case mà heuristic miss) | ❌ Sandbox needed (execute untrusted code safely) |
| ✅ Compiler-in-the-loop (model học tránh compile error) | ❌ Reward delay (test/fuzz slow → training slow) |
| ✅ Nối 110 process-reward + 117 toolchain-feedback | ❌ Sparse reward (nhiều task compile pass nhưng sai ngữ nghĩa) |

## Khác các hướng gần

| | 105 Self-Improving | 110 Process-Reward | 112 Learning-Corrections | OI: RL-Execution-Feedback |
|---|---|---|---|---|
| Cái gì | Runtime self-tune | Reward signal | Learn from fixes | **Training-time RL** |
| Phase | Inference | Inference | Offline | **Training** |
| Reward | Heuristic | Process steps | Corrections | **Execution (compile/test/fuzz)** |
| Game-able | Yes | Yes | Moderate | ✅ khó (fuzzer) |

## Khi nào chọn

- Muốn fine-tune model viết code đúng (compile/test pass, không crash)
- Có sandbox execution (chạy code untrusted an toàn — reward)
- Có compute budget cho RL training (GPU-intensive)
- Nối 110 process-reward (reward signal) + 117 toolchain-feedback (compile/test source) + 112 learning-from-corrections (OI = RL formalization); reward từ execution (compiler + test + fuzzer + type), không heuristic; guard sandbox isolation + sparse reward
