# Hướng JL: Graceful Degradation — chế độ rút gọn năng lực khi quá tải/thiếu tài nguyên, không chết cứng

> **Nguồn gốc:** Wikipedia "Graceful degradation" (hệ thống tiếp tục chạy với chức năng giảm thay vì crash); AWS well-architected "degraded mode" (load shedding, reduced features); Netflix "Graceful Degradation" (fallback khi dependency fail); Stripe "load shedding" (reject/throttle, serve reduced); Cloudflare "fail open vs fail closed"; Litmus "degraded LLM features" (cheaper model fallback under load)
> **Coupling:** 🟡 — cần feature-flag toggle + provider fallback
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (feature flag sẵn HM; chưa có degradation policy tự động)
> **Effort:** 2-3 tuần

## Nguồn gốc

Graceful degradation (Wikipedia): hệ thống mất 1 phần năng lực vẫn chạy *giảm chức năng* thay vì sập hoàn toàn — VD web mất JS vẫn đọc text. AWS load shedding: khi quá tải, *bỏ* request ít quan trọng, phục vụ request chính (priority queue). Netflix: khi dependency fail → fallback (cache, default, reduced response). Litmus áp cho LLM: dưới tải cao, chuyển model đắt → model rẻ, tắt tool phụ (web search), giảm context — vẫn trả được câu trả lời cơ bản. Khác **HM (221) feature flags** (cơ chế bật/tắt năng lực) — JL là *policy tự động* dùng flag theo tín hiệu tải; khác **FM (169) self-healing** (phục hồi khi lỗi) — JL *chấp nhận giảm* thay vì cố phục hồi đầy đủ; khác **AP (42) circuit breaker** (dừng gọi provider chết) — JL chọn *đường thay thế giảm* khi provider sống nhưng chậm.

## Mô tả

mya graceful degradation: định nghĩa các "tier" năng lực — Tier 0 (đầy đủ: model lớn + tool + context dài), Tier 1 (model rẻ + tool chính), Tier 2 (chỉ LLM text, không tool). Khi latency/provider-cost/quota vượt ngưỡng → tự hạ tier (dùng tín hiệu từ HG deadline, DW finops, AP rate-limit). User thấy agent chậm hơn / kém tool nhưng *vẫn đáp* được. mya có feature flag (HM) và provider fallback — JL thêm monitor tín hiệu + auto-switch tier.

## Kiến trúc

```
  SIGNALS: latency↑ | quota near | cost↑ | provider degraded
        │
        ▼
  DEGRADATION POLICY ──► chọn TIER
   Tier 0: full (model-A + all tools + long ctx)
   Tier 1: reduced (model-B cheaper + core tools)
   Tier 2: minimal (text LLM only, no tools)
        │
        ▼
  SERVE (vẫn đáp — giảm chức năng, KHÔNG 500/sập)
        │
   signals recover ──►回升 Tier 0 (HM flag toggle)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ HM (221) feature flags — bật/tắt năng lực (sẵn cơ chế)
// ✅ provider fallback — đổi provider khi fail (sẵn)
// ✅ AP (42) rate-limit + HG (215) deadline — tín hiệu tải (sẵn)
// ✅ GU (203) retry + FM (169) self-heal

// ❌ THIẾU: degradation tier definition (Tier 0/1/2 năng lực)
// ❌ THIẾU: auto-switch theo tín hiệu (monitor → policy)
// ❌ THIẾU: recovery promotion (hạ rồi phải lên lại khi hồi)
```

## Implementation

```typescript
// packages/degrade/src/policy.ts (NEW)
type Tier = 0 | 1 | 2;
function pickTier(signals: { latency: number; quotaLeft: number; costRate: number }): Tier {
  if (signals.quotaLeft < 0.1 || signals.latency > 8000) return 2;   // minimal
  if (signals.costRate > budgetPerMin || signals.latency > 3000) return 1; // reduced
  return 0;                                                          // full
}
async function serveDegraded(req: Request, tier: Tier): Promise<Response> {
  const flags = tierConfig(tier);                 // model, maxTools, ctxLen theo tier
  await flags.apply();                            // HM feature flag toggle
  return agent.run(req, flags);                   // vẫn đáp — giảm chức năng
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không sập dưới tải — vẫn phục vụ (AWS/Wikipedia) | ❌ Chất lượng giảm — user nhận kết quả kém tool/model |
| ✅ Load shedding bảo request chính (priority) | ❌ Tier boundary phức — giảm quá nhiều = vô dụng |
| ✅ Che provider chậm — fallback model rẻ (Litmus) | ❌ User bối rối nếu không thông báo đang degraded |
| ✅ Tự hồi phục khi tín hiệu tốt lại (promotion) | ❌ Flapping — toggle liên tục Tier 0↔1 (cần hysteresis) |

## Khác các hướng gần

| | FM Self-Heal | AP Circuit-Breaker | JL: Degradation |
|---|---|---|---|
| Khi sự cố | Phục hồi đầy đủ | Dừng gọi provider | **Chấp nhận giảm năng lực** |
| Mục | Khôi phục | Tránh lỗi lan | **Tiếp tục phục vụ (giảm)** |
| Kết quả | Full lại | Fail open/closed | **Tier thấp hơn vẫn chạy** |

## Khi nào chọn

- Provider hay chậm/quota cạn — muốn vẫn đáp thay vì 500
- Cost nhạy (DW finops) — dưới tải chuyển model rẻ tiết kiệm
- Năng lực chia tier rõ (core vs optional tool) — có thể tắt optional
- Luôn: thông báo user đang degraded + hysteresis chống flapping
