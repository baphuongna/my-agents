# Hướng ZT: Course-Correction Gate — mid-sprint quality issue kích hoạt correct-course workflow — phát hiện lệch chất lượng giữa sprint thì chỉnh hướng ngay thay vì chờ retrospective
> **Nguồn gốc:** BMAD-METHOD (references.md) | **Coupling:** 🟡 — quality monitor + correction workflow trigger | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (quality-convergence ZH nền + workflows runner — chưa có mid-sprint correction) | **Effort:** 2 tuần

## Nguồn gốc

**BMAD-METHOD** không chờ **retrospective** (cuối sprint) mới phát hiện chất lượng lệch — dùng **course-correction gate** giữa sprint: nếu **mid-sprint quality issue** xuất hiện (test fail liên tục, PRD lệch, kỹ thuật đi sai hướng), **kích hoạt correct-course workflow** ngay: (1) **detect** — quality monitor báo issue; (2) **trigger** — dừng sprint flow, chạy workflow "correct-course" (phân tích sai đâu, điều chỉnh hướng); (3) **re-plan** — cập nhật plan/scope; (4) **resume** — quay lại sprint với hướng đã sửa. Nguyên tắc: **lệch chất lượng giữa chừng → chỉnh hướng ngay, không đợi cuối kỳ**.

## Mô tả

mya course-correction gate: (1) **Quality monitor** — theo dõi quality signal giữa sprint (test pass rate, issue rate, deviation vs plan). (2) **Gate trigger** — signal dưới ngưỡng → kích hoạt **correct-course workflow** (không phải tiếp tục mù). (3) **Correct-course** — phân tích root cause, đề xuất điều chỉnh (scope/approach/schedule). (4) **Re-plan + resume** — cập nhật plan, quay lại sprint. mya có eval harness + quality-convergence (ZH) + workflows runner + core loop — ZT thêm **quality monitor** + **gate trigger** + **correct-course workflow**.

## Kiến trúc

```
  SPRINT đang chạy (phases)
  ┌──────────────────────────────────────────────────┐
  │  quality signal giữa sprint:                       │
  │   test pass rate | issue rate | deviation vs plan  │
  └────────────────────┬─────────────────────────────┘
                       ▼ monitor
  ┌─── GATE ────────────────────────────────────────┐
  │  signal ≥ ngưỡng → tiếp tục sprint                │
  │  signal < ngưỡng → TRIGGER correct-course         │
  └────────────────────┬─────────────────────────────┘
                       ▼
  ┌── CORRECT-COURSE WORKFLOW ──────────────────────┐
  │  1. phân tích root cause (sai đâu?)               │
  │  2. đề xuất điều chỉnh (scope/approach/schedule)  │
  │  3. re-plan (cập nhật plan + gate validate)       │
  │  4. resume sprint với hướng đã sửa                │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval harness.ts — ParityHarness (nền — ZT quality signal)
// ✅ packages/eval tiers.ts — tiers (nền — ZT measure giữa sprint)
// ✅ packages/workflows runner.ts — workflow runner (nền — ZT correct-course workflow)
// ✅ packages/core iteration-budget.ts — createIterationBudget (nền — ZT loop monitor)
// ✅ packages/core budget.ts — budget (nền — ZT gate ngưỡng)
// ✅ packages/council hindsight.ts — hindsight review (relate — ZT root cause)

// ❌ THIẾU: quality monitor (theo dõi signal giữa sprint)
// ❌ THIẾU: gate trigger (dưới ngưỡng → kích hoạt correct-course)
// ❌ THIẾU: correct-course workflow (root cause → re-plan → resume)
```

## Implementation

```typescript
// packages/workflows/src/course-correction.ts (MỚI)

interface QualitySignal { testPassRate: number; issueRate: number; planDeviation: number }  // 0-1 (deviation cao = lệch)

class CourseCorrectionGate {
  constructor(
    private threshold: { minTestPass: number; maxIssueRate: number; maxDeviation: number },
    private correctCourse: (signal: QualitySignal) => Promise<{ correction: string; updatedPlan: string }>,
    private resume: (plan: string) => Promise<void>,
  ) {}

  // Monitor + gate: kiểm tra signal sau mỗi milestone trong sprint
  async check(signal: QualitySignal): Promise<{ action: "continue" | "correct"; reason?: string }> {
    const reasons: string[] = [];
    if (signal.testPassRate < this.threshold.minTestPass) reasons.push(`test pass ${signal.testPassRate} < ${this.threshold.minTestPass}`);
    if (signal.issueRate > this.threshold.maxIssueRate) reasons.push(`issue rate ${signal.issueRate} > ${this.threshold.maxIssueRate}`);
    if (signal.planDeviation > this.threshold.maxDeviation) reasons.push(`plan deviation ${signal.planDeviation} > ${this.threshold.maxDeviation}`);
    if (reasons.length === 0) return { action: "continue" };

    // Trigger correct-course NGAY — không chờ retrospective
    const { updatedPlan } = await this.correctCourse(signal);
    await this.resume(updatedPlan);           // re-plan xong → resume sprint
    return { action: "correct", reason: reasons.join("; ") };
  }
}
// Usage (trong sprint loop, sau mỗi milestone):
// const gate = new CourseCorrectionGate(
//   { minTestPass: 0.9, maxIssueRate: 0.1, maxDeviation: 0.3 },
//   async (signal) => analyzeRootCauseAndReplan(signal),   // correct-course workflow
//   async (plan) => resumeSprint(plan),
// );
// const v = await gate.check({ testPassRate: 0.7, issueRate: 0.2, planDeviation: 0.4 });
// // → action: "correct" — chỉnh hướng giữa sprint, không đợi retrospective
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt lệch sớm (sửa giữa chừng, không phí cả sprint) | ❌ Monitor phải chạy đều (thêm overhead) |
| ✅ Không chờ retrospective (sai hướng sửa ngay) | ❌ Trigger nhạy quá → correct-course liên tục (gián đoạn) |
| ✅ Re-plan có validate (hướng mới được cập nhật plan) | ❌ Correct-course là LLM → đề xuất có thể sai |
| ✅ Resume rõ (quay lại sprint với plan mới) | ❌ Signal thiếu (không đo được) → gate không hoạt động |

## Khác các hướng gần

| | Chờ retrospective | Tiếp tục mù | ZT: Course-Correction |
|---|---|---|---|
| Thời điểm | Cuối sprint | Không | **Giữa sprint** |
| Hành động | Review | Không | **Workflow chỉnh hướng** |
| Re-plan | Sprint sau | Không | **✅ ngay** |

## Khi nào chọn

- Sprint/process dài, lệch chất lượng phải sửa sớm (không chờ cuối kỳ)
- Muốn quality signal định lượng (test pass/issue/deviation) làm gate
- Muốn re-plan tự động khi lệch hướng
- Nối packages/eval harness.ts + tiers.ts + workflows runner.ts + core iteration-budget.ts + budget.ts + council hindsight.ts; guard threshold-tuning (ngưỡng đủ nhạy, không gián đoạn), signal-reliability (đo đúng quality), và correction-quality (root cause đúng trước re-plan); ZT = course-correction gate, kết hợp 684 ZH quality-convergence (quality signal + loop) + 693 ZQ four-phase-lifecycle (re-plan trong phase)
