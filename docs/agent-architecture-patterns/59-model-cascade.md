# Hướng HHH: Model Cascade — bậc rẻ trước, escalate khi thiếu tự tin

> **Nguồn gốc:** Fuego et al., 2023 (arXiv 2312.11444); hệ Cascade (NVIDIA)
> **Coupling:** 🟢 — chỉ quanh 1 request qua các tier
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tier routing + fallback sẵn; thiếu confidence gating)
> **Effort:** 1 tuần

## Nguồn gốc

Model cascade (Fuego et al. 2023): gửi request cho **model rẻ nhất trước** (tier small) → **judge độ tự tin** (confidence) → nếu đủ tự tin thì trả ngay; nếu thấp → **escalate** bậc lớn hơn (medium → big) cho đến khi đủ. Paper chính: cascade 1.1 tỷ param cắt 99.04% chi phí so với chỉ dùng model 70B trên TruthfulQA với độ chính xác gần tương đương; cascade 3 bậc cắt ~91%. Khác **RR Routing** (chọn model theo *loại task* tĩnh) và **SS Budget Gating** (trần cứng) — cascade escalate theo **tín hiệu khó/confidence** của từng request.

## Mô tả

mya nhận task → **resolveModelForPhase (RR)** chọn tier mặc định (small) → chạy **small model** trước → **judge**: độ tin cậy đầu ra (tự chấm điểm, xác suất, self-consistency 2 lần chạy, hoặc có lexer/test nhanh) → dưới ngưỡng → **escalate medium** với *kết quả small làm context* → vẫn nghi ngờ → **big model** → xong. Fallback hiện có (fallback.ts) chỉ xử lý *lỗi provider* (auth/quota/network) — cascade thêm chiều *chất lượng*: không phải fail mới đổi, mà **đủ khó thì đổi**. Kết hợp SS: chặn escalate vô hạn (max tier theo budget).

## Kiến trúc

```
  task ──► RR: chọn tier bắt đầu (mặc định small)
              ▼
        SMALL model ──► JUDGE (confidence)
        │ đủ tự tin ──► trả ngay ✅ (rẻ nhất)
        │ thiếu ──► escalate (kèm output small làm hint)
        ▼
        MEDIUM model ──► JUDGE
        │ đủ ──► trả ✅
        ▼
        BIG model ──► trả (không escalate nữa)
        (SS: max tier theo budget, không vượt)
```

```
mya: model-routing.ts (resolveTierModel) + fallback.ts (provider failover) sẵn
     ❌ thiếu: judge confidence + vòng escalate gắn vào request loop
```

## mya ĐÃ CÓ (phần lớn)

```typescript
// ✅ packages/ai/src/model-routing.ts — ModelTier small/medium/big + resolveTierModel
// ✅ packages/ai/src/registry.ts — ProviderRegistry (nhiều provider/model)
// ✅ packages/ai/src/fallback.ts — FallbackResult (failover theo lỗi provider/quota)
// ✅ packages/core/src/ratelimit.ts (SS) — chặn chạy lố khi escalate

// ❌ THIẾU: judge confidence (điểm tự tin sau output)
// ❌ THIẾU: vòng escalate: chỉ chạy bậc kế khi bậc hiện tại < ngưỡng
// ❌ THIẾU: truyền output bậc rẻ làm context cho bậc lớn (tiết kiệm)
```

## Implementation

```typescript
// packages/ai/src/cascade.ts (NEW)
type Tier = "small" | "medium" | "big";
const NEXT: Record<Tier, Tier | undefined> = { small: "medium", medium: "big", big: undefined };

async function cascade(task: string, start: Tier = "small"): Promise<Result> {
  let tier: Tier = start;
  let hint = "";

  while (tier !== undefined && budgetAllows(tier)) {       // SS gate
    const out = await runModel(resolveTierModel(tier), coerce(task, hint)); // RR/registry
    if (tier === "big" || judgeConfidence(out) >= THRESHOLD) return out;
    hint = compressHint(out);                               // output rẻ → context cho lớn
    tier = NEXT[tier]!;
  }
  return rejectOverBudget(task);                            // SS
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cắt chi phí lớn (paper: 91-99% tùy workload) | ❌ Judge confidence khó — chấm sai → trả nông hoặc over-cost |
| ✅ Tier ngưỡng không cần retrain — tinh chỉnh hằng số | ❌ Latency: escalate là chạy lại từ đầu (truyền hint giảm) |
| ✅ Tier system + fallback sẵn — chỉ thêm judge | ❌ Confidence calibration theo từng task khác nhau |
| ✅ Kết hợp tự nhiên RR (route mặc định) + SS (budget) | ❌ Task "khó nhưng rẻ làm được" vẫn trả bằng big |
| ✅ Độ chính xác gần bằng big model toàn bộ | |

## Khác các hướng gần

| | RR Routing | SS Budget Gating | HHH: Model Cascade |
|---|---|---|---|
| Chọn model theo | Loại task (tĩnh) | Trần tiêu thụ | **Confidence từng request** |
| Khi nào escalate | Không | Chặn trên | Đủ khó → bậc lớn |
| Trả giá | 1 lượt | Cắt giữa chừng | N lượt tăng dần |
| Mối quan hệ | Chọn tier bắt đầu | Chặn cascade lố | Dùng cả hai |

## Khi nào chọn

- Request đa dạng độ khó (nhiều câu dễ, ít câu khó)
- Đã có tier routing (RR) sẵn — cascade là bước tiếp theo
- Có tín hiệu tự tin dùng được (self-consistency, lexer/test nhanh, thang điểm)
- Đặt SS budget kèm theo để chặn escalate vô hạn