# Hướng XY: Measurement-First Optimization — đo Core Web Vitals trước, profiling-first, kèm regression prevention thay vì tối ưu mù (research.md)

> **Nguồn gốc:** agent-skills (performance-optimization — research.md) | **Coupling:** 🟢 — đo trước, sửa sau; không đổi kiến trúc | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có telemetry + eval + web — chưa có profile gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**agent-skills** dạy performance optimization theo nguyên tắc **measurement-first**: không tối ưu theo cảm tính ("chỗ này chắc chậm") — mà **đo Core Web Vitals / profiling trước**, tìm bottleneck thật, tối ưu đúng chỗ, rồi **đo lại** để chứng minh cải thiện. Kèm **regression prevention**: baseline được lưu, lần sau nếu metric tệ hơn baseline → chặn merge. Chuẩn "tối ưu xong" không phải "code nhanh hơn" mà là **"metric đo được cải thiện X% và không regression"**.

## Mô tả

mya áp dụng measurement-first: trước khi tối ưu bất kỳ thứ gì, agent chạy profiler/benchmark ghi **baseline** (LCP, TTI, p95 latency, memory) vào telemetry. Phân tích profile → xác định bottleneck thật (ví dụ query N+1, render blocking, payload lớn) → tối ưu đúng điểm đó → đo lại, so baseline. Nếu metric không cải thiện → revert, vì "tối ưu mà không đo được là guess". Regression prevention: mỗi build chạy benchmark suite so với baseline đã lưu; chậm hơn ngưỡng → fail gate. mya có sẵn telemetry (exporters OTel/Langfuse), eval harness (chạy benchmark), web (PWA dashboard) — XY thêm **baseline store** + **profile gate**.

## Kiến trúc

```
  ┌─ MEASURE (baseline) ──────────────────────────────┐
  │  Core Web Vitals (LCP/CLS/INP) + p95 + memory      │
  │  → lưu baseline.json (telemetry)                   │
  └────────────────────┬──────────────────────────────┘
                       ▼
  ┌─ PROFILE ──────────► bottleneck thật (N+1? render?)┐
  │  flamegraph / query log — KHÔNG tối ưu mù           │
  └────────────────────┬──────────────────────────────┘
                       ▼
  ┌─ OPTIMIZE ─────────► sửa đúng điểm bottleneck ────┐
  └────────────────────┬──────────────────────────────┘
                       ▼
  ┌─ RE-MEASURE ───────► so baseline ─────────────────┐
  │  cải thiện ≥ ngưỡng? → giữ + lưu baseline mới      │
  │  không cải thiện?   → revert (guess bị loại)       │
  └───────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent exporters.ts — OTel/Langfuse metric sink (nền — XY baseline)
// ✅ packages/core telemetry.ts — span/trace (nền — XY đo)
// ✅ packages/eval harness.ts — chạy benchmark trong CI (nền — XY gate)
// ✅ packages/web — dashboard hiển thị metric (nền — XY visualize)

// ❌ THIẾU: baseline store (metric chuẩn so sánh theo thời gian)
// ❌ THIẾU: profile gate (tối ưu phải kèm profile evidence)
// ❌ THIẾU: regression prevention (chậm hơn baseline → fail)
```

## Implementation (TS)

```typescript
// packages/eval/src/measurement-gate.ts (MỚI)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface Metrics { lcpMs: number; cls: number; inpMs: number; p95Ms: number; heapMb: number; }

export interface Baseline { recordedAt: string; metrics: Metrics; }

const REGRESSION_PCT = 0.1; // chậm hơn 10% → fail

export class MeasurementGate {
  constructor(private baselinePath: string) {}

  loadBaseline(): Baseline | null {
    if (!existsSync(this.baselinePath)) return null;
    return JSON.parse(readFileSync(this.baselinePath, "utf8")) as Baseline;
  }

  async measure(run: () => Promise<Metrics>): Promise<Metrics> {
    return run(); // profile thật: playwright LCP, autocannon p95, heap
  }

  async optimize(goal: string, run: () => Promise<Metrics>): Promise<{ improved: boolean; before: Metrics; after: Metrics }> {
    const before = await this.measure(run);            // 1. đo trước
    const after = await this.measure(run);             // 2. đo lại (agent đã sửa)
    const improved = after.p95Ms < before.p95Ms * (1 - REGRESSION_PCT);
    if (improved) this.saveBaseline(after);            // 3. lưu baseline mới
    return { improved, before, after };
  }

  checkRegression(metrics: Metrics): { ok: boolean; deltaPct: number } {
    const base = this.loadBaseline();
    if (!base) return { ok: true, deltaPct: 0 };
    const deltaPct = (metrics.p95Ms - base.metrics.p95Ms) / base.metrics.p95Ms;
    return { ok: deltaPct <= REGRESSION_PCT, deltaPct };
  }

  private saveBaseline(metrics: Metrics): void {
    writeFileSync(this.baselinePath, JSON.stringify({ recordedAt: new Date().toISOString(), metrics } satisfies Baseline, null, 2));
  }
}

// Usage:
// const gate = new MeasurementGate("bench/baseline.json");
// const r = await gate.optimize("cải thiện p95 search", runSearchBench);
// r.improved || revertLastChange();  // không đo được → không giữ
```

## Được

- ✅ Tối ưu có bằng chứng — metric đo được, không guess
- ✅ Regression prevention — baseline so sánh mỗi build
- ✅ Bottleneck thật — profiling tránh tối ưu nhầm chỗ
- ✅ Revert rule — cải thiện không đo được → bỏ
- ✅ Integrate CI — eval harness chạy benchmark gate tự động

## Mất

- ❌ Benchmark noise — môi trường khác nhau làm metric rung (cần warmup/median)
- ❌ Đo tốn thời gian — mỗi thay đổi phải chạy profile đầy đủ
- ❌ Metric không phủ hết — UX chậm do cold-start khó đo bằng CWV

## Khác các hướng gần

| | Tối ưu cảm tính | Load test định kỳ | XY: Measurement-First |
|---|---|---|---|
| Khởi điểm | "chắc chậm" | sau release | **đo baseline trước** |
| Bằng chứng | không | kết quả test | **before/after cùng chuẩn** |
| Regression | không phát hiện | phát hiện muộn | **chặn ở gate CI** |

## Khi nào chọn

- Web/dashboard mya gặp vấn đề hiệu năng, muốn tối ưu đúng chỗ
- Muốn chặn regression performance ở CI (nối eval harness)
- Có telemetry + exporters sẵn — XY thêm baseline store + gate
- Nối packages/agent exporters.ts (sink metric) + eval (benchmark trong CI) + core/telemetry.ts (span); guard benchmark-noise (warmup + median, chạy 3 lần), baseline-freshness (baseline cũ quá 30 ngày → đo lại trước khi so), và revert-rule (improved=false → tự revert, không tranh cãi); XY = measurement gate, kết hợp 648 XX five-axis (performance là 1 trục review) + 670 YT cron-auto-curation (benchmark chạy cron định kỳ)
