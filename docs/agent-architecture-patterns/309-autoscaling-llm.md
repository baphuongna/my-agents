# Hướng KW: Autoscaling LLM — autoscale theo tín hiệu queue-depth/latency

> **Nguồn gốc:** KEDA (Kubernetes Event-Driven Autoscaling); HPA/VPA (Horizontal/Vertical Pod Autoscaler); queue-depth autoscaling; AWS Application Auto Scaling
> **Coupling:** 🟡 — cần autoscaler layer + metric pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (rate-limit/pool sẵn — thiếu autoscale loop)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Autoscaling** (Kubernetes): điều resource theo tải. **HPA** (Horizontal): scale số pod theo metric (CPU/custom). **KEDA**: scale theo event source (queue depth — Kafka/SQS). Nguyên tắc KEDA: "scale based on number of items needing to be processed" — queue sâu → scale lên, queue cạn → scale xuống. AWS Application Auto Scaling: target tracking (giữ metric ở ngưỡng). Nguyên tắc chung: **đo tín hiệu** (queue depth, latency, p99) → **điều capacity** (thêm/bớt worker/instance) giữ SLA.

## Mô tả

mya autoscaling: đo tín hiệu — **queue depth** (task đợi), **latency** (p99 — KO budget), **error-rate** (429 rate-limit 196). Khi queue sâu / latency cao → scale lên (thêm agent worker, thêm LLM concurrency). Khi tải thấp → scale xuống (tiết kiệm). Nối 196 rate-limiting (tín hiệu) + 174 failover. Khác pool cố định (18): autoscale **động** theo tải — co giãn, không quá tải không lãng phí. Cần cold-start cân nhắc (311 warm-pool).

## Kiến trúc

```
  ┌────────── AUTOSCALER LOOP (KEDA-style) ──────────┐
  │                                                  │
  │  SIGNAL COLLECTOR (mỗi 30s):                     │
  │   queue-depth: 24 task đợi                        │
  │   latency p99:   4.8s  (target ≤ 2s)             │
  │   429-rate:      12%   (rate-limit 196)          │
  │         │                                        │
  │         ▼ so với target                          │
  │  ┌──────────────────────────────────┐            │
  │  │ DECISION: scale UP                │            │
  │  │  queue-depth > 10 → +worker       │            │
  │  │  p99 > target    → +concurrency   │            │
  │  │  429-rate > 5%   → +capacity      │            │
  │  └──────────────┬───────────────────┘            │
  │                 ▼                                │
  │  CAPACITY: 4 worker → 8 worker                   │
  │  (cooldown 60s — tránh thrashing)                │
  │         │                                        │
  │         ▼ tải thấp                               │
  │  scale DOWN: 8 → 4 (giữ warm-pool 311)           │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 196 rate-limiting-quotas — rate-limit (tín hiệu 429)
// ✅ 18 connection-pool — pool (capacity co giãn)
// ✅ packages/agent/src/pool.ts — worker pool (scale対象)
// ✅ 174 fault-tolerance-failover — failover (khi capacity hết)
// ✅ 144 agent-fleet-management — fleet (nhiều agent)

// ❌ THIẾU: autoscaler loop (thu thập tín hiệu → quyết)
// ❌ THIẾU: signal collector (queue-depth/latency/429)
// ❌ THIẾU: scale policy (target tracking + cooldown)
// ❌ THIẾU: warm-pool để giảm cold-start (311)
```

## Implementation

```typescript
// packages/agent/src/autoscaler.ts (NEW)
interface Signals { queueDepth: number; latencyP99Ms: number; rateLimitRate: number; }

class Autoscaler {
  constructor(
    private targets: { maxQueue: number; maxP99Ms: number; max429: number },
    private minWorkers = 2, private maxWorkers = 50,
    private cooldownMs = 60_000,
  ) {}
  private lastChange = 0;

  async tick(workers: number, sig: Signals): Promise<number> {
    if (Date.now() - this.lastChange < this.cooldownMs) return workers; // anti-thrash

    let desired = workers;
    if (sig.queueDepth > this.targets.maxQueue) desired = Math.ceil(workers * 1.5);
    if (sig.latencyP99Ms > this.targets.maxP99Ms) desired = Math.ceil(workers * 1.3);
    if (sig.rateLimitRate > this.targets.max429) desired += 2;          // 196 → +capacity
    if (sig.queueDepth === 0 && sig.latencyP99Ms < this.targets.maxP99Ms / 2) {
      desired = Math.floor(workers * 0.7);                              // tải thấp → giảm
    }
    desired = Math.max(this.minWorkers, Math.min(this.maxWorkers, desired));
    if (desired !== workers) this.lastChange = Date.now();
    return desired;
  }
}
setInterval(() => scaler.tick(current, collect()), 30_000);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Co giãn theo tải (KEDA/HPA proven) | ❌ Cold-start khi scale lên (cần 311 warm) |
| ✅ Giữ SLA (latency ≤ target) | ❌ Thrashing nếu cooldown thiếu (scale liên tục) |
| ✅ Tiết kiệm tải thấp (scale xuống) | ❌ Tín hiệu có noise → scale sai |
| ✅ Nối 196 (429) + 18 (pool) | ❌ Min/max worker cần tune |

## Khác các hướng gần

| | 196 Rate Limiting | 18 Connection Pool | KW: Autoscaling LLM |
|---|---|---|---|
| Khi tải cao | 429 (chặn) | Queue | **Scale lên (thêm capacity)** |
| Mục | Bảo vệ | Tái dùng | **Co giãn động** |
| Signal | ❌ (giới hạn) | ❌ | ✅ queue/latency/429 |
| Tiết kiệm | ❌ | ❌ | ✅ scale xuống |

## Khi nào chọn

- Tải biến động (peak/valley) — cần co giãn
- Muốn giữ SLA latency dưới tải cao (KO budget)
- Có cold-start vấn đề → kết hợp 311 warm-pool
- OK tune min/max worker + cooldown (anti-thrash)
