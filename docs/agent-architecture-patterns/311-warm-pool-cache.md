# Hướng KY: Warm Pool / Model Cache — giữ model ấm, giảm cold-start latency

> **Nguồn gốc:** AWS Lambda provisioned concurrency; connection pool keep-alive; HTTP/2 keep-alive; preload/warm-up; model warm cache
> **Coupling:** 🟡 — cần pool manager + health check
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (connection-pool/prompt-cache sẵn — thiếu model warm pool)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Warm pool / provisioned concurrency** (AWS Lambda): giữ instance ấm sẵn (đã load, đã connect) → request đầu tiên không bị **cold-start** (load runtime + init tốn giây). Keep-alive (HTTP/2, TCP): giữ connection mở, tái dùng — không handshake mỗi request. **Model warm cache**: model đã load vào GPU memory, KV-cache sẵn → không load lại (load model tốn 10-60s). Nguyên tắc: giữ resource "nóng" sẵn sàng, **không để idle die** — giảm first-request latency.

## Mô tả

mya warm pool: duy trì N agent worker / model-load **ấm** — đã init (62 credential loaded, model loaded vào memory, prompt-cache 90 sẵn). Khi request đến → gán vào worker ấm ngay (latency thấp); không phải cold-start (load model + init). Health check giữ worker sống; khi tải thấp → co về min (KW autoscale) nhưng giữ warm. Nối 18 connection-pool + 90 prompt-caching. Khác pool thường (18): warm pool **chủ động giữ nóng** (preloaded), không khởi tạo lười.

## Kiến trúc

```
  ┌──────────── WARM POOL MANAGER ────────────┐
  │                                           │
  │  WARM WORKERS (preloaded, sẵn sàng):      │
  │   W1: model-loaded ✓ cred ✓ cache 90 ✓    │
  │   W2: model-loaded ✓ cred ✓ cache 90 ✓    │
  │   W3: model-loaded ✓ cred ✓ cache 90 ✓    │  (min warm)
  │                                           │
  │  REQUEST đến:                             │
  │   → gán W1 ngay (latency ~0, no cold)     │
  │   W1 bận → W2 → W3...                     │
  │   tất cả bận + tải cao → scale (KW)       │
  │   worker mới = COLD (load model 30s)      │
  │                                           │
  │  HEALTH CHECK (mỗi 60s):                  │
  │   worker sống? keep warm.                 │
  │   worker chết? khởi lại warm (preempt)    │
  │                                           │
  │  tải thấp: co về min, nhưng GIỮ WARM      │
  │  (không để idle die → cold-start lại)     │
  └───────────────────────────────────────────┘
  = first-request nhanh (no cold-start 30s)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 18 connection-pool — pool (reuse, keep-alive nền)
// ✅ 90 prompt-caching / 92 semantic-caching — cache (warm prompt)
// ✅ packages/agent/src/pool.ts — pool (warm対象)
// ✅ 67 serverless-agents — serverless (cold-start vấn đề)
// ✅ 211 model-quantization — local model (load tốn thời gian)
// ✅ 292 lifecycle-hooks — onInit (preload worker)

// ❌ THIẾU: warm pool manager (giữ worker nóng)
// ❌ THIẾU: preload (model + cred + cache khi init, 292)
// ❌ THIẾU: health check keep-warm (không để idle die)
// ❌ THIẾU: min-warm floor (luôn giữ N worker nóng)
```

## Implementation

```typescript
// packages/agent/src/warm-pool.ts (NEW)
interface WarmWorker { id: string; loaded: boolean; lastUsed: number; busy: boolean; }

class WarmPool {
  private workers: WarmWorker[] = [];
  constructor(private minWarm: number, private idleTimeoutMs = 5 * 60_000) {
    setInterval(() => this.healthCheck(), 60_000); // keep warm
  }

  async ensureWarm(): Promise<void> {
    // preload minWarm worker (model + cred + cache 90) — warm sẵn
    while (this.workers.filter((w) => w.loaded && !w.busy).length < this.minWarm) {
      const w: WarmWorker = { id: id(), loaded: false, lastUsed: Date.now(), busy: false };
      await preload(w);   // load model + cred (292 onInit) + prompt-cache 90
      w.loaded = true;    // WARM
      this.workers.push(w);
    }
  }

  acquire(): WarmWorker | null {
    const w = this.workers.find((x) => x.loaded && !x.busy); // warm → latency ~0
    if (w) { w.busy = true; w.lastUsed = Date.now(); }
    return w ?? null; // null = tất cả bận → scale (KW) hoặc queue
  }

  release(w: WarmWorker): void { w.busy = false; w.lastUsed = Date.now(); }

  private healthCheck(): void {
    for (const w of this.workers) {
      if (w.loaded && !w.busy && Date.now() - w.lastUsed > this.idleTimeoutMs) {
        // idle lâu → nhưng GIỮ warm nếu còn trong minWarm
        const idleCount = this.workers.filter((x) => x.loaded && !x.busy).length;
        if (idleCount > this.minWarm) this.evict(w); // vượt min → cho die
      }
    }
    void this.ensureWarm(); // bổ sung warm nếu thiếu
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm cold-start latency (provisioned concurrency proven) | ❌ Chi phí giữ warm (tốn resource idle) |
| ✅ First-request nhanh (model đã load) | ❌ Min-warm cần tune (quá nhiều = lãng phí) |
| ✅ Local model (211) đặc biệt cần (load 30s) | ❌ Health check overhead |
| ✅ Nối 18 (pool) + 90 (cache) + KW (autoscale) | ❌ Worker "nóng" tốn memory/GPU liên tục |

## Khác các hướng gần

| | 18 Connection Pool | 90 Prompt Caching | KY: Warm Pool |
|---|---|---|---|
| Giữ ấm | Connection | Prompt/KV | **Toàn worker (model+cred+cache)** |
| Mục | Tái dùng conn | Skip recomputation | **No cold-start** |
| Cold-start | ❌ | ❌ | ✅ giải quyết |
| Cost | Thấp | Thấp | ❌ tốn (giữ idle) |

## Khi nào chọn

- Self-host/local model (211) — cold-start nặng (load 30-60s)
- First-request latency quan trọng (UX, SLA)
- Serverless (67) — provisioned concurrency
- OK tốn resource idle để đổi first-request nhanh
