# Hướng BC: Mixture of Agents (MoA) — nhiều lời giải, một kết luận

> **Nguồn gốc:** Together AI, 2024 (arXiv 2406.04692); inspired by Mixture-of-Experts
> **Coupling:** 🟢 — các agent/model độc lập, aggregator gom
> **Agent-agnostic:** ✅ — bất kỳ model/agent trả lời được
> **Code sẵn:** ⚠️ (1 phần — ProviderRegistry + tier routing sẵn; thiếu aggregator layer)
> **Effort:** 2 tuần

## Nguồn gốc

MoA (Wang et al., Together AI 2024): gửi **cùng một query** cho nhiều model/agent chạy song song, mỗi cái đưa một lời giải độc lập, sau đó **aggregator** (model tổng hợp) chọn/gộp thành câu trả lời cuối. Paper gốc đạt 65.1% trên AlpacaEval 2.0 (beat GPT-4 Omni 57.5%) với stack 3 tầng mở. Ý tưởng mượn từ Mixture-of-Experts: nhiều "chuyên gia" thay vì một. Khác KK MapReduce (chia **task** ra làm) — MoA chia **lời giải**: cùng 1 việc, nhiều cách trả lời, gom lại.

## Mô tả

mya gặp câu hỏi quan trọng (thiết kế, đánh giá code) → gửi cho N provider/model khác nhau (deepseek + pi + claude qua registry) → mỗi bên trả lời không biết nhau → **aggregator model** nhận N lời giải + rationale → tổng hợp (đồng thuận, nêu khác biệt, đánh giá điểm mạnh) → 1 câu trả lời cuối. Có thể **layered**: output tầng 1 là input tầng 2. Khác JJ (critic phản biện theo vòng lặp) — MoA tổng hợp song song một lượt, không tranh luận.

## Kiến trúc

```
                    ┌─ deepseek (lời giải A) ──┐
  query ──► fan-out ├─ pi (lời giải B) ────────┼──► AGGREGATOR ──► kết luận cuối
   (cùng task)      └─ claude (lời giải C) ───┘   (đánh giá + gộp)
                    (ProviderRegistry: chạy song song, độc lập)

  Layer 2 (tuỳ chọn): kết luận tầng 1 ──► 3 aggregators ──► aggregator tầng 2
  Cost: N×query + 1×aggregate  (SS: budget gating để chặn lố)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai/src/registry.ts — ProviderRegistry (nhiều provider, taint/quota)
// ✅ packages/ai/src/model-routing.ts — resolveModelForPhase + ModelTier (small/medium/big)
// ✅ packages/ai/src/fallback.ts — FallbackResult (đã có failover giữa providers)
// ✅ packages/print/src/council.ts — hợp tác nhiều agent (có thể tái dùng cho aggregator)

// ❌ THIẾU: fan-out 1 query → N model đồng thời + gom kết quả
// ❌ THIẾU: aggregator prompt (đánh giá chéo N lời giải, không chỉ vote)
```

## Implementation

```typescript
// packages/ai/src/mixture-of-agents.ts (NEW)
interface MoARequest {
  task: string;
  candidates: string[];       // [deepseek, pi, claude] — từ ProviderRegistry
  aggregateModel?: string;    // mặc định tier big (model-routing)
}

async function runMoA(req: MoARequest): Promise<{ final: string; answers: string[] }> {
  const answers = await Promise.all(           // fan-out độc lập
    req.candidates.map((m) => runOnce(req.task, m)),
  );
  return { final: await aggregate(answers, req.aggregateModel), answers };
}

async function aggregate(answers: string[]): Promise<string> {
  // aggregator: tóm từng lời giải, nêu đồng thuận + khác biệt, chọn tốt nhất
  // ── không chỉ vote đa số — đánh giá chất lượng từng lời giải
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chất lượng cao hơn model đơn lẻ (paper: +7.6% AlpacaEval) | ❌ Cost ×N + aggregator (cần SS budget gating) |
| ✅ Không cần fine-tune, dùng model đang có | ❌ Latency = model chậm nhất (Q pool giúp) |
| ✅ Registry + tier routing sẵn → chỉ thêm layer | ❌ Aggregator có thể chọn nhầm nếu lời giải đều sai |
| ✅ Layered: tăng chất lượng tầng theo tầng | ❌ Trùng lặp reasoning (N model cùng cách suy luận) |
| ✅ Error-resistant: 1 provider hỏng → vẫn có lời giải | |

## Khác các hướng gần

| | KK MapReduce | JJ Adversarial | DDD: MoA |
|---|---|---|---|
| Chia gì | Task thành phần | 1 agent sinh, 1 agent phản biện | Cùng task, N lời giải |
| Vòng lặp | 1 lượt | Nhiều vòng critic | 1 lượt + aggregator |
| Mục đích | Song song hóa | Chất lượng qua phản biện | Chất lượng qua ensemble |
| Cost | ~1 task | 2-4× | N× + aggregator |

## Khi nào chọn

- Câu hỏi quan trọng cần nhiều góc nhìn (thiết kế, review kiến trúc)
- Đã có nhiều provider trong registry, chưa dùng hết
- Budget cho phép N× cost (SS đi kèm bắt buộc)
- Muốn cải thiện chất lượng mà không fine-tune
