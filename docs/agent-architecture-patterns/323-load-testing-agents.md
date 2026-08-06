# Hướng LK: Load Testing Agents — kiểm tra tải agent, concurrency, throughput, bão hòa

> **Nguồn gốc:** Load testing (JMeter, k6, Gatling); "stress testing"; capacity planning; Little's Law (L=λW); "soak testing"; concurrency saturation; SLO/SLI
> **Coupling:** 🟢 — test harness layer, không đổi logic
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + concurrency + provider sẵn — thiếu load generator + saturation finder + capacity model)
> **Effort:** 3-4 tuần

## Nguồn gốc

Load testing (k6/JMeter): tạo **virtual users** gửi request song song → đo throughput, latency, error-rate khi tăng load. Stress testing: tăng load đến khi **break** → tìm saturation point. Capacity planning: từ saturation → biết max QPS hệ thống chịu. Little's Law (L = λ × W): concurrency = arrival-rate × latency — dự đoán capacity. Soak testing: chạy lâu (giờ/ngày) → tìm memory leak, degradation. SLO/SLI: objective (latency p99 < 2s, error < 1%). Cốt lõi: **biết giới hạn** — bao nhiêu agent chạy song song, max throughput, khi nào saturate → plan capacity.

## Mô tả

mya load testing: virtual agent workload generator → chạy N agent song song (concurrent turns) → đo: (1) **throughput** (tasks/sec), (2) **latency** (p50/p99), (3) **error-rate** (timeout, rate-limit), (4) **saturation point** (khi latency/Error nhảy → bottleneck). Capacity model: Little's Law → dự đoán max concurrency. Nối 233 work-stealing (concurrency mgmt), 316 resource-negotiation (resource limit), 322 chaos (load + fault), 302 budget (cost under load).

## Kiến trúc

```
  LOAD GENERATOR (N virtual agents)
     │
     ├── Agent 1 ──┐
     ├── Agent 2 ──┤  all concurrent
     ├── ...       ├──→ AGENT SYSTEM (provider + tools)
     └── Agent N ──┘
                       │
                       ▼
  ┌──────────────────────────────────────────────────────┐
  │  METRICS (per concurrency level N)                   │
  │                                                      │
  │  N=1:   throughput 0.5 t/s, p99 1.8s, error 0%       │
  │  N=10:  throughput 4.2 t/s, p99 2.5s, error 0%       │
  │  N=50:  throughput 9.1 t/s, p99 5.0s, error 2%  ⚠   │
  │  N=100: throughput 9.3 t/s, p99 12s, error 15% ❌   │
  │          ↑ SATURATION (throughput plateaus,          │
  │            latency/error explode) → capacity ~50     │
  └──────────────────┬───────────────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  CAPACITY MODEL (Little's Law: L = λ × W)             │
  │  max concurrency ≈ throughput × latency              │
  │  → plan: add workers (233) or scale provider         │
  └──────────────────────────────────────────────────────┘
```

```
mya: agent-loop + concurrency + provider sẵn — thiếu load generator + saturation finder + capacity model
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — agent-loop (sẵn)
// ✅ 233 work-stealing — concurrency management (documented)
// ✅ 2-providers — LLM (sẵn — bottleneck under load)
// ✅ 316 resource-negotiation — resource limit (documented)

// ❌ THIẾU: load generator (N virtual concurrent agents)
// ❌ THIẾU: metrics collector (throughput, p99, error-rate)
// ❌ THIẾU: saturation finder (ramp concurrency → find break)
// ❌ THIẾU: capacity model (Little's Law prediction)
```

## Implementation

```typescript
// scripts/load-test.mjs (NEW)
interface LoadResult { concurrency: number; throughput: number; p99Ms: number; errorRate: number; }

export class LoadTester {
  async ramp(taskFn: () => Promise<boolean>, maxN: number, step: number): Promise<LoadResult[]> {
    const results: LoadResult[] = [];
    for (let n = step; n <= maxN; n += step) {
      const r = await this.runLevel(taskFn, n);
      results.push(r);
      // Stop if error-rate too high (saturated)
      if (r.errorRate > 0.10) break;
    }
    return results;
  }

  private async runLevel(taskFn: () => Promise<boolean>, concurrency: number): Promise<LoadResult> {
    const latencies: number[] = [];
    const tasks = Array.from({ length: 100 }, () => taskFn); // 100 tasks at this concurrency
    let errors = 0;
    const pool = new Pool(concurrency); // limit concurrency
    const start = Date.now();
    await Promise.all(tasks.map(async (t) => pool.run(async () => {
      const t0 = Date.now();
      try {
        const ok = await t();
        if (!ok) errors++;
      } catch { errors++; }
      latencies.push(Date.now() - t0);
    })));
    const elapsed = (Date.now() - start) / 1000;
    latencies.sort((a, b) => a - b);
    return {
      concurrency,
      throughput: tasks.length / elapsed,
      p99Ms: latencies[Math.floor(latencies.length * 0.99)] ?? 0,
      errorRate: errors / tasks.length,
    };
  }

  // Find saturation: first level where throughput plateaus or error spikes
  findSaturation(results: LoadResult[]): number {
    for (let i = 1; i < results.length; i++) {
      const growth = results[i].throughput - results[i - 1].throughput;
      if (growth < results[i - 1].throughput * 0.1 || results[i].errorRate > 0.05) {
        return results[i - 1].concurrency; // previous level was safe
      }
    }
    return results[results.length - 1].concurrency;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết capacity (k6-style saturation) | ❌ Load test cost (many LLM calls = $) |
| ✅ Throughput/p99 metrics (SLO/SLI) | ❌ Provider rate-limit caps test (false ceiling) |
| ✅ Capacity plan (Little's Law) | ❌ Long soak tests (time + memory) |
| ✅ Find bottleneck under load | ❌ Noisy (other tenants affect result) |

## Khác các hướng gần

| | 322 Chaos-Agents | 321 Flaky | LK: Load Testing |
|---|---|---|---|
| Mục | Fault resilience | Test stability | **Capacity / saturation** |
| Vary | Fault type | Run count | **Concurrency level** |
| Find | Resilience gap | Non-determinism | **Max throughput** |

## Khi nào chọn

- Ship agent prod — cần biết capacity (max concurrency)
- SLO/SLI p99 latency — phải đạt under load
- Capacity planning (scale workers 233 / provider)
- Nối 233 work-stealing + 316 resource-negotiation + 322 chaos + 302 budget
