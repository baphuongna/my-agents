# Hướng VU: Backpressure Check Gate — benchmark pass rồi tự chạy .auto/checks.sh validation (timeout riêng); lỗi thì ghi checks_failed, không commit

> **Nguồn gốc:** pi-autoresearch (backpressure check gate); "after benchmark passes, run .auto/checks.sh validation"; "separate timeout for checks"; "failure → mark checks_failed, do NOT commit"; "validation gate prevents bad commits" | **Coupling:** 🟡 — thêm checks.sh gate vào experiment loop giữa benchmark và commit | **Agent-agnostic:** ⚠️ (cần checks.sh cụ thể cho domain) | **Code sẵn:** ⚠️ (gate logic sẵn — chưa có checks.sh + checks_failed marker) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-autoresearch** chặn **bad commit** bằng **gate validation**: sau khi benchmark pass (metric tốt hơn), **không commit ngay** — mà chạy thêm `.auto/checks.sh` (validation suite: type-check, lint, test) với **timeout riêng** (chậm hơn benchmark). Nếu checks **fail** → ghi `checks_failed` (marker), **không commit** (giữ working tree sạch). Nếu pass → commit. Nguyên tắc: **benchmark tốt ≠ code đúng** — metric cải thiện nhưng code có thể break type-check/lint/test. Check gate là **backpressure layer thứ 2** — benchmark đo performance, checks.sh đo correctness. Khác commit-on-bench-pass (chỉ tin metric) — VU **bench + checks double-gate**.

## Mô tả

mya backpressure check gate: (1) **Benchmark pass**: metric tốt hơn baseline (điều kiện 1). (2) **Run checks.sh**: chạy `.auto/checks.sh` với timeout riêng (longer — test tốn thời gian hơn bench). (3) **Gate decision**: checks pass → commit (giữ); checks fail → ghi `checks_failed` marker, **không commit** (working tree giữ nguyên, agent biết cần fix). (4) **Agent feedback**: checks_failed marker → steer agent "fix checks before committing". mya có gate logic — VU thêm **checks.sh runner** + **separate-timeout** + **checks_failed marker**.

## Kiến trúc

```
  BENCHMARK PASS (metric 108ms < baseline 120ms)  ← điều kiện 1
        │
        ▼
  ┌─── CHECKS.SH GATE (validation, timeout riêng) ──────────┐
  │  .auto/checks.sh:                                         │
  │    tsc --noEmit        (type-check)                       │
  │    eslint src/         (lint)                             │
  │    npm test            (unit test)                        │
  │  timeout: 60s (riêng, longer than bench 10s)             │
  └───────────────┬─────────────────────────────────────────┘
                  │
          ┌───────┴───────┐
          ▼               ▼
     PASS (exit 0)    FAIL (exit ≠0)
          │               │
          ▼               ▼
  ┌─── COMMIT ───┐  ┌─── checks_failed ────────────────┐
  │  git commit  │  │  ghi marker .auto/checks_failed   │
  │  baseline=   │  │  KHÔNG commit (tree sạch)         │
  │  108ms       │  │  → steer agent: "fix checks"      │
  └──────────────┘  └───────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core exit.ts — exit code / result (nền — VU gate exit)
// ✅ packages/core iteration-budget.ts — timeout budget (nền — VU checks timeout)
// ✅ 589 VQ autonomous-experiment-loop — experiment cycle (relate — VU gate trong đây)
// ✅ packages/tools codeexec.ts — exec (nền — VU chạy checks.sh)

// ❌ THIẾU: checks.sh runner (exec + separate timeout)
// ❌ THIẾU: checks_failed marker (ghi khi fail, không commit)
// ❌ THIẾU: double-gate logic (bench pass AND checks pass → commit)
```

## Implementation

```typescript
// packages/agent/src/check-gate.ts (MỘT)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, rmSync } from 'node:fs';
const execFileAsync = promisify(execFile);

interface CheckResult { passed: boolean; stderr: string; durationMs: number }

class BackpressureCheckGate {
  constructor(
    private checksPath: string,        // .auto/checks.sh
    private checksTimeoutMs: number,   // 60000 (riêng, longer than bench)
    private failedMarker: string,      // .auto/checks_failed
  ) {}

  // run checks.sh → pass/fail (separate timeout)
  async runChecks(): Promise<CheckResult> {
    const start = Date.now();
    try {
      await execFileAsync(this.checksPath, [], { timeout: this.checksTimeoutMs, encoding: 'utf8' });
      rmSync(this.failedMarker, { force: true });  // clear marker nếu pass
      return { passed: true, stderr: '', durationMs: Date.now() - start };
    } catch (e) {
      const err = e as { stderr?: string; killed?: boolean };
      return {
        passed: false,
        stderr: err.killed ? 'TIMEOUT' : (err.stderr ?? String(e)),
        durationMs: Date.now() - start,
      };
    }
  }

  // double-gate: benchmark pass AND checks pass → commit; else no commit
  async gate(
    benchmarkPassed: boolean,
    doCommit: () => string,
  ): Promise<{ committed: boolean; reason: string }> {
    if (!benchmarkPassed) return { committed: false, reason: 'benchmark not improved' };
    const checks = await this.runChecks();
    if (!checks.passed) {
      writeFileSync(this.failedMarker, checks.stderr);  // marker → steer agent
      return { committed: false, reason: `checks_failed: ${checks.stderr.slice(0, 200)}` };
    }
    const sha = doCommit();  // checks pass → commit
    return { committed: true, reason: sha };
  }
}
// Usage:
// const gate = new BackpressureCheckGate('.auto/checks.sh', 60000, '.auto/checks_failed');
// const r = await gate.gate(benchmarkPassed, () => git.commit('experiment'));
// if (!r.committed) steer(`Fix checks: ${r.reason}`);  // agent biết cần fix
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Double-gate (bench + checks → commit an toàn) | ❌ Checks latency (chạy test tốn thời gian mỗi vòng) |
| ✅ No bad commit (checks fail → tree sạch) | ❌ False negative (flaky test → chặn commit tốt) |
| ✅ Agent feedback (checks_failed marker → steer) | ❌ Timeout tuning (checks.sh quá chậm → hang) |
| ✅ Separate timeout (checks khác bench, không ảnh hưởng) | ❌ Maintenance (checks.sh phải cập nhật theo domain) |

## Khác các hướng gần

| | Commit-on-bench | Pre-commit hook | VU: Check-Gate |
|---|---|---|---|
| Gate | Benchmark only | Git hook (last-mile) | **Bench + checks.sh (in-loop)** |
| Timeout | Shared | Git default | **✅ separate (checks)** |
| Fail action | Commit anyway | Block commit | **checks_failed marker + no commit + steer** |

## Khi nào chọn

- Benchmark tốt nhưng code có thể break type-check/lint/test
- Muốn commit an toàn (double-gate: performance + correctness)
- Cần feedback agent khi checks fail (marker → steer fix)
- Nối packages/core exit.ts + iteration-budget.ts + packages/tools codeexec.ts + 589 VQ experiment-loop; guard flaky-test-isolation (retry / treat-known-flaky), timeout-calibration (checks timeout đủ dài), và checks-honesty (checks.sh thật sự validate, không no-op); VU = backpressure check gate, kết hợp 589 VQ (gate nằm trong experiment loop) + 592 VT hook-steer-contract (checks_failed marker → steer message)
