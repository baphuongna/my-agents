# Hướng OOOOOOOO: Rate Limiting & Quotas — chặn agent đốt ngân sách/API: token bucket + quota + circuit breaker

> **Nguồn gốc:** TrueFoundry "Rate Limiting AI Agents" (prevent runaway agent loops — destroy budget in minutes — token buckets, circuit breakers); neuraltrust "Rate Limiting & Throttling for AI Agents" (control costs, prevent abuse); tetrate "Understanding Rate Limiting in AI Systems" (control model usage cost — restrict expensive inference); Tamir Dresher "9 AI Agents, One API Quota" (rate limiting multi-agent = coordination problem, không phải retry); zuplo "Rate Limit Beyond Request Counts" (short-term limits + long-term quotas theo plan; request-count + token-based)
> **Coupling:** 🟡 — mọi LLM/tool call phải qua limiter
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (GGGG budget + NN breaker sẵn; thiếu rate limit layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Rate limiting: **giới hạn tần suất/tổng token mỗi agent/user — chống loop vô hạn đốt budget, bảo vệ quota API, công bằng giữa agent** — TrueFoundry: "prevent runaway AI agent loops from destroying your budget in minutes — token buckets, circuit breakers"; tetrate: "restricting the number of expensive model inference operations within specified time periods" (kiểm soát cost qua số lượng); Bavlin: rate limits dựa trên tokens + requests (không chỉ request count); Tamir: "rate limiting in multi-agent systems is a coordination problem, not a retry problem — 9 agents share the same API quotas, independent retry causes thundering herd"; zuplo: "layer short-term rate limits with longer-term quotas tied to the consumer's plan — combine request-count with token-based". Điểm khác **GGGG budget** (giới hạn chi tiêu TOÀN VÒNG — cost cap) và **LLLLLLL attribution** (đo) — OOOOOOOO *giới hạn kỹ thuật*: (1) token bucket — nước vào đều, cháy nhanh khi burst (TrueFoundry — token bucket), tokens/second + burst cap; (2) quota plan — khách/agent có quota theo plan (zuplo — long-term tied plan); (3) liên agent — ĐIỀU PHỐI quota chia sẻ (Tamir — 9 agent 1 quota API: coordination, không để từng cái retry độc lập → thundering herd); (4) xếp hàng + backoff — quá limit: queue hoặc backoff + retry sau (có jitter — Bell); (5) đa lớp — request-count + token-based (zuplo — đếm cả 2); (6) theo dõi — dùng cùng YYY + alert (MCKinsey KKKKKKKK — business). Nối GGGG (budget — chiều cuối), LLLLLLL (attribution — ai), I (184? gateway), YYY (metric/thứ), NN (circuit breaker — một nguồn lỗi lặp), 178 (routing — chuyển model khi full), KKKKKKKK (pricing — quota = giới hạn vùng).

## Kiến trúc

```
  LLM/TOOL CALL ──► RATE LIMIT LAYER (TrueFoundry)
        │
        ├── TOKEN BUCKET: đều + burst (tetrate — control cost/time)
        ├── QUOTA PLAN (zuplo): quota per user/agent/plan (long-term)
        ├── COORDINATE (Tamir): nhiều agent chung 1 quota — không retry độc lập
        │     → lock hàng đợi chung (chống thundering herd)
        └── ĐẾM: request-count + token-based (zuplo double)
        │
        ▼
  QUÁ LIMIT: xếp hàng + backoff jitter (reload I breaker NN) · GGGG budget cap
   · MODEL ROUTING (178) khi gần quota
```

```
mya: GGGG + NN + gateway SẴN — thiếu: rate limit + quota coordination
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GGGG budget — chi tiêu cap (nền)
// ✅ NN circuit breaker — ngắt nguồn lỗi (nền)
// ✅ BBB gateway — chặn giữa (chèn layer)
// ✅ LLLLLLL attribution — ai tiêu (thuế per agent/user)
// ✅ YYY — alert (vượt ngưỡng)
// ✅ 178 routing — hạ model khi gần hết (nền degr)
// ✅ RRR retry — backoff (nền)

// ❌ THIẾU: token bucket / rate limiter (tần số cụ thể)
// ❌ THIẾU: quota per plan/tenant (zuplo)
// ❌ THIẾU: coordination giữa agent (Tamir — shared quota queue)
```

## Implementation

```typescript
// packages/ratelimit/src/limiter.ts (NEW)
export class RateLimiter {
  async call(req: LlmRequest): Promise<Out> {
    await bucket.take(req.tokens);            // token bucket (TrueFoundry)
    await quota.check(req.owner, req.tokens); // zuplo — plan quota
    return queue.coord(ti.Thread aapi, req);  // Tamir — agents share coordination
  } // quá hạn: wait/backoff (RRR + NN) — chứ không retry mù (thundering herd)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không "destroy budget trong vài phút" (TrueFoundry) | ❌ Cần tinh chỉnh ngưỡng — quá chặt chậm |
| ✅ Multi-agent không "thundering herd" (Tamir) | ❐ Xếp hà̀ng làm tăng latency (chờ quota) |
| ✅ Bảo vệ quota API — không bị provider cắt | ❌ Ngưỡng sai nghẹn người xài nhiều chính đáng |
| ✅ Xây trên BBB + GGGG + NN | ❌ Limiting/security hệ mới — nhiều lớp phức tạp |

## Khác các hướng gần

| | GGGG Budget | Flemming | OOOOOOOO: Ratelimit |
|---|---|---|---|
| Đối tượng | Tiền | — | **Tần số/token per thời gian** |
| Cơ chế | Cap số tiền | — | **Token bucket + quota + queue** |
| Quan hệ | Chặn tiêu | — | **Chặn chạy quá nhiều** |

## Khi nào chọn

- agent tự động nhiều — nguy cơ loop đốt budget (TrueFoundry)
- Nhiều agent chung provider quota (Tamir code)
- Bán/tin cậy — cần quyền đáng + fairness (zuplo plan)
- Đã có BBB + GGGG + quản lý — thêm rate limiter + coordination