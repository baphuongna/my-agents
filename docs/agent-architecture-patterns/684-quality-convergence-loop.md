# Hướng ZH: Quality Convergence Loop — loop implement→measure→refine tới khi quality target đạt: score đa chiều (tests/lint/security/perf/type) có weight tùy domain, không chạy một lần rồi hy vọng
> **Nguồn gốc:** babysitter (docs/user-guide/features/quality-convergence.md) | **Coupling:** 🟡 — vòng lặp measure/refine quanh runner + eval | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval tiers + lint — chưa có convergence loop với weight) | **Effort:** 2-3 tuần

## Nguồn gốc

**babysitter** không chạy quality check **một lần rồi hy vọng** — dùng **quality convergence loop**: implement → **measure** (score đa chiều) → **refine** → measure lại, lặp tới khi **quality target** đạt. Score đa chiều gồm: **tests** (pass rate), **lint** (clean), **security** (không vuln), **perf** (threshold), **type** (type-check pass) — mỗi chiều có **weight tùy domain** (web app: security nặng; lib: type nặng). Loop dừng khi weighted score ≥ target hoặc hết budget/iteration. Nguyên tắc: **converge to target — đo, refine, đo lại; không chạy 1 lần rồi chấp nhận**.

## Mô tả

mya quality convergence loop: (1) **Measure** — chạy tests/lint/security/type/perf → score mỗi chiều 0-1. (2) **Weighted score** — tổng score × weight theo domain config. (3) **Refine** — score < target → agent nhận báo cáo chi tiết (chiều nào fail, lỗi gì) → sửa. (4) **Converge** — lặp tới khi score ≥ target hoặc hết iteration/budget → báo kết quả cuối. mya có eval/harness.ts + tiers.ts, scripts/lint.mjs, tools/osv-check.ts, ai/fallback (perf relate) — ZH thêm **measure runner** + **weighted score** + **convergence loop**.

## Kiến trúc

```
  ┌─── IMPLEMENT ────────────┐
  │  agent viết/sửa code      │
  └──────────┬───────────────┘
             ▼
  ┌─── MEASURE (đa chiều) ──────────────────────────┐
  │  tests: pass rate 0-1     weight 0.4             │
  │  lint: clean?             weight 0.1             │
  │  security: osv clean?     weight 0.3             │
  │  type: typecheck pass?    weight 0.1             │
  │  perf: threshold?         weight 0.1             │
  │  weighted = Σ(score_i × weight_i)                │
  └──────────┬──────────────────────────────────────┘
             ▼
  ┌─── CONVERGE? ──────────────────────────────────┐
  │  weighted ≥ target? → DONE                       │
  │  iteration/budget hết? → DONE (báo fail)         │
  │  else → REFINE (báo cáo chi tiết → agent sửa)    │
  └──────────┬──────────────────────────────────────┘
             ▼ (quay lại implement)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval harness.ts — ParityHarness (nền — ZH measure tests)
// ✅ packages/eval tiers.ts — integration/credentialed tiers (nền — ZH measure sâu)
// ✅ scripts/lint.mjs — lint (nền — ZH lint score)
// ✅ packages/tools osv-check.ts — security scan (nền — ZH security score)
// ✅ packages/core budget.ts + iteration-budget.ts (nền — ZH loop budget)
// ✅ packages/ai fallback.ts — streamWithFallback (relate — ZH retry analog)

// ❌ THIẾU: measure runner (gộp tests/lint/security/type/perf → score)
// ❌ THIẾU: weighted score (weight theo domain)
// ❌ THIẾU: convergence loop (implement→measure→refine tới target)
```

## Implementation

```typescript
// packages/eval/src/quality-convergence.ts (MỚI)

interface QualityDimension { name: string; weight: number; measure(): Promise<number> }  // score 0-1

interface ConvergenceConfig { target: number; maxIterations: number; maxBudget: number }

class QualityConvergence {
  constructor(private dimensions: QualityDimension[], private config: ConvergenceConfig) {}

  // Measure: score đa chiều → weighted
  async measure(): Promise<{ weighted: number; perDimension: Record<string, number> }> {
    const per: Record<string, number> = {};
    let weighted = 0;
    for (const d of this.dimensions) {
      const s = await d.measure();
      per[d.name] = s;
      weighted += s * d.weight;                                // weight tùy domain
    }
    return { weighted, perDimension: per };
  }

  // Loop: implement → measure → refine → ... tới target hoặc hết budget
  async converge(refine: (report: { weighted: number; perDimension: Record<string, number> }) => Promise<void>): Promise<{
    done: boolean; weighted: number; iterations: number;
  }> {
    let used = 0;
    for (let i = 0; i < this.config.maxIterations; i++) {
      const m = await this.measure();
      used += Object.values(m.perDimension).length;            // ước lượng cost
      if (m.weighted >= this.config.target) return { done: true, weighted: m.weighted, iterations: i + 1 };
      if (used >= this.config.maxBudget) return { done: false, weighted: m.weighted, iterations: i + 1 };
      await refine({ weighted: m.weighted, perDimension: m.perDimension });   // agent sửa theo báo cáo
    }
    return { done: false, weighted: 0, iterations: this.config.maxIterations };
  }
}
// Usage:
// const loop = new QualityConvergence([
//   { name: "tests",    weight: 0.4, measure: () => runTests().then(r => r.passRate) },
//   { name: "security", weight: 0.3, measure: () => runOsv().then(r => r.vulns === 0 ? 1 : 0) },
//   { name: "type",     weight: 0.1, measure: () => runTypecheck().then(r => r.ok ? 1 : 0) },
//   { name: "lint",     weight: 0.1, measure: () => runLint().then(r => r.clean ? 1 : 0) },
//   { name: "perf",     weight: 0.1, measure: () => runPerf().then(r => r.underThreshold ? 1 : 0) },
// ], { target: 0.9, maxIterations: 5, maxBudget: 100 });
// await loop.converge(async (report) => { await agentRefine(report); });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chất lượng hội tụ tới target (đo nhiều lần) | ❌ Nhiều iteration → tốn token/thời gian |
| ✅ Score đa chiều có weight theo domain | ❌ Weight sai → hội tụ sai hướng (ưu tiên nhầm) |
| ✅ Báo cáo chi tiết (chiều nào fail) cho refine | ❌ Measure flaky (test bất định → loop không hội tụ) |
| ✅ Budget/iteration chặn loop vô hạn | ❌ Measure runner phải gọi đủ công cụ (tốn setup) |

## Khác các hướng gần

| | Run-once | Manual QA | ZH: Convergence Loop |
|---|---|---|---|
| Số lần đo | 1 | Nhiều (human) | **N (tự động)** |
| Target | Không | Cảm tính | **Weighted score** |
| Refine | ✗ | Human | **Agent tự sửa** |

## Khi nào chọn

- Chất lượng quan trọng, một lần chạy không đủ tin
- Muốn score đa chiều có weight theo domain (security nặng hơn lint...)
- Agent có thể tự refine theo báo cáo measure
- Nối packages/eval harness.ts + tiers.ts + scripts/lint.mjs + tools osv-check.ts + core budget.ts + iteration-budget.ts; guard measure-determinism (measure chạy lại ra cùng kết quả), weight-sanity (Σ weight = 1), và loop-termination (budget/iteration luôn chặn); ZH = quality convergence loop, kết hợp 682 ZF evidence-driven-completion (measure = evidence) + 679 ZC two-loops-control-plane (loop trong control plane)
