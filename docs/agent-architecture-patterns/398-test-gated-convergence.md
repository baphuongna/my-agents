# Hướng OH: Test-Gated Convergence — cửa dừng multi-agent theo test pass

> **Nguồn gốc:** Papers RLTF (Reinforcement Learning from Test Feedback); BOAD; "convergence gate"; "test-suite as stopping criterion"; "multi-agent early termination on correctness"; "iteration budget vs test pass"
> **Coupling:** 🟢 — thêm convergence gate vào multi-agent orchestrator
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool-test-harness + test runner sẵn — chưa có convergence gate + early-stop)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**RLTF**: thay vì chạy multi-agent đến hết iteration budget (N rounds) rồi mới check, **chạy test sau mỗi round** — nếu **test pass** → dừng sớm (converged). Test-suite là **objective stopping criterion**: agent biết mình xong khi test xanh, không phải khi hết budget. **BOAD** áp dụng convergence gate cho topology search — topology chỉ được chọn nếu pass test. Nguyên tắc: **test pass = done** — không lãng phí iteration khi đã đúng. **Iteration budget** là safety cap (dừng dù test chưa pass sau N rounds). Khác **105 self-improving** (tự sửa) — OH là **stopping criterion**; khác **114 spec-test-code** (TDD loop) — OH là **multi-agent convergence**.

## Mô tả

mya test-gated convergence: multi-agent orchestrator sau mỗi round → **chạy test** → (a) **All pass** → converged, dừng sớm (save iterations). (b) **Some fail** → tiếp tục round (agent sửa dựa trên failure). (c) **Budget exhausted** (N rounds) → dừng + report partial (test chưa pass). Gate có **granularity**: pass-all (mọi test xanh), pass-critical (critical tests xanh), pass-threshold (≥ X% pass). mya có `tool-test-harness` + vitest runner — OH thêm **convergence gate** (test check after each round) + **early-stop** (pass → dừng) + **budget cap**.

## Kiến trúc

```
  MULTI-AGENT LOOP (round-by-round):
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  Round 1: agents work → produce code                │
  │     │                                               │
  │     ▼                                               │
  │  ┌── CONVERGENCE GATE ──────────────────────────┐   │
  │  │  run test suite:                              │   │
  │  │    vitest run → 8 passed, 2 failed            │   │
  │  │  verdict: NOT CONVERGED (2 fail)              │   │
  │  │  → continue to next round                     │   │
  │  └───────────────────────────────────────────────┘   │
  │                                                     │
  │  Round 2: agents fix 2 failing tests                │
  │     │                                               │
  │     ▼                                               │
  │  ┌── CONVERGENCE GATE ──────────────────────────┐   │
  │  │  run test suite:                              │   │
  │  │    vitest run → 10 passed, 0 failed           │   │
  │  │  verdict: CONVERGED ✅ (all pass)              │   │
  │  │  → STOP EARLY (save remaining rounds)         │   │
  │  └───────────────────────────────────────────────┘   │
  │                                                     │
  │  Safety: if Round N reached without pass → BUDGET   │
  │  EXHAUSTED → stop + report partial                  │
  └─────────────────────────────────────────────────────┘

  GATE GRANULARITY:
    pass-all:       every test green → stop
    pass-critical:  critical suite green → stop (accept partial)
    pass-threshold: ≥ 90% pass → stop (tolerance)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ scripts/tool-test-harness — test execution (nền — OH gate runner)
// ✅ vitest — test runner (nền — OH gate invokes)
// ✅ 114 spec-test-code — TDD loop (nền — OH = multi-agent convergence)
// ✅ 119 bounded-self-correction — limit retries (nền — OH budget cap)
// ✅ 117 toolchain-feedback-loop — build/test feedback (nền)

// ❌ THIẾU: convergence gate (test check after each round)
// ❌ THIẾU: early-stop logic (pass → terminate before budget)
// ❌ THIẾU: granularity (pass-all / pass-critical / pass-threshold)
// ❌ THIẾU: partial report (budget exhausted → report state)
```

## Implementation

```typescript
// packages/agent/src/test-gated-convergence.ts (MỚI)
type GateMode = 'pass-all' | 'pass-critical' | 'pass-threshold';

interface TestResult {
  total: number;
  passed: number;
  failed: number;
  criticalPassed?: number;
  criticalTotal?: number;
}

interface ConvergenceConfig {
  mode: GateMode;
  maxRounds: number;     // budget cap (safety)
  threshold?: number;    // for pass-threshold (0-1)
  criticalTests?: string[];
}

class TestGatedConvergence {
  constructor(private config: ConvergenceConfig) {}

  // Check after each round — converged?
  check(testResult: TestResult, round: number): {
    converged: boolean;
    reason: string;
    remainingRounds: number;
  } {
    const passed = this.isConverged(testResult);
    const remaining = this.config.maxRounds - round;

    if (passed) {
      return {
        converged: true,
        reason: `Tests passed (${testResult.passed}/${testResult.total}) at round ${round}`,
        remainingRounds: remaining,
      };
    }

    if (remaining <= 0) {
      return {
        converged: true, // stop — but NOT success
        reason: `Budget exhausted: ${testResult.failed} tests still failing after ${round} rounds`,
        remainingRounds: 0,
      };
    }

    return {
      converged: false,
      reason: `${testResult.failed} tests failing, ${remaining} rounds remaining`,
      remainingRounds: remaining,
    };
  }

  private isConverged(result: TestResult): boolean {
    switch (this.config.mode) {
      case 'pass-all':
        return result.failed === 0;
      case 'pass-critical':
        return (result.criticalPassed ?? 0) === (result.criticalTotal ?? 0);
      case 'pass-threshold':
        return result.total > 0
          && (result.passed / result.total) >= (this.config.threshold ?? 0.9);
    }
  }
}

// Usage in multi-agent loop:
// for (let round = 1; round <= config.maxRounds; round++) {
//   await runAgents(round);
//   const testResult = await runTestSuite();
//   const gate = convergence.check(testResult, round);
//   if (gate.converged) { report(gate); break; }
// }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dừng sớm khi đúng (save iterations / cost) | ❌ Test suite slow (mỗi round +test execution) |
| ✅ Objective criterion (test pass = done, không heuristic) | ❌ Flaky tests (false converge / false continue) |
| ✅ Granularity (pass-all / critical / threshold) | ❌ Overfitting test (pass test nhưng code sai ngữ nghĩa) |
| ✅ Budget cap (safety — dừng sau N rounds) | ❌ Threshold tuning (90%? 95%? — domain-dependent) |

## Khác các hướng gần

| | 114 Spec-Test-Code | 119 Bounded-Self-Correction | 117 Toolchain-Feedback | OH: Test-Gated-Convergence |
|---|---|---|---|---|
| Cái gì | TDD loop | Limit retries | Build/test feedback | **Stop khi test pass** |
| Criterion | Spec | Retry count | Compile/test | **Test pass = converged** |
| Early-stop | ❌ | ❌ | ❌ | ✅ pass → stop |
| Granularity | ❌ | ❌ | ❌ | ✅ all/critical/threshold |

## Khi nào chọn

- Multi-agent có iteration budget (muốn dừng sớm khi đúng)
- Có test suite rõ (objective criterion — test pass = done)
- Muốn tiết kiệm cost/latency (không chạy hết budget nếu đã xanh)
- Nối 114 spec-test-code (TDD loop) + 117 toolchain-feedback (test feedback) + 119 bounded-self-correction (budget cap); OH là **convergence gate** — test check after each round, pass → early-stop, budget → safety cap; guard flaky tests + overfitting
