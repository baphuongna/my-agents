# Hướng VQ: Autonomous Experiment Loop — vòng tự động edit→commit→run_experiment timing→log_experiment→keep/revert→repeat vô hạn khi agent tự cải thiện

> **Nguồn gốc:** pi-autoresearch (autonomous experiment loop); "edit→commit→run_experiment→log_experiment→keep/revert→repeat"; "timing benchmark gating"; "auto-keep or auto-revert based on metric"; "infinite self-improvement cycle" | **Coupling:** 🟡 — thêm experiment-loop orchestration vào agent + git ops | **Agent-agnostic:** ⚠️ (cần git + benchmark runner cụ thể) | **Code sẵn:** ⚠️ (agent loop + tools sẵn — chưa có experiment-loop + git revert gate) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-autoresearch** chạy một **vòng lặp tự cải thiện** khép kín: agent **edit** code, **commit** (ghi checkpoint), **run_experiment** với timing (benchmark đo metric), **log_experiment** (ghi kết quả), rồi quyết định **keep** (giữ commit nếu tốt hơn) hoặc **revert** (quay lại nếu tệ hơn) — rồi **repeat** vô hạn. Nguyên lý cốt lõi: mỗi thay đổi được **đo lường khách quan** bằng timing/metric trước khi giữ hoặc loại; git commit/revert là cơ chế **snapshot atomically**. Agent không cần con người phán xét — benchmark là **source of truth**. Khác iterate-and-hope (edit rồi tin là tốt hơn) — VQ **measure-then-decide**; khác manual benchmark — VQ **in-loop automation**.

## Mô tả

mya autonomous experiment loop: (1) **Edit phase**: agent sửa code bằng tools (write/edit). (2) **Commit**: git commit checkpoint (dễ revert). (3) **Run experiment**: chạy benchmark đo metric (timing, accuracy). (4) **Log**: ghi kết quả vào experiment log (jsonl). (5) **Decide**: so metric hiện tại vs baseline → **keep** (cập nhật baseline) hoặc **revert** (git revert về checkpoint trước). (6) **Repeat**: vòng tiếp cho đến khi hết iteration budget hoặc metric hội tụ. mya có agent loop + git tools — VQ thêm **experiment-runner** + **metric-comparator** + **keep/revert-gate**.

## Kiến trúc

```
  AGENT (autonomous, infinite loop)
  ┌─── PHASE: EDIT ─────────────────────────────────────────┐
  │  agent read code → propose edit → write/edit tool         │
  └───────────────┬─────────────────────────────────────────┘
                  ▼
  ┌─── PHASE: COMMIT ──────────────────────────────────────┐
  │  git commit -m "experiment: <desc>" → checkpoint SHA      │
  └───────────────┬─────────────────────────────────────────┘
                  ▼
  ┌─── PHASE: RUN_EXPERIMENT (timing) ─────────────────────┐
  │  run benchmark → measure { time_ms, accuracy, ... }      │
  └───────────────┬─────────────────────────────────────────┘
                  ▼
  ┌─── PHASE: LOG_EXPERIMENT ──────────────────────────────┐
  │  append → .auto/log.jsonl {sha, metric, timestamp}       │
  └───────────────┬─────────────────────────────────────────┘
                  ▼
  ┌─── PHASE: KEEP / REVERT (gate) ────────────────────────┐
  │  metric_now vs baseline:                                  │
  │    BETTER → keep (baseline = metric_now)                  │
  │    WORSE  → git revert <sha> (rollback)                   │
  └───────────────┬─────────────────────────────────────────┘
                  ▼ (repeat until budget exhausted / converged)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core loop.ts — agent loop (nền — VQ experiment cycle ở đây)
// ✅ packages/agent iteration-budget.ts — budget (nền — VQ lặp đến budget)
// ✅ packages/tools hashline-edit.ts — edit (nền — VQ edit phase)
// ✅ packages/core session.ts — session (nền — VQ checkpoint)

// ❌ THIẾU: experiment-runner (benchmark exec + timing)
// ❌ THIẾU: metric-comparator (keep/revert decision)
// ❌ THIẾU: git revert gate (atomic rollback checkpoint)
// ❌ THIẾU: experiment-log (append-only log.jsonl)
```

