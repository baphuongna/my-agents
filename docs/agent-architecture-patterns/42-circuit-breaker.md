# Hướng QQ: Circuit Breaker + Rate Limit — resilience trước LLM provider

> **Nguồn gốc:** Michael Nygard, Release It! (2007); Martin Fowler circuit breaker (2014)
> **Coupling:** 🟢 — transparent middleware giữa mya ↔ provider
> **Agent-agnostic:** ✅ — agents không cần biết
> **Code sẵn:** ⚠️ (1 phần — backoff rải rác, provider taint, RateLimiter; thiếu breaker thống nhất)
> **Effort:** 1 tuần

## Nguồn gốc

Circuit breaker (Nygard, 2007): gọi external service lặp lại trong lúc nó đang fail → **open** mạch, fail-fast trong cooldown, sau đó **half-open** probe 1 request thử — thành công thì **close**. LLM providers fail theo pattern riêng: rate-limit (429), quota (quota exceeded), timeout, 5xx — fail nhanh và fail nhiều lần liên tiếp. Retry+backoff (đã có rải rác) chưa đủ: cần **mạch hở** chặn gọi trong cooldown để không tốn cost + không bị chặn lâu hơn.

## Mô tả

Breaker đứng giữa mya và mỗi provider: theo dõi failure rate trong cửa sổ trượt; vượt ngưỡng → open (fail-fast, không gọi LLM); sau cooldown → half-open probe; phối hợp **provider taint** (packages/ai: profile bị taint auth/quota → bị skip) và **RateLimiter** (cap/rate theo platform). Khi mọi provider đều open → degrade: báo user, không treo session.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                 RESILIENCE LAYER (mya)                      │
│                                                            │
│  agent ── call ──► ┌──────────────────────────────────┐    │
│                    │ ProviderCircuitBreaker (per id)  │    │
│                    │                                  │    │
│                    │  CLOSED ── failures > N ──► OPEN │    │
│                    │    ▲                              │    │
│                    │    │ probe OK                     │    │
│                    │    │                    cooldown  │    │
│                    │  HALF-OPEN ◄── timer ────────────│    │
│                    └──────────┬───────────────────────┘    │
│                               ▼                            │
│  ProviderRegistry (taint) → RateLimiter → streamWithFallback│
│     (ai/registry.ts skip)     (cap/rate)  → provider kế    │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai/src/registry.ts — ProviderRegistry.taint(id, reason)
//    profile bị auth/quota taint → bị skip (eligible=false)
// ✅ packages/ai/src/fallback.ts — streamWithFallback
//    failure → taint + retry provider kế tiếp trong list
// ✅ packages/core/src/supervised.ts — supervisedTask
//    restart với exponential backoff (base*2^n, cap maxBackoffMs)
// ✅ packages/gateway/src/mcp-client.ts — connect cooldown (exponential)
// ✅ packages/gateway/src/channel-identity.ts — RateLimiter(cap, rate)
// ✅ packages/channels/base-adapter.ts — retry với backoff

// ❌ THIẾU: breaker thống nhất cho LLM calls (open/cooldown/half-open probe).
//    Hiện nay: mỗi nơi tự backoff → failure kéo dài vẫn gọi lại tốn cost.
```

## Implementation

```typescript
// packages/ai/src/breaker.ts (NEW)
type BreakerState = "closed" | "open" | "half-open";

class ProviderCircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;

  constructor(
    private providerId: string,
    private readonly threshold = 3,          // fail liên tiếp → open
    private readonly cooldownMs = 30_000,    // open → half-open
  ) {}

  get allowed(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open" && nowMs() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";              // probe 1 request
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.state = "closed"; this.failures = 0;
  }

  onFailure(): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open"; this.openedAt = nowMs();
    }
  }
}

// Wire vào streamWithFallback: trước khi gọi provider → if (!breaker.allowed) skip
// Mọi provider open → degrade message, KHÔNG gọi API tốn cost.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail-fast: không gọi API đang chết (tiết kiệm cost) | ❌ Cooldown ngắn → probe vẫn tốn 1 call |
| ✅ Hết bị "chặn lâu hơn" do spam requests (429) | ❌ Tham số (threshold/cooldown) cần tinh chỉnh |
| ✅ Phối hợp taint + fallback có sẵn | ❌ Breaker sai ngưỡng → giảm availability |
| ✅ Transparent — agents không cần biết | |
| ✅ Đã có backoff + taint + rate limiter | |

## Khác Supervisor (Hướng GG)

| | GG: Supervisor Tree | QQ: Circuit Breaker |
|---|---|---|
| Loại lỗi | Crash (agent/process chết) | External failure (provider 429/5xx/timeout) |
| Cơ chế | Restart + backoff | Open → fail-fast → half-open probe |
| Mục đích | Giữ agent sống | Giữ cost thấp + không spam provider |

## Khi nào chọn

- Nhiều provider, failure pattern khác nhau (429/quota/timeout)
- Muốn fail-fast khi provider đang chết (tiết kiệm cost)
- Đã có taint + fallback + backoff — thêm breaker là mảnh cuối
- Muốn degrade sạch khi TẤT CẢ provider đều open
