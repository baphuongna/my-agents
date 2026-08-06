# Hướng RX: Auth-Tiered Compression Policy — nén phân hạng theo xác thực: Subscription nhẹ, PAYG/OAuth mạnh

> **Nguồn gốc:** headroom (chopratejas; `auth_mode.rs`; AuthMode enum Payg/OAuth/Subscription; "PAYG: aggressive live-zone compression OK"; "OAuth: passthrough-prefer, lossless-only"; "Subscription: stealth, preserve User-Agent, never inject headers"; classify from headers)
> **Coupling:** 🟡 — thêm auth-classifier + tiered compression policy vào provider wrapper (can thiệp quyết định nén)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (359 MU content-type + 361 MW cache-prefix sẵn — chưa có auth-mode classifier + tiered policy)
> **Effort:** 2-3 tuần

## Nguồn gốc

**headroom** phân loại request theo **auth mode** (3 hạng) từ headers, rồi **chính sách nén theo hạng**. **3 AuthMode**: (1) **PAYG** (pay-as-you-go API key — Anthropic/OpenAI/Gemini key): caller **trả per-token** → **nén aggressive** (live-zone, cả lossy) **tiết kiệm tiền** — bật hết. (2) **OAuth** (bearer/IAM/ADC — Claude Pro OAuth, Codex Enterprise, Cursor Pro, Bedrock, Vertex): caller **subscription giá cố định**, per-token cost opaque → **cache-safety tối quan trọng** (OAuth scope pin `(account, model, session)`, beta-header drift void cache) → **passthrough-prefer, lossless-only** (không auto-cache_control, không lossy). (3) **Subscription** (CLI/IDE UX-bound — Claude Code, ChatGPT Plus, Cursor, Copilot, Antigravity): provider **rate-limit theo request count** + **programmatic-fingerprint detection** → **stealth**: giống OAuth + **giữ User-Agent, không inject X-Headroom, không strip accept-encoding** (phải giống upstream agent, không bị phát hiện). **Classifier pure** (<10μs, từ User-Agent + auth header), **không bao giờ panic** (malformed → default PAYG + warn). Khác **359 MU content-type** (compressor theo loại nội dung) — RX **policy theo xác thực**; khác **361 MW cache-prefix** — RX **tier nén theo auth**.

## Mô tả

mya auth-tiered compression policy: (1) **Classify**: từ headers (User-Agent + Authorization/x-api-key) → AuthMode (PAYG/OAuth/Subscription). (2) **PAYG policy**: aggressive — live-zone compression (lossy OK), auto-cache_control placement, prompt_cache_key injection. (3) **OAuth policy**: lossless-only — KHÔNG auto-cache_control, KHÔNG prompt_cache_key, KHÔNG lossy; passthrough-prefer. (4) **Subscription policy**: stealth = OAuth + preserve User-Agent, KHÔNG inject X-Headroom headers, KHÔNG strip accept-encoding (giống upstream agent). (5) **Safe default**: malformed → PAYG + warn (không crash). (6) **Telemetry**: auth_mode label (3 giá trị) trên metrics. mya có 359 MU + 361 MW — RX thêm **auth-classifier** + **tiered policy gate** trước compression.

## Kiến trúc

```
  INBOUND REQUEST (headers)
  ┌──────────────────────────────────────────────────┐
  │  Authorization: Bearer xxx  /  x-api-key: sk-...  │
  │  User-Agent: claude-code/1.0 / cursor/0.42 ...    │
  └──────────────────────────┬───────────────────────┘
                             ▼
  ┌─── AUTH CLASSIFIER (pure, <10μs, never panic) ──────────┐
  │  UA prefix match (claude-code/, cursor/, copilot/...) → SUBSCRIPTION │
  │  else if Bearer/OAuth/IAM → OAUTH                         │
  │  else (sk-/x-goog-api-key/x-api-key) → PAYG              │
  │  malformed → default PAYG + warn (không crash)           │
  └──────────────────────────┬──────────────────────────────┘
                             ▼
  ┌─── TIERED COMPRESSION POLICY ───────────────────────────┐
  │                                                          │
  │  PAYG (per-token):          → AGGRESSIVE                 │
  │    ✅ live-zone compression (lossy OK)                   │
  │    ✅ auto cache_control placement                       │
  │    ✅ prompt_cache_key injection                         │
  │                                                          │
  │  OAuth (subscription giá cố định): → LOSSLESS-ONLY       │
  │    ✅ lossless compressors only                          │
  │    ❌ không auto-cache_control (scope pin, drift void)   │
  │    ❌ không prompt_cache_key                             │
  │                                                          │
  │  Subscription (CLI/IDE UX-bound): → STEALTH              │
  │    = OAuth (lossless-only)                               │
  │    + ✅ preserve User-Agent (giống upstream agent)       │
  │    + ❌ không inject X-Headroom headers                  │
  │    + ❌ không strip accept-encoding                      │
  │    (tránh programmatic-fingerprint detection)            │
  └──────────────────────────┬──────────────────────────────┘
                             ▼
  FORWARDED REQUEST (nén đúng mức theo auth tier)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 359 MU content-type-aware-compression — compressor theo nội dung (nền — RX = policy theo auth)
// ✅ 361 MW cache-prefix-preserving — cache-aware (nền — RX = tier khi nào bật)
// ✅ provider wrapper (compatible/reliable) — chèn policy (nền — RX = auth gate)
// ✅ 491 RW cache-invalid-aware — drift (gần — RX = auth quyết định cache_control)

// ❌ THIẾU: auth-mode classifier (3 hạng từ headers, pure, never-panic)
// ❌ THIẾU: tiered policy (PAYG aggressive / OAuth lossless / Subscription stealth)
// ❌ THIẾU: stealth invariants (preserve UA, no inject headers, no strip encoding)
// ❌ THIẾU: auth_mode metric label (3 giá trị)
```

