# Hướng BR: LLM Gateway — 1 endpoint cho mọi LLM provider

> **Nguồn gốc:** LiteLLM / OpenRouter / Portkey (2024-2026); TrueFoundry 2026 "AI Gateway"
> **Coupling:** 🟢 — app chỉ biết 1 API, gateway lo đa provider
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (phần lớn — registry + fallback + tier + key-rotation sẵn, thiếu unified API)
> **Effort:** 1 tuần

## Nguồn gốc

LLM Gateway (LiteLLM, OpenRouter, Portkey — nền công nghiệp 2024-2026): một **endpoint duy nhất** cho mọi LLM call — app gửi `chat.completion` chuẩn → gateway lo: **routing** (provider/model nào), **fallback** (provider hỏng → provider khác), **cost tracking**, **cache** (cùng request không gọi lại), **rate-limit**, **key management** (mỗi provider 1 key, không lộ cho app). TrueFoundry 2026 mở rộng thành nơi đặt **security** (prompt injection defense tại gateway). Với mya: các khối `packages/ai` (registry, fallback, model-routing, key-rotation, rate-limiter) đã có **từng mảnh** — LLM Gateway là hướng **chuẩn hoá thành 1 lớp duy nhất** thay vì logic rải rác trong agent loop.

## Mô tả

mya gọi LLM (prompt build → call) qua **1 hàm duy nhất** `gateway.complete()` thay vì nhiều điểm gọi rải rác: gateway nhận request chuẩn (model tier hoặc tên) → resolve provider (RR tier) → kiểm tra budget/rate (SS) → cache hit? (NN) → gọi provider → fail → fallback (registry taint) → đo cost/token (JJJ span) → trả về. Điểm thêm giá trị so với hiện tại: **cost tracking trung tâm** (mọi call qua 1 chỗ → SS có số liệu thật), **cache tập trung** (NN không phải chèn từng nơi), **bảo mật 1 điểm** (đặt RRR firewall tại gateway). Khác MMM MCP Gateway (tool protocol) — LLM Gateway là **tầng model**, không phải tool.

## Kiến trúc

```
  agent loop ──► GATEWAY.complete(req)          ← 1 API duy nhất
                    │
                    ├─ resolve: tier → provider/model (model-routing RR)
                    ├─ gate: budget (SS) · rate (rate-limiter) · cache (NN)
                    ├─ call provider → fail? → fallback (registry taint)
                    ├─ measure: cost · tokens · latency (JJJ span)
                    └─ security: input/output scan (RRR firewall, tuỳ chọn)
                    ▼
                 response chuẩn (mọi provider cùng format)
```

```
mya: packages/ai = registry + fallback + model-routing + key-rotation + oauth SẴN
     thiếu: 1 hàm gateway duy nhất + cost store + cache tập trung
```

## mya ĐÃ CÓ (phần lớn)

```typescript
// ✅ packages/ai/src/registry.ts — ProviderRegistry (multi-provider)
// ✅ packages/ai/src/fallback.ts — FallbackResult (failover)
// ✅ packages/ai/src/model-routing.ts — ModelTier + resolveModelForPhase
// ✅ packages/ai/src/key-rotation.ts + oauth.ts — key management
// ✅ packages/gateway/src/rate-limiter.ts — rate gate (SS)

// ❌ THIẾU: 1 hàm complete() duy nhất — hiện logic gọi rải trong agent loop
// ❌ THIẾU: cost store trung tâm (số liệu thật cho SS budget)
// ❌ THIẾU: cache tập trung (NN) + security hook (RRR) trong luồng gọi
```

## Implementation

```typescript
// packages/ai/src/gateway.ts (NEW) — mọi LLM call đi qua đây
interface GatewayRequest {
  phase?: string;                       // RR: resolve tier theo phase
  model?: string;                       // override
  messages: Message[];                  // chuẩn hoá
  budget?: number;                      // SS
}

async function complete(req: GatewayRequest): Promise<GatewayResult> {
  const tierModel = resolveModelForPhase(req.phase, tierConfig);   // model-routing
  const hit = await cacheGet(hash(req));                           // NN tập trung
  if (hit) return { ...hit, cached: true };

  const span = traceStart("llm", tierModel);                       // JJJ
  await budgetCheck(req.budget);                                   // SS
  const result = await callWithFallback(tierModel, req.messages);  // registry+fallback
  await costStore.record(result);                                  // ← cost trung tâm
  return { ...result, cached: false, spanId: span.id };
}

// không còn gọi provider trực tiếp ngoài gateway — 1 điểm duy nhất
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cost/token đo đủ 100% call (SS số liệu thật) | ❌ Đổi luồng gọi hiện có (refactor agent loop) |
| ✅ Cache (NN) + security (RRR) gắn 1 chỗ | ❌ 1 điểm thất bại — gateway chết → agent chết (GG bù) |
| ✅ Provider thêm/bớt không đụng agent loop | ❌ Overhead routing mỗi call (nhỏ) |
| ✅ Chuẩn hoá: thêm provider mới = thêm adapter | ❌ Fallback ẩn → tưởng provider A ok mà là B |
| ✅ Đã có gần hết khối — chỉ cần ráp | |

## Khác các hướng gần

| | MMM MCP Gateway | E LLM Proxy | SSS: LLM Gateway |
|---|---|---|---|
| Gateway cho | MCP tool servers | MITM user↔agent | **LLM providers** |
| Điều khiển | Tool routing | Quan sát/tiêm | Model + cost + cache + failover |
| Hướng | Tool → 1 surface | Ngoài agent | Trong agent (mọi call) |
| Mối quan hệ | Bổ trợ (tầng tool) | Đối lập (ngoài) | **Hạ tầng model** |

## Khi nào chọn

- Muốn SS budget có số liệu cost thật (mọi call đo được)
- Muốn NN cache + RRR firewall gắn đúng 1 chỗ
- Thêm provider thường xuyên mà không muốn đụng agent loop
- Đã có registry+fallback+tier — bước ráp là nhỏ