## Implementation

```typescript
// packages/agent/src/experiment-loop.ts (MỚI)
interface ExperimentResult { sha: string; metric: number; timestamp: number; description: string }

class AutonomousExperimentLoop {
  private baseline: number;
  private log: ExperimentResult[] = [];

  constructor(
    private git: { commit: (msg: string) => string; revert: (sha: string) => void },
    private benchmark: () => Promise<number>,   // trả metric (lower = better)
    private writeLog: (entry: ExperimentResult) => void,
    initialBaseline: number,
  ) { this.baseline = initialBaseline; }

  // một vòng experiment
  async step(description: string): Promise<'keep' | 'revert'> {
    const sha = this.git.commit(`experiment: ${description}`);
    const metric = await this.benchmark();
    const entry: ExperimentResult = { sha, metric, timestamp: Date.now(), description };
    this.writeLog(entry);  // log_experiment
    this.log.push(entry);

    if (metric <= this.baseline) {
      this.baseline = metric;   // BETTER → keep, cập nhật baseline
      return 'keep';
    } else {
      this.git.revert(sha);     // WORSE → revert
      return 'revert';
    }
  }
  // chạy vô hạn đến khi hết budget hoặc hội tụ
  async run(agent: () => Promise<string>, budget: number): Promise<ExperimentResult[]> {
    for (let i = 0; i < budget; i++) {
      const desc = await agent();                    // agent đề xuất edit
      const decision = await this.step(desc);        // commit → bench → log → keep/revert
      if (this.converged()) break;
    }
    return this.log;
  }
  private converged(): boolean {
    const recent = this.log.slice(-5);
    if (recent.length < 5) return false;
    return recent.every(r => Math.abs(r.metric - this.baseline) < 0.001);
  }
}
// Usage:
// loop.run(() => agent.proposeOptimization(), 100);
// → edit→commit→bench→log→keep/revert → repeat
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Self-improvement (agent tự đo + quyết định) | ❌ Benchmark cost (mỗi vòng chạy timing) |
| ✅ Atomic rollback (git revert, không bẩn working tree) | ❌ Git bloat (nhiều commit rác nếu không prune) |
| ✅ Objective gate (metric quyết định, không cảm tính) | ❌ Metric gaming (agent tối ưu metric sai) |
| ✅ Full audit (log.jsonl ghi mọi experiment) | ❌ Convergence risk (không bao giờ hội tụ) |

## Khác các hướng gần

| | Iterate-and-hope | Manual benchmark | VQ: Experiment-Loop |
|---|---|---|---|
| Đo | ❌ | Human chạy | **✅ in-loop timing** |
| Giữ/loại | Human | Human | **✅ auto keep/revert (git)** |
| Lặp | Có giới hạn | Manual | **✅ vô hạn đến converged** |

## Khi nào chọn

- Agent tự tối ưu metric (timing/accuracy) cần vòng lặp đo-lường-kết-định
- Muốn atomic rollback (git revert loại thay đổi tệ tự động)
- Cần audit đầy đủ (log.jsonl ghi mọi experiment + decision)
- Nối packages/core loop.ts + packages/agent iteration-budget.ts + packages/tools hashline-edit.ts; guard benchmark-determinism (timing ổn định, không flaky), git-prune (dọn commit revert rác), và metric-honesty (đo đúng thứ cần cải thiện, chống gaming); VQ = autonomous experiment loop, kết hợp 590 VR resumable-dual-session-files (log.jsonl nguồn sự thật) + 593 VU backpressure-check-gate (benchmark gate trước commit)
