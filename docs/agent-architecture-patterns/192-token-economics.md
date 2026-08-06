# Hướng GJ: Token Economics & Pricing Models — định giá agent theo token/task/outcome; hiểu cơ cấu chi phí

> **Nguồn gốc:** McKinsey "Is That AI Agent Worth It? Agentic Economics" ("Tokens are not value; tokens are the bill" — 10% users ≈ 65% usage); Stanford Digital Economy "How are AI agents spending your tokens?" (cost cao ở INPUT tokens; agents không tự đoán được token cost); pickaxe "AI Agent Pricing Models" (token pricing confusing — billing anxiety); mightybot "2026 Pricing Models" (4 models: per-seat, per-token, per-task, per-outcome)
> **Coupling:** 🟡 — runtime phải đo chính xác token per entity
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (finops + attribution sẵn; thiếu pricing layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Token economics: **hiểu tiền thật của agent — cơ cấu (input/output), concentrate, và chọn model định giá (per-token/per-task/per-outcome)** — McKinsey: "Tokens are not value; tokens are the bill — 10% users account for about 65% of total usage" (usage rất tập trung); Stanford: "high cost is in input tokens rather than output — agents are not capable of predicting their own token costs" (input chiếm — vì context dài); MindStudio: "Total Cost = (Input × Input Price) + (Output × Output Price)"; mightybot: 4 pricing models — per-seat/per-token/per-task/per-outcome; pickaxe: pure usage pricing tạo "billing anxiety". Điểm khác **LLLLLLL cost attribution** (gán chi phí per task — kỹ thuật) — KKKKKKKK *góc kinh tế*: (1) cost model — công thức tổng (MindStudio), input vs output giá (output 3-10× — Kloudedge); (2) concentration — ít user dùng nhiều (McKinsey — thiết kế fair), agent dài hạn đốt input (Stanford); (3) forecasting — agent không tự biết chi phí trước (Stanford — cần estimate + budget LLLLLLL); (4) pricing — chọn model cho khách: per-token (rõ, anxiety — pickaxe), per-task (bình thường hóa), per-outcome (định giá theo giá trị — khi tin cậy cao), per-seat (agent nội bộ); (5) fairness — usage allowance (bucket tokens — pickaxe) tránh sốc hóa đơn; (6) metric — token per outcome/task (đo hiệu quả kinh tế — McKinsey "worth it"). Nối LLLLLLL (đo/attribution), YYY (finops — số liệu), WWWW (billing — hóa đơn), AAAAAAA (commerce — thanh toán), GGGG (budget — chặn vượt), 178 (routing — model rẻ theo task).

## Kiến trúc

```
  COST MODEL (MindStudio): Cost = In×P_in + Out×P_out (out 3-10× — Kloudedge)
        │
        ▼
  ĐO THỰC (LLLLLLL + YYY): token per agent/task/user · concentration (McKinsey)
   · input chiếm chủ yếu (Stanford — context dài)
        │
        ▼
  FORECAST (Stanford — agents không tự đoán): ước trước + budget (GGGG)
        │
        ▼
  PRICING MODEL (mightybot 4 models):
   · per-token (rõ nhưng anxiety — pickaxe) · per-task · per-outcome
   · per-seat (nội bộ) + usage allowance (bucket — tránh sốc)
        │
        ▼
  KINH TẾ (McKinsey): token per outcome — agent có đáng giá không
```

```
mya: LLLLLLL + YYY + AAAAAAA SẴN — thiếu: pricing + forecast layer
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ LLLLLLL attribution — cost per task (nền đo)
// ✅ YYY finops — metric + alert (số liệu thật)
// ✅ WWWW billing + AAAAAAA commerce — thanh toán (nền)
// ✅ GGGG budget — chặn vượt (forecast guard)
// ✅ 178 routing — hạ model rẻ (giảm cost)
// ✅ KKKKKKK prompt cache — giảm input cost

// ❌ THIẾU: cost model formula (input/output tách giá)
// ❌ THIẾU: usage concentration analysis (McKinsey — fair)
// ❌ THIẾU: pricing layer (chọn model per khách + allowance)
```

## Implementation

```typescript
// packages/econ/src/pricing.ts (NEW)
export class Pricing {
  cost(usage: Usage): Money {
    return usage.in * PRICE_IN + usage.out * PRICE_OUT; // MindStudio formula
  }
  forecast(agent: Agent): Money {                       // Stanford — ước trước
    return estimate(agent.history) * SAFETY_FACTOR;     // agents không tự đoán
  }
  bill(u: User, usage: Usage): Money {                  // mightybot models
    return plan(u).model === "per-task" ? perTask(usage) : perToken(usage);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết chính xác tiền thật — không giật mình cuối tháng (McKinsey) | ❌ Input chiếm phần lớn — phải tối ưu context (Stanford) |
| ✅ Định giá hợp lý theo 4 models (mightybot) | ❐ Forecast sai lệch (agents không tự đoán — Stanford) |
| ✅ Fair — usage allowance tránh billing anxiety (pickaxe) | ❌ Per-outcome khó định giá trị |
| ✅ Xây trên LLLLLLL + YYY + WWWW | ❌ Giá model thay đổi — công thức phải cập nhật |

## Khác các hướng gần

| | LLLLLLL Attribution | WWWW Billing | KKKKKKKK: Econ/Pricing |
|---|---|---|---|
| Góc | Kỹ thuật (đo) | Hóa đơn | **Kinh tế (định giá + cơ cấu)** |
| Trọng tâm | Task ID | Phát hành | **Cost model + pricing model** |
| Quan hệ | Nguồn đo | Phát tiền | **Tầng trên — quyết định giá** |

## Khi nào chọn

- Bán/meter agent cho khách (pricing theo task/token/outcome)
- Muốn hiểu cơ cấu: input/output, concentration (McKinsey 10/65)
- Tránh sốc hóa đơn — allowance + forecast (pickaxe/Stanford)
- Đã có LLLLLLL + YYY + WWWW — thêm pricing + forecast