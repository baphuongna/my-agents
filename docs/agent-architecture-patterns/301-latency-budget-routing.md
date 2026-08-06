# Hướng KO: Latency-Budget Routing — route model theo budget deadline/SLA

> **Nguồn gốc:** gRPC deadlines; deadline-aware scheduling; adaptive request routing; SLO routing; Tail latency (Dean "Tail at Scale")
> **Coupling:** 🟢 — router tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (routing/cascade sẵn — thiếu latency-budget logic)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Deadline-aware routing**: mỗi request mang **deadline** (thời gian tối đa); router chọn route/resource đủ nhanh để kịp. gRPC deadline: propagate qua call chain, hủy khi hết. Dean "The Tail at Scale" (2013): p99 latency quan trọng — phải giảm đuôi. Adaptive routing (Netflix/Google): chọn instance nào đang nhanh (load thấp). Nguyên tắc: request có **deadline budget** → router chọn model/route kịp deadline — request gấp → model nhanh (có thể kém hơn), request rảnh → model mạnh (chậm hơn, chất lượng cao hơn). Nối 215 deadline-bound + 59 cascade.

## Mô tả

mya latency-budget routing: mỗi request có **deadline budget** (VD: user đợi → 2s, job nền → 30s). Router chọn model: budget ngắn → model nhanh (haiku/local 211) kịp; budget dài → model mạnh (opus) chất lượng cao hơn. Nếu model chậm quá (latency đo được) → fallback model nhanh hơn (59 cascade). Khác 178 dynamic-model-routing (chọn theo task/quality): KO chọn theo **deadline còn lại** — deadline-driven. Nối 301 budget-aware (KO là nền).

## Kiến trúc

```
  REQUEST + deadline budget
  (2s gấp | 30s nền)
        │
        ▼
  ┌──────────── LATENCY-BUDGET ROUTER ────────────┐
  │  budget còn lại?     model latency đo?  chọn  │
  │  ─────────────────   ───────────────────────  │
  │  2s  (gấp)           opus 8s ❌ quá chậm      │
  │                       sonnet 2s ✓ vừa kịp ───►│ sonnet
  │  30s (nền)           opus 8s ✓ kịp ─────────►│ opus (chất lượng cao)
  │                       (budget dài → model mạnh)│
  └───────────────────────────────────────────────┘
        │ nếu model chậm quá (latency > budget)
        ▼ fallback
  cascade (59) → model nhanh hơn kịp deadline
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 178 dynamic-model-routing — route theo task (nền)
// ✅ 59 model-cascade — fallback model (KO dùng)
// ✅ 152 intent-router — route theo intent
// ✅ 215 deadline-bound-execution — deadline (KO consume)
// ✅ 43 routing — routing chung
// ✅ 211 model-quantization — local model nhanh (ứng viên budget ngắn)

// ❌ THIẾU: latency budget propagation (deadline → router)
// ❌ THIẾU: latency đo mỗi model (cơ sở chọn)
// ❌ THIẾU: budget-aware selection (chọn kịp deadline)
// ❌ THIẾU: deadline-fallback (chậm quá → cascade)
```

## Implementation

```typescript
// packages/agent/src/latency-router.ts (NEW)
interface ModelInfo { name: string; p50LatencyMs: number; p99LatencyMs: number; quality: number; }

class LatencyBudgetRouter {
  constructor(private models: ModelInfo[]) {}

  pick(deadlineMs: number): ModelInfo {
    // Chọn model mạnh nhất vẫn kịp p99 deadline (giảm tail)
    const feasible = this.models
      .filter((m) => m.p99LatencyMs <= deadlineMs) // kịp deadline
      .sort((a, b) => b.quality - a.quality);       // mạnh nhất
    if (feasible.length) return feasible[0];

    // Không model kịp → model nhanh nhất (cố gắng, có thể cascade)
    return this.models.sort((a, b) => a.p99LatencyMs - b.p99LatencyMs)[0];
  }

  // Nếu model chậm quá (vượt budget) → cascade (59) sang nhanh hơn
  async runWithFallback(prompt: string, deadlineMs: number): Promise<string> {
    const start = Date.now();
    const choice = this.pick(deadlineMs);
    const remaining = deadlineMs - (Date.now() - start);
    try {
      return await this.callWithTimeout(choice.name, prompt, remaining);
    } catch {
      const faster = this.pick(remaining / 2); // budget còn ít → model nhanh
      return this.callWithTimeout(faster.name, prompt, remaining); // cascade
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Kịp SLA/deadline (gRPC deadline proven) | ❌ Cần đo latency mỗi model (động) |
| ✅ Giảm tail latency (Dean — p99) | ❌ Model nhanh có thể kém chất lượng |
| ✅ Trade-off quality/speed tự động theo budget | ❌ Cascade tốn thêm request (cost) |
| ✅ Nối 59 cascade + 178 routing | ❌ Latency đo có noise → chọn sai |

## Khác các hướng gần

| | 178 Dynamic Routing | 59 Model Cascade | KO: Latency-Budget |
|---|---|---|---|
| Chọn theo | Task/intent | Fallback khi fail | **Deadline còn lại** |
| Mục | Quality/task | Recovery | **Kịp SLA** |
| Tail | ❌ | ❌ | ✅ giảm p99 |
| Budget | ❌ | ❌ | ✅ propagate deadline |

## Khi nào chọn

- User có deadline/SLA rõ (chat gấp vs batch nền)
- Cần giảm tail latency (p99 quan trọng)
- Có nhiều model tốc độ khác nhau (211 local nhanh + cloud mạnh)
- OK trade quality/speed theo budget
