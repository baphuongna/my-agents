# Hướng IK: Capacity Planning — dự báo GPU/token, autoscale

> **Nguồn gốc:** Kubernetes HPA/VPA autoscaling; "LLM inference capacity planning" (vLLM, TGI throughput); Google SRE "capacity planning"; Ray Serve autoscaling; cost forecasting (127 finops)
> **Coupling:** 🟢 — capacity engine lớp ngoài, runtime metric-only
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cost + budget + rate-limit sẵn — thiếu forecast model + autoscale trigger)
> **Effort:** 2-3 tuần

## Nguồn gốc

Capacity planning (Google SRE Workbook): dự báo **nhu cầu tài nguyên** (CPU, GPU, token throughput) trước khi hết — "natural demand growth + headroom for peak." Kubernetes HPA (Horizontal Pod Autoscaler) — scale pod theo metric (CPU, custom). VLLM/TGI — LLM inference throughput planning: GPU memory × batch size × concurrent request. Ray Serve — autoscale replica theo QPS. Cho LLM agent: tài nguyên = **GPU** (self-hosted) hoặc **token quota** (API); capacity planning dự báo "tuần sau cần bao nhiêu? tháng sau?" → autoscale (thêm worker 249, route model rẻ 178) hoặc throttle (196 rate-limit).

Khác **127 agentic-finops** (DW — quản *chi phí* hiện tại) — IK *dự báo* tương lai + autoscale. Khác **196 rate-limiting** (throttle khi quá) — IK *chuẩn bị trước* (scale up). Nối **243 SLO** (II — SLO drive capacity), **178 dynamic-model-routing** (route theo capacity), **249 priority-scheduling** (IO — queue khi capacity đầy), **144 agent-fleet-management**.

## Mô tả

mya capacity planning: (1) **collect** — token usage (core/cost.ts), concurrent session (agent/pool.ts), latency (telemetry); (2) **forecast** — trend analysis (moving average / linear regression) → "demand tuần sau = X token/s"; (3) **plan** — compare forecast vs capacity (GPU quota / API rate limit) → headroom; (4) **autoscale** — thiếu → thêm worker (249), route cheaper model (178), hoặc warn; thừa → scale down tiết kiệm. mya đã có cost + budget + rate-limit (196) — IK thêm forecast + capacity headroom + autoscale trigger.

## Kiến trúc

```
  USAGE METRICS (rolling — từ cost.ts + pool.ts + telemetry)
   · tokens/sec: 2.4k (trend: +8%/week)
   · concurrent sessions: 12 (trend: +3%/week)
   · p99 latency: 35s
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  FORECAST ENGINE                               │
  │                                               │
  │  next-week projection:                        │
  │   · tokens/sec: 3.8k (+58%)                   │
  │   · sessions: 18                              │
  │                                               │
  │  CAPACITY (current limit):                    │
  │   · API rate: 5k tokens/s (headroom: 24%)     │
  │   · GPU (self-host): 2 GPU @ 4k tok/s         │
  │   · session pool: 20 max                      │
  │                                               │
  │  PLAN: 1.5 weeks until API saturation         │
  │        → pre-emptive: add GPU / negotiate quota│
  └────────┬─────────────────────────────────────┘
           │
     ┌─────┴──────┬──────────────┬──────────────┐
     ▼            ▼              ▼              ▼
  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐
  │ SCALE  │ │ ROUTE    │ │ THROTTLE │ │ ALERT      │
  │ UP     │ │ cheaper  │ │ (196)    │ │ (227)      │
  │ worker │ │ model    │ │ queue    │ │ "capacity  │
  │ (249)  │ │ (178)    │ │          │ │  low"      │
  └────────┘ └──────────┘ └──────────┘ └────────────┘
```

```
mya: cost + budget + rate-limit sẵn — thiếu forecast model + capacity headroom + autoscale trigger
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/cost.ts — computeCost (token/cost metric — data source)
// ✅ packages/core/src/budget.ts — BudgetConfig (capacity budget per-task)
// ✅ 196 rate-limiting-quotas — throttle (reactive — IK proactive)
// ✅ 127 agentic-finops (DW) — cost governance (overlap)
// ✅ packages/agent/src/pool.ts — session pool (concurrency metric)
// ✅ 178 dynamic-model-routing — route by capacity (action ready)
// ✅ 243 agent-slo-sli (II) — SLO drive capacity need

// ❌ THIẾU: forecast engine (trend projection — demand next week)
// ❌ THIẾU: capacity headroom tracker (current limit vs projected demand)
// ❌ THIẾU: autoscale trigger (forecast breach → scale/route/throttle)
// ❌ THIẾU: cost forecasting (month-end projection — finops)
```

## Implementation

```typescript
// packages/core/src/capacity.ts (NEW)
interface UsageSample {
  ts: number;
  tokensPerSec: number;
  concurrentSessions: number;
}

interface CapacityLimit {
  apiRateTokensPerSec: number;
  maxSessions: number;
  gpuTokensPerSec?: number;  // self-hosted
}

class CapacityPlanner {
  constructor(private history: UsageSample[], private limit: CapacityLimit) {}

  // Forecast demand using linear regression on trend
  forecast(horizonMs: number): { tokensPerSec: number; sessions: number } {
    const trend = linearRegression(this.history.map((h) => [h.ts, h.tokensPerSec]));
    const futureTs = nowWallclock() + horizonMs;
    return {
      tokensPerSec: Math.max(0, trend.slope * futureTs + trend.intercept),
      sessions: this.predictSessions(horizonMs),
    };
  }

  // Headroom: how much spare capacity at projected demand?
  headroom(horizonMs: number): number {
    const f = this.forecast(horizonMs);
    return (this.limit.apiRateTokensPerSec - f.tokensPerSec) / this.limit.apiRateTokensPerSec;
  }

  // Action: headroom < 15% → scale up / route cheaper / throttle
  recommendAction(horizonMs: number): "scale_up" | "route_cheaper" | "throttle" | "ok" {
    const h = this.headroom(horizonMs);
    if (h > 0.2) return "ok";
    if (h > 0.05) return "route_cheaper";  // near limit → cheaper model (178)
    if (h > 0) return "scale_up";          // tight → add capacity (249)
    return "throttle";                      // over limit → queue (196)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Proactive — scale TRƯỚC khi hết (Google SRE) | ❌ Forecast sai (trend không luôn tuyến tính) |
| ✅ Cost forecast — dự báo cuối tháng (127 finops) | ❌ Autoscale lag (scale up cần thời gian) |
| ✅ Avoid throttle (chuẩn bị trước, không đợi 196) | ❌ Over-provisioning (dự phòng quá = lãng phí) |
| ✅ Nối cost + budget + rate-limit (data sẵn) | ❌ Capacity negotiation (API quota cần thời gian) |

## Khác các hướng gần

| | 127 FinOps (DW) | 196 Rate-Limiting | IK: Capacity Planning |
|---|---|---|---|
| Trục | Chi phí hiện tại | Throttle khi quá | **Dự báo + autoscale** |
| Khi | Luôn meter | Reactive (đã quá) | **Proactive (trước khi quá)** |
| Action | Budget cap | Reject/queue | **Scale up / route / throttle** |

## Khi nào chọn

- Traffic tăng đều (growth) — cần dự báo trước khi hết capacity
- API rate limit / GPU quota cứng — cần headroom tracking
- Cost forecasting cho FinOps (nối 127 DW)
- Multi-model — route cheaper khi capacity tight (178)
