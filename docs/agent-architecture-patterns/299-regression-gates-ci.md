# Hướng KM: Regression Gates CI — quality gate chặn regression về cost/latency/độ chính xác

> **Nguồn gốc:** DORA metrics gates; SLO-based release gates; canary auto-promote gates; SonarQube quality gates
> **Coupling:** 🟢 — CI layer, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval-harness/CI sẵn — thiếu threshold gate tự động)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Quality gate** (SonarQube/DORA): tập threshold nếu vi phạm → block deploy. DORA: deployment frequency, lead time, change failure rate gate. SLO gate: nếu error budget cạn → chặn release. Canary auto-promote: metric (latency, error) vượt ngưỡng → rollback tự. Nguyên tắc: mỗi thay đổi (prompt, model, tool) phải qua **cổng metric** — cost/latency/độ chính xác không được thoái triển quá ngưỡng. Gate **tự động** (CI chặn), không review thủ công từng metric.

## Mô tả

mya regression gate: mỗi PR chạy eval suite (41/84/297 golden) → thu metric: **cost** ($/request, 44/127), **latency** (p50/p99), **độ chính xác** (84 llm-as-judge, pass rate). So với baseline (main branch): nếu cost tăng >X%, latency p99 tăng >Y%, pass rate giảm >Z% → **gate fail → block merge**. Khác eval đơn lẻ (chạy rồi xem): gate **tự động chặn**. Có "accept regression" (cố ý đổi model rẻ-hơn-chậm-hơn → approve + update baseline). Nối 96 agent-ci-cd (CI) + 297 golden (data).

## Kiến trúc

```
  PR (đổi prompt/model/tool)
        │
        ▼
  CI: chạy eval suite (41/84/297)
        │
        ▼
  METRIC      vs BASELINE (main)     GATE
  cost        $0.050   $0.040  +25%   ❌ FAIL (>10%)
  latency p99 3.2s     2.1s   +52%   ❌ FAIL (>30%)
  pass rate   92%      95%    -3%    ❌ FAIL (>-2%)
        │
        ▼
  BLOCK MERGE → xem nguyên nhân (prompt? model? tool?)
        │
  cố ý đổi → accept-regression (approve + update baseline)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 41 eval-harness — eval (nguồn metric)
// ✅ 84 llm-as-judge — chấm chất lượng (pass rate)
// ✅ 44 cost-budget / 127 agentic-finops — cost (metric)
// ✅ 96 agent-ci-cd — CI (nơi chạy gate)
// ✅ 297 golden-trace-replay — regression data (nguồn gate)

// ❌ THIẾU: threshold gate (cost/latency/pass-rate)
// ❌ THIẾU: baseline (so với main branch)
// ❌ THIẾU: accept-regression flow (cố ý → update baseline)
// ❌ THIẾU: auto block (CI chặn merge)
```

## Implementation

```typescript
// packages/eval/src/regression-gate.ts (NEW)
interface Metric { name: string; pr: number; baseline: number; threshold: number; better: "lower" | "higher"; }
type Verdict = { pass: boolean; reason?: string };

function gate(m: Metric): Verdict {
  const delta = ((m.pr - m.baseline) / m.baseline) * 100;
  const regressed = m.better === "lower" ? delta > m.threshold : delta < -m.threshold;
  return regressed
    ? { pass: false, reason: `${m.name} regressed ${delta.toFixed(1)}% (>${m.threshold}%)` }
    : { pass: true };
}

// CI: chạy eval → thu metric → gate toàn bộ
async function ciGate(): Promise<void> {
  const [cost, latency, passRate] = await Promise.all([
    measureCost(), measureLatencyP99(), measurePassRate(),
  ]);
  const base = await loadBaseline(); // metric trên main
  const results = [
    gate({ name: "cost", pr: cost, baseline: base.cost, threshold: 10, better: "lower" }),
    gate({ name: "latency-p99", pr: latency, baseline: base.latency, threshold: 30, better: "lower" }),
    gate({ name: "pass-rate", pr: passRate, baseline: base.passRate, threshold: 2, better: "higher" }),
  ];
  const failed = results.filter((r) => !r.pass);
  if (failed.length) throw new Error(`Regression: ${failed.map((f) => f.reason).join("; ")}`);
}

// Cố ý: approve → update baseline
async function acceptRegression(): Promise<void> { await saveBaseline(await measureAll()); }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn thoái triển tự động (SonarQube/SLO proven) | ❌ Threshold cần tune (quá lỏng/chặt) |
| ✅ Metric tường minh (cost/latency/pass-rate) | ❌ Eval có noise → gate flaky |
| ✅ Accept-regression (cố ý → update baseline) | ❌ Baseline phải cập nhật định kỳ |
| ✅ Nối 96 CI + 297 golden (data + gate) | ❌ Gate chậm nếu eval nặng (cần mock 298) |

## Khác các hướng gần

| | 96 Agent CI/CD | 297 Golden Trace | KM: Regression Gates |
|---|---|---|---|
| Mục | Pipeline CI | Baseline trace | **Threshold gate tự động** |
| Đầu ra | Pass/fail test | Diff trace | **Block theo metric** |
| Chặn | Test fail | Trace mismatch | **Cost/latency/pass-rate** |
| Baseline | ❌ | Golden set | **Metric trên main** |

## Khi nào chọn

- Muốn chặn thoái triển cost/latency/độ chính xác mỗi PR
- Đã có eval (41/84) + CI (96) + golden (297) — thêm gate
- Cần release disciplined (SLO-style, không thoái triển)
- OK tune threshold + accept-regression flow
