# Hướng AIY: Exa MCP Zero-Config — zero-config search dùng Exa MCP (không cần API key) trước khi fallback direct API khi user thêm key

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟢 — resolution thuần trong web search chain | **Agent-agnostic:** ⚠️ (Exa MCP availability) | **Code sẵn:** ⚠️ (có backend chain + config; chưa có MCP-first resolution) | **Effort:** 1 tuần

## Nguồn gốc

**pi-web-access** có **zero-config search**: dùng **Exa MCP (không cần API key)** trước, **fallback sang direct API khi user thêm key**; config path `~/.pi/web-search.json` đọc **lazily có cache**; các provider **bật/tắt theo availability**. Mục tiêu: user cài extension là search chạy được ngay (MCP free tier) — không bắt đi lấy key trước; khi có key thì dùng direct API (chất lượng/giới hạn tốt hơn).

Nguyên tắc: **zero-config là trải nghiệm mặc định** — provider không cần key phải đứng trước trong chain; **nâng cấp khi user cấu hình** — key xuất hiện → provider tốt hơn được ưu tiên; **config đọc lazy có cache** — không đọc file mỗi call, cache theo mtime/version; **availability quyết định chain** — provider không available bị bỏ, không fail.

## Mô tả

Với mya, pattern = **MCP-first trong web search chain**: (1) **backend-resolver.ts (search chain) hiện có**: `tavily > exa > parallel > firecrawl > searxng > brave > ddgs` — ddgs là zero-key floor; (2) AIP thêm **Exa MCP provider đầu chain** — `exaMcpProvider`: `isAvailable()` = MCP server chạy được (không cần key) — dùng `packages/gateway mcp-client.ts` (MCP client đã có) hoặc tự spawn MCP; (3) **fallback order đảo** — không key: Exa MCP → ddgs; có `EXA_API_KEY`: Exa direct API lên đầu; (4) **config lazy + cache** — `packages/tools/src/web/config.ts` có schema env-driven — thêm path config `~/.mya/web-search.json` đọc lazy (cache mtime), provider bật/tắt theo availability; (5) **không fail khi thiếu** — MCP không chạy → next provider (chain pattern có sẵn `UnresolvedBackend`). Nối AIV usage monitor cho MCP calls nếu quota áp.

## Kiến trúc (ASCII)

```
  web_search CALL
    │
    ▼ RESOLVE CHAIN (backend-resolver — có sẵn)
    ├─ CÓ EXA_API_KEY? ──► Exa DIRECT API (lên đầu chain)
    ├─ KHÔNG có key? ──► Exa MCP (zero-config — không cần key)
    │    ├─ MCP available ──► search qua MCP (spawn/connect — gateway mcp-client)
    │    └─ MCP fail ──► next provider
    ├─ next: tavily/parallel/... (theo availability)
    └─ floor: ddgs (zero-key — luôn chạy)
    │
    ▼ config ~/.mya/web-search.json đọc LAZY (cache theo mtime)
    ▼ provider bật/tắt theo availability — không fail vì thiếu key
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools web/search/backend-resolver.ts — chain resolution + isAvailable()
//   (cheap env probe, no network — nền đúng)
// ✅ packages/tools web/search/exa.ts — exaProvider (EXA_API_KEY env probe)
// ✅ packages/tools web/search/index.ts — webSearchTool (resolve → search → ok/err)
// ✅ packages/tools web/config.ts — web.* config schema (env-driven; nền path config)
// ✅ packages/gateway mcp-client.ts — MCP client (nền Exa MCP connect)
// ✅ packages/gateway mcp-lifecycle.ts — MCP lifecycle (nền spawn/health)

// ❌ THIẾU: exaMcpProvider (zero-config) trong chain
// ❌ THIẾU: config path lazy + cache (~/.mya/web-search.json)
// ❌ THIẾU: priority flip theo availability (key → direct API)
```

## Implementation

```typescript
// packages/tools/src/web/search/exa-mcp.ts (NEW)
import type { WebSearchProvider } from "./provider.js";

let cachedConfig: { mtimeMs: number; useMcpFirst: boolean } | null = null;
function webSearchConfig(): { useMcpFirst: boolean } {
  // Đọc lazy + cache theo mtime — không đọc file mỗi call.
  try {
    const { statSync, readFileSync } = awaitImportFs();
    const p = join(homedir(), ".mya", "web-search.json");
    const st = statSync(p);
    if (cachedConfig && cachedConfig.mtimeMs === st.mtimeMs) {
      return { useMcpFirst: cachedConfig.useMcpFirst };
    }
    const raw = JSON.parse(readFileSync(p, "utf8")) as { provider?: string };
    const useMcpFirst = raw.provider !== "direct";   // mặc định MCP-first
    cachedConfig = { mtimeMs: st.mtimeMs, useMcpFirst };
    return { useMcpFirst };
  } catch { return { useMcpFirst: true }; }          // không có config → MCP-first
}
function awaitImportFs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  return fs;
}
/** Exa MCP — zero-config: isAvailable() không cần key, chỉ cần MCP chạy. */
export const exaMcpProvider: WebSearchProvider = {
  name: "exa-mcp",
  kind: "search",
  isAvailable(): boolean {
    // Không cần EXA_API_KEY — MCP server (npx @exa/mcp-server) là đủ.
    return process.env.EXA_MCP_DISABLED === undefined;
  },
  async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
    // Spawn/connect Exa MCP qua gateway mcp-client hoặc spawn trực tiếp.
    const tools = await mcpCall("exa", "search", { query, numResults: opts?.maxResults ?? 10 });
    return normalizeMcpResults(tools);
  },
};
// backend-resolver: chèn exaMcpProvider vào đầu SEARCH_CHAIN khi
// webSearchConfig().useMcpFirst; có EXA_API_KEY → exaProvider (direct) lên trước.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero-config — search chạy ngay không cần key | ❌ Exa MCP là external dependency (spawn server) |
| ✅ Nâng cấp tự nhiên — key xuất hiện → direct API | ❌ MCP latency cao hơn direct API (spawn mỗi lần) |
| ✅ Config lazy + cache — không đọc file mỗi call | ❌ MCP availability không ổn định như env probe |
| ✅ Chain không fail khi thiếu — next provider | ❌ Priority flip phức tạp — cần test chain kỹ |

## Khác các hướng gần

| | AIY Exa MCP Zero-Config | AIV Usage Quota | AIW Readability Pipeline |
|---|---|---|---|
| Trọng tâm | Search không cần key | Bảo vệ quota | Content extract |
| Cơ chế | MCP-first + fallback chain | File monthly + window | Readability + Turndown |
| Quan hệ | Nền search | Nền external calls | Nền content |

## Khi nào chọn

- Muốn search chạy ngay khi cài đặt — không bắt user đi lấy API key
- Đã có backend chain + isAvailable() — thêm MCP provider đầu chain
- Config path muốn đọc lazy có cache (không I/O mỗi call)
- Guard: MCP fail → next provider (không fail cứng); key xuất hiện → direct API ưu tiên