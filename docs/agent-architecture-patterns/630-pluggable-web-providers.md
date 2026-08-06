# Hướng XF: Pluggable Web Providers — web_search/web_fetch với 10 provider pluggable, per-call provider override, SSRF guard host-literal

> **Nguồn gốc:** rpiv-mono (web provider registry); "web_search/web_fetch 10 providers", "per-call provider override", "SSRF guard host-literal" | **Coupling:** 🟡 — thêm provider registry + SSRF guard vào web tools | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tool registry + dispatch sẵn — chưa có web provider pluggable + SSRF host-literal) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** expose `web_search`/`web_fetch` không hard-code 1 backend mà qua **registry 10 provider** pluggable (Google, Bing, Brave, DuckDuckGo, Tavily, Searx, ...). Mỗi call cho **per-call provider override** (model chọn provider cụ thể cho query đó — vd academic query → scholarly provider). Bảo mật: **SSRF guard host-literal** — chỉ cho fetch host **literal** (domain/IP trong allowlist hoặc non-private), chặn `http://169.254.169.254` (metadata cloud), `http://localhost`, `http://10.x` (internal) → chống **server-side request forgery**. Nguyên tắc: **provider interchangeable + SSRF-safe** — không leak internal qua web_fetch.

## Mô tả

mya pluggable web providers: registry `web_search`/`web_fetch` với nhiều provider; per-call override chọn provider; SSRF guard kiểm host (chặn private/loopback/metadata) trước fetch. mya có tool registry + dispatch — XF thêm **provider registry** + **per-call override** + **SSRF host-literal guard**.

## Kiến trúc

```
  ┌─── PROVIDER REGISTRY (10 provider) ──────────────────┐
  │  search:  { google, bing, brave, ddg, tavily, ... }    │
  │  fetch:   { http, readability, proxy, scholar, ... }   │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── tool call (web_fetch, per-call override) ─────────┐
  │  args = { url, provider?: "scholar" }  ← override      │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── SSRF GUARD (host-literal) ─────────────────────────┐
  │  parse url.host:                                        │
  │  - localhost/127.0.0.1 → DENY (loopback)                │
  │  - 10.x/172.16.x/192.168.x → DENY (private)             │
  │  - 169.254.169.254 → DENY (cloud metadata)              │  ← chặn SSRF
  │  - public literal → ALLOW                              │
  └───────────────────────┬───────────────────────────────┘
                          │ (allow)
                          ▼
  ┌─── PROVIDER DISPATCH (override or default) ──────────┐
  │  provider = args.provider ?? default → fetch via đó    │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools dispatch.ts — tool dispatch (nền — XF provider ở đây)
// ✅ packages/tools auto-discover.ts — registry (nền — XF provider registry)
// ✅ packages/core threat-scan.ts — threat scan (nền — XF SSRF guard analog)

// ❌ THIẾU: web provider registry (search/fetch pluggable)
// ❌ THIẾU: per-call provider override
// ❌ THIẾU: SSRF host-literal guard (chặn private/metadata)
```

## Implementation

```typescript
// packages/tools/src/web-providers.ts (MỚI)
import { lookup } from "node:dns/promises";

interface WebProvider { name: string; fetch: (url: string) => Promise<string> }

// SSRF guard: chỉ cho host public literal
async function ssrfGuard(url: string): Promise<void> {
  const host = new URL(url).hostname;
  // chặn literal private/metadata
  const blocked = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i;
  if (blocked.test(host)) throw new Error(`SSRF blocked: ${host}`);
  // resolve DNS → chặn nếu trỏ private (rebind)
  try {
    const res = await lookup(host);
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(res.address))
      throw new Error(`SSRF blocked (dns rebind): ${res.address}`);
  } catch (e) { if (String(e).includes("SSRF")) throw e; /* allow unresolved literal */ }
}

class WebProviderRegistry {
  private providers = new Map<string, WebProvider>();
  private default: string;
  register(p: WebProvider): void { this.providers.set(p.name, p); }
  setDefault(name: string): void { this.default = name; }

  async fetch(url: string, override?: string): Promise<string> {
    await ssrfGuard(url); // SSRF guard trước fetch
    const name = override ?? this.default;
    const p = this.providers.get(name);
    if (!p) throw new Error(`unknown provider: ${name}`);
    return p.fetch(url); // per-call override
  }
}

// Usage:
// reg.register(httpProvider); reg.register(scholarProvider); reg.setDefault("http");
// await reg.fetch("https://example.com", "scholar"); // override scholar + SSRF-safe
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Provider interchangeable (10 backend, đổi linh hoạt) | ❌ Provider contract heterogeneity (kết quả khác nhau) |
| ✅ Per-call override (academic → scholarly provider) | ❌ Config sprawl (mỗi provider cần key) |
| ✅ SSRF-safe (chặn private/metadata/loopback) | ❌ DNS rebind race (resolve đổi sau guard) |
| ✅ Pluggable (thêm provider không sửa tool) | ❌ Rate-limit per-provider (mỗi backend limit khác) |

## Khác các hướng gần

| | Hard-coded fetch | Allow-all fetch | XF: Pluggable-SSRF |
|---|---|---|---|
| Provider | 1 | 1 | **✅ 10 pluggable** |
| Override | ❌ | ❌ | **✅ per-call** |
| SSRF | ❌ | ❌ | **✅ host-literal guard** |

## Khi nào chọn

- web_search/web_fetch cần nhiều backend (academic vs general) + per-call chọn
- Cần SSRF protection (chặn fetch internal/metadata từ model-controlled URL)
- Nối packages/tools dispatch.ts + auto-discover.ts + packages/core threat-scan.ts; guard dns-rebind-tight (re-check address sau resolve, TOCTOU), allowlist-strict (deny mặc định, allow explicit), và provider-fallback (provider lỗi → fallback default, không crash); XF = pluggable web providers, kết hợp 629 XE skill-shell-placeholders (!cmd! fetch qua provider) + packages/core threat-scan.ts (SSRF detection)
