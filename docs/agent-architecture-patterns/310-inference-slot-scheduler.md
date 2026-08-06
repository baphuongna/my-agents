# Hướng KX: Inference Slot Scheduler — scheduler slot batching/concurrency, throughput

> **Nguồn gốc:** Continuous batching (vLLM); admission control; slot scheduling; token bucket; batched inference (Orca)
> **Coupling:** 🟡 — cần scheduler trước LLM inference
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (rate-limit/pool sẵn — thiếu slot scheduler + batching)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Continuous batching** (vLLM/Orca, 2023): thay vì batch cố định (chờ đủ request → xử lý → chờ xong), vLLM ghép/lúc nào cũng đang xử lý — request mới chèn ngay khi có slot trống, request xong rời — **throughput cao**, không chờ idle. Orca (OSDI 2022): "iteration-level scheduling" — schedule mỗi iteration, không mỗi request. **Slot scheduling**: mỗi GPU có N slot (KV-cache budget); scheduler gán request vào slot, giới hạn concurrency. **Token bucket** (admission control): giới hạn rate, xếp hàng khi quá.

## Mô tả

mya inference slot scheduler: LLM endpoint có **slot giới hạn** (concurrency/KV-cache). Scheduler xếp request vào slot; khi full → queue (admission) thay vì 429 (196). **Batching**: ghép nhiều request nhỏ vào cùng batch → throughput cao (222). Schedule theo priority (KP budget). Nối 196 rate-limiting + 222 batch. Khác pool (18 — connection): KX schedule **inference slot** — gán request vào slot GPU, batch để tối ưu throughput.

## Kiến trúc

```
  REQUESTS đến (đa agent)
    │
    ▼
  ┌──────── SLOT SCHEDULER ─────────┐
  │                                │
  │  admission: queue khi slot đầy │
  │  (thay vì 429 reject — 196)    │
  │                                │
  │  BATCHING (vLLM continuous):   │
  │   ghép request vào batch chạy  │
  │   slot trống → chèn ngay       │
  │   request xong → rời slot      │
  │                                │
  │  priority (KP): cao vào trước  │
  └───────────────┬────────────────┘
                  ▼
  ┌──── LLM INFERENCE (N slots) ────┐
  │  slot1: [reqA][reqC]  (batched) │
  │  slot2: [reqB]                 │
  │  slot3: [reqD][reqE]  (batched) │
  │  slot4: [đang rời — reqX xong]  │
  │  → chèn reqF ngay (continuous)  │
  └────────────────────────────────┘
  Throughput cao: không idle, batch liên tục
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 196 rate-limiting-quotas — rate-limit (admission nền)
// ✅ 222 batch-llm-processing — batch (KX schedule)
// ✅ 18 connection-pool — pool (concurrency nền)
// ✅ 215 deadline-bound-execution — deadline (priority)
// ✅ 302 inference-budget-arbitration — priority (KX theo priority)

// ❌ THIẾU: slot scheduler (gán request vào slot giới hạn)
// ❌ THIẾU: continuous batching (chèn khi slot trống)
// ❌ THIẾU: admission queue (queue thay vì reject)
// ❌ THIẾU: KV-cache budget (slot = token budget)
```

## Implementation

```typescript
// packages/agent/src/slot-scheduler.ts (NEW)
interface InferReq { id: string; tokens: number; priority: number; }

class SlotScheduler {
  private slots: (InferReq | null)[] = []; // N slot
  private queue: InferReq[] = [];          // admission queue
  constructor(private numSlots: number, private maxKVCache: number) {
    this.slots = Array(numSlots).fill(null);
  }

  submit(r: InferReq): void { this.queue.push(r); this.queue.sort((a, b) => b.priority - a.priority); }

  // continuous batching (vLLM): mỗi tick chèn request vào slot trống
  schedule(): InferReq[] {
    const usedKV = this.slots.reduce((s, r) => s + (r?.tokens ?? 0), 0);
    for (let i = 0; i < this.numSlots && this.queue.length; i++) {
      if (this.slots[i]) continue;
      const next = this.queue[0];
      if (usedKV + next.tokens > this.maxKVCache) break; // KV-cache budget
      this.slots[i] = this.queue.shift()!;               // chèn vào slot trống
    }
    return this.slots.filter((r): r is InferReq => r !== null);
  }

  complete(reqId: string): void { // request xong → rời slot → chèn tiếp
    this.slots = this.slots.map((r) => (r?.id === reqId ? null : r));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Throughput cao (vLLM continuous batching) | ❌ Scheduler phức tạp (slot + KV-cache) |
| ✅ Queue thay vì reject (admission — ổn định) | ❌ Latency queue khi tải cao |
| ✅ Tối ưu GPU (KV-cache budget, batch) | ❌ Cần biết KV-cache mỗi request (ước lượng) |
| ✅ Nối 196 (rate-limit) + 222 (batch) | ❌ Priority starvation (thấp chờ lâu) |

## Khác các hướng gần

| | 196 Rate Limiting | 222 Batch LLM | KX: Slot Scheduler |
|---|---|---|---|
| Khi đầy | 429 reject | Batch cố định | **Queue + chèn liên tục** |
| Batching | ❌ | Cố định (chờ đủ) | **Continuous (chèn khi trống)** |
| Slot | ❌ | ❌ | ✅ KV-cache budget |
| Throughput | ❌ | Medium | ✅ cao (vLLM) |

## Khi nào chọn

- Self-host LLM (vLLM/local 211) — cần tối ưu GPU throughput
- Tải cao → muốn queue thay vì reject (ổn định hơn 429)
- Muốn batching liên tục (continuous — không idle)
- Cần priority scheduling (KP) + KV-cache budget
