# Hướng SQ: Provider Ranking Attribution — gắn HTTP-Referer / X-OpenRouter-Title khi gọi aggregator

> **Nguồn gốc:** pi-coding-agent `provider-attribution.ts` (`HTTP-Referer`, `X-OpenRouter-Title`, `X-OpenRouter-Categories`, `X-BILLING-INVOKE-ORIGIN`, `x-opencode-session`); OpenRouter ranking/attribution docs; "CLI agent attribution headers"; "telemetry-gated attribution"; "host-aware header per aggregator" | **Coupling:** 🟢 — thêm attribution-header layer vào transport (chỉ thêm header khi gọi aggregator) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (transport + headers sẵn — chưa có host-detect + per-aggregator attribution) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-coding-agent** gắn **attribution headers** khi gọi **model aggregator** (OpenRouter, NVIDIA NIM, Cloudflare, OpenCode) — để aggregator **đếm + xếp hạng** app nguồn (leaderboard OpenRouter), và các nhà cung cấp **billing/telemetry phân biệt nguồn**. Header cụ thể theo host: OpenRouter → `HTTP-Referer: https://pi.dev` + `X-OpenRouter-Title: pi` + `X-OpenRouter-Categories: cli-agent`; NVIDIA NIM → `X-BILLING-INVOKE-ORIGIN: Pi`; Cloudflare → `User-Agent: pi-coding-agent`; OpenCode → `x-opencode-session` + `x-opencode-client`. Nguyên tắc: **header theo host** — detect base-url → gắn đúng bộ header; **telemetry-gated** (chỉ gắn khi user bật install-telemetry, tôn trọng privacy). Khác **05 llm-proxy** (routing) — SQ là **identity attribution**; khác User-Agent thuần — SQ **per-aggregator semantic**.

## Mô tả

mya provider ranking attribution: (1) **Host detect**: từ model base-url/provider → nhận diện aggregator (OpenRouter, NIM, Cloudflare…). (2) **Header map**: mỗi aggregator có bộ attribution header riêng (HTTP-Referer/Title cho OpenRouter, billing-origin cho NIM…). (3) **Merge**: gộp attribution header vào request headers (không ghi đè header do user/provider set). (4) **Telemetry gate**: chỉ gắn khi user consent (install-telemetry on). mya có `packages/agent` transport + header merging — SQ thêm **host detector** + **per-aggregator header registry** + **telemetry gate**.

## Kiến trúc

```
  REQUEST tới model (base-url detect host):
  POST https://openrouter.ai/api/v1/chat/completions
        │
        ▼
  ┌─── HOST DETECT ──────────────────────────────────────┐
  │  openrouter.ai  → OPENROUTER headers                  │
  │  nvidia NIM     → NVIDIA headers                      │
  │  cloudflare     → CF headers                          │
  │  opencode.ai    → OPENCODE session headers            │
  └───────────────────────┬─────────────────────────────┘
                          │ (per-aggregator header set)
                          ▼
  ┌─── ATTRIBUTION HEADER MAP (telemetry-gated) ─────────┐
  │  HTTP-Referer: https://mya.dev                         │
  │  X-OpenRouter-Title: mya                              │
  │  X-OpenRouter-Categories: cli-agent                   │
  └───────────────────────┬─────────────────────────────┘
                          │ (merge — user headers win)
                          ▼
  ┌─── REQUEST (aggregator đếm + xếp hạng mya) ──────────┐
  │  aggregator thấy nguồn = mya → ranking attribution    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent transport — request headers (nền — SQ merge vào đây)
// ✅ model.provider / model.baseUrl — host info (nền — SQ detect)
// ✅ settings — telemetry consent (nền — SQ gate)

// ❌ THIẾU: host detector (base-url → aggregator id)
// ❌ THIẾU: per-aggregator header registry (OpenRouter/NIM/CF/OpenCode)
// ❌ THIẾU: telemetry gate (only when install-telemetry enabled)
// ❌ THIẾU: merge precedence (user > provider > attribution)
```

## Implementation

```typescript
// packages/agent/src/provider-attribution.ts (MỚI)
import type { Model } from '@my-agent/ai';

const HOST_MAP: Array<{ host: string; id: string }> = [
  { host: 'openrouter.ai', id: 'openrouter' },
  { host: 'integrate.api.nvidia.com', id: 'nvidia-nim' },
  { host: 'api.cloudflare.com', id: 'cloudflare' },
  { host: 'opencode.ai', id: 'opencode' },
];

function detectAggregator(model: Pick<Model, 'provider' | 'baseUrl'>): string | null {
  if (model.provider === 'openrouter') return 'openrouter';
  for (const { host, id } of HOST_MAP) {
    try { if (new URL(model.baseUrl).hostname === host) return id; } catch { /* ignore */ }
  }
  return null;
}

const ATTR_HEADERS: Record<string, () => Record<string, string>> = {
  openrouter: () => ({
    'HTTP-Referer': 'https://mya.dev',
    'X-OpenRouter-Title': 'mya',
    'X-OpenRouter-Categories': 'cli-agent',
  }),
  'nvidia-nim': () => ({ 'X-BILLING-INVOKE-ORIGIN': 'mya' }),
  cloudflare: () => ({ 'User-Agent': 'mya-agent' }),
  opencode: () => ({ 'x-opencode-client': 'mya' }),
};

export function attributionHeaders(
  model: Pick<Model, 'provider' | 'baseUrl'>,
  telemetryEnabled: boolean,
  sessionId?: string,
): Record<string, string> | undefined {
  if (!telemetryEnabled) return undefined; // privacy gate
  const id = detectAggregator(model);
  if (!id) return undefined;
  const headers = { ...ATTR_HEADERS[id]() };
  if (id === 'opencode' && sessionId) headers['x-opencode-session'] = sessionId;
  return Object.keys(headers).length ? headers : undefined;
}

// Usage:
// const attr = attributionHeaders(model, settings.telemetry, session.id);
// request.headers = { ...attr, ...providerHeaders, ...userHeaders }; // user wins
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Aggregator xếp hạng mya (leaderboard visibility) | ❌ Privacy (cần consent — lộ nguồn app) |
| ✅ Billing phân biệt nguồn (NIM/CF đếm đúng) | ❌ Header drift (aggregator đổi spec) |
| ✅ Per-host semantic (đúng header từng aggregator) | ❌ Host-detect sai (proxy/mirror → miss) |
| ✅ Telemetry gate (tôn trọng user off) | ❌ Merge precedence phức tạp |

## Khác các hướng gần

| | 05 LLM-Proxy | User-Agent thuần | SQ: Provider-Attribution |
|---|---|---|---|
| Cái gì | Route model | 1 header chung | **Per-aggregator semantic header set** |
| Mục đích | Chọn backend | Identify client | **Ranking + billing attribution** |
| Gate | ❌ | ❌ | **✅ telemetry consent** |

## Khi nào chọn

- mya gọi aggregator (OpenRouter/NIM/CF) — muốn được xếp hạng/đếm
- Cần billing phân biệt nguồn (NIM/CF)
- Muốn consent-gated (tôn trọng privacy off)
- Nối packages/agent transport + settings (telemetry); guard privacy (telemetry gate, default off), merge precedence (user/provider header không bị ghi đè), và host-detect (proxy/mirror vẫn nhận diện được); SQ = identity attribution cho aggregator, không thay routing