## Implementation

```typescript
// packages/agent/src/auth-tiered-compression.ts (MỚI)
type AuthMode = "payg" | "oauth" | "subscription";

const SUBSCRIPTION_UA = ["claude-code/", "cursor/", "github-copilot/", "codex-cli/", "antigravity/"];

// classify auth mode từ headers (pure, <10μs, never panic → default payg)
function classifyAuth(headers: Record<string, string>): AuthMode {
  const ua = (headers["user-agent"] ?? "").toLowerCase();
  if (SUBSCRIPTION_UA.some(p => ua.includes(p))) return "subscription";
  const auth = headers["authorization"] ?? "";
  if (auth.startsWith("Bearer ")) return "oauth";                  // OAuth bearer / IAM / ADC
  const apiKey = headers["x-api-key"] ?? headers["x-goog-api-key"] ?? "";
  if (apiKey.startsWith("sk-") || apiKey) return "payg";           // API key = pay-as-you-go
  return "payg";                                                    // safe default
}

interface CompressPolicy { liveZone: boolean; lossy: boolean; autoCacheControl: boolean; stealth: boolean; }

// tiered policy theo auth mode
function policyFor(mode: AuthMode): CompressPolicy {
  switch (mode) {
    case "payg":         return { liveZone: true,  lossy: true,  autoCacheControl: true,  stealth: false }; // aggressive
    case "oauth":        return { liveZone: true,  lossy: false, autoCacheControl: false, stealth: false }; // lossless-only
    case "subscription": return { liveZone: true,  lossy: false, autoCacheControl: false, stealth: true };  // stealth
  }
}

class AuthTieredCompressor {
  apply(headers: Record<string, string>, blocks: Block[]): { blocks: Block[]; mode: AuthMode; policy: CompressPolicy } {
    const mode = classifyAuth(headers);
    const policy = policyFor(mode);

    let out = blocks;
    if (policy.liveZone) out = compressLiveZone(out, policy.lossy);      // live-zone (lossy nếu PAYG)
    if (policy.autoCacheControl) out = placeCacheControl(out);            // chỉ PAYG auto-place
    // stealth: KHÔNG inject headers, preserve UA — caller xử lý (đây chỉ compression)
    return { blocks: out, mode, policy };
  }
}

// stealth guard (ở provider wrapper — KHÔNG inject, preserve UA)
function stealthForwarding(mode: AuthMode, headers: Record<string, string>): Record<string, string> {
  if (mode !== "subscription") return headers;
  const h = { ...headers };
  delete h["x-headroom-session-id"];                          // không inject custom header
  // KHÔNG strip accept-encoding, KHÔNG mutate User-Agent
  return h;
}

// Usage:
// const mode = classifyAuth(req.headers);                  // payg | oauth | subscription
// const { blocks, policy } = comp.apply(req.headers, blocks);
// const out = stealthForwarding(mode, req.headers);        // subscription → no inject
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ PAYG tiết kiệm tiền (aggressive nén lossy) | ❌ Phải classify auth chính xác (miss → sai tier) |
| ✅ OAuth cache-safety (lossless, không void scope) | ❌ Subscription stealth hạn chế (không inject/strip) |
| ✅ Subscription không bị fingerprint detect | ❌ 3 policy path = phức tạp hơn 1 compressor |
| ✅ Safe default (malformed → PAYG + warn, không crash) | ❌ UA prefix list phải maintain (client mới → thêm) |

## Khác các hướng gần

| | 359 Content-Type-Aware | 361 Cache-Prefix-Preserving | RX: Auth-Tiered |
|---|---|---|---|
| Cái gì | Compressor theo nội dung | Freeze prefix khi nén | **Policy theo xác thực (auth)** |
| Phân hạng | Content type | Cache boundary | **Auth mode (3 hạng)** |
| Lossy | Theo type | ❌ (freeze prefix) | **PAYG ✅ / OAuth+Sub ❌** |

## Khi nào chọn

- Hỗ trợ nhiều auth (PAYG API key + OAuth subscription + Subscription CLI/IDE)
- Muốn nén aggressive cho PAYG (tiết kiệm tiền) nhưng an toàn cho OAuth/Subscription (cache-safety + stealth)
- Cần tránh programmatic-fingerprint detection (Subscription phải giống upstream agent)
- Nối 359 MU (RX = policy chọn khi nào bật lossy) + 361 MW (RX = tier cache_control theo auth) + provider wrapper (RX = auth gate) + 491 RW (RX = auth quyết định drift/cache); guard classifier chính xác (UA + auth header, safe default payg) + stealth invariants (Subscription: preserve UA, no inject X-Headroom, no strip accept-encoding) + cache-safety OAuth (không auto-cache_control — scope pin, drift void cache) + UA list maintenance (client mới → thêm prefix)
