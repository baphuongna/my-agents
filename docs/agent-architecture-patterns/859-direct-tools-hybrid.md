# Hướng AGA: Direct-Tools Hybrid — hybrid tool surface: `directTools:true`/`string[]` promote 5-20 tool hot thành Pi tool first-class (~150-300 tokens/tool), phần còn lại đi qua proxy; `includeTools`/`excludeTools` glob lọc theo tên gốc lẫn tên prefix

> **Nguồn gốc:** pi-mcp-adapter (README.md) | **Coupling:** 🟢 — config tool surface | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có registry + tool-search, thiếu direct/promote hybrid) | **Effort:** 1 tuần

## Nguồn gốc

**pi-mcp-adapter** hybrid tool surface cân bằng **prompt cost vs discovery**: `directTools:true` (hoặc `string[]` chỉ định) **promote 5-20 tool hot thành first-class** — hiện đầy đủ trong prompt (~150-300 tokens/tool), agent gọi trực tiếp không cần search. Phần còn lại đi qua **proxy** (AFY). `includeTools`/`excludeTools` glob lọc theo **tên gốc lẫn tên prefix** (ví dụ `github_*`). Nguyên tắc: **tool nóng first-class, tool lạnh qua proxy, glob lọc linh hoạt**.

## Mô tả

mya direct-tools-hybrid: (1) **registry đã sẵn** — `packages/tools` registry.ts (named tools, declareAlias); (2) **tool-search đã sẵn** — tool-search.ts (lazy activation); (3) **promote hot tools** — directTools config chọn 5-20 tool → first-class (full schema trong prompt); (4) **proxy rest** — phần còn lại qua AFY mcp-proxy; (5) **glob filter** — includeTools/excludeTools theo tên/prefix. Nối AFY (proxy) và registry.

## Kiến trúc (ASCII)

```
  MCP SERVER (trăm tool)
       │
       ▼  HYBRID SURFACE
  ┌─────────────────────────────────────┐
  │ directTools: ["github_create_*",...]│  ◀── 5-20 HOT tool
  │  → PROMOTE first-class               │     full schema (~150-300 tok/tool)
  │  → agent gọi TRỰC TIẾP               │     trong prompt
  ├─────────────────────────────────────┤
  │ phần còn lại                         │  ◀── tool lạnh
  │  → qua PROXY (AFY mcp-proxy)         │     on-demand search/describe/call
  ├─────────────────────────────────────┤
  │ includeTools/excludeTools (glob)     │  ◀── lọc tên gốc + prefix
  └─────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools registry.ts — ToolRegistry (named, declareAlias, resolve)
// ✅ packages/tools tool-search.ts — BM25 search + lazy activation
// ✅ packages/tools auto-discover.ts — tool discovery

// ❌ THIẾU: directTools promote config (hot → first-class)
// ❌ THIẾU: includeTools/excludeTools glob filter (tên + prefix)
// ❌ THIẾU: hybrid surface (promote + proxy rest)
```

## Implementation

```typescript
// packages/tools/src/direct-tools-hybrid.ts (MỚI)
// glob match helper (concept — use a glob lib in practice)
export interface HybridConfig {
  directTools: true | string[];       // promote hot tool first-class
  includeTools?: string[];            // glob whitelist
  excludeTools?: string[];            // glob blacklist
}
/** Lọc tool theo glob (tên gốc + prefix). */
export function filterTools(names: string[], cfg: HybridConfig): string[] {
  let out = names;
  if (cfg.includeTools) out = out.filter((n) => cfg.includeTools!.some((g) => matchGlob(n, g)));
  if (cfg.excludeTools) out = out.filter((n) => !cfg.excludeTools!.some((g) => matchGlob(n, g)));
  return out;
}
function matchGlob(name: string, pattern: string): boolean {
  return name === pattern || name.startsWith(pattern.replace(/\*$/, ""));   // tên gốc + prefix
}
/** Quyết định promote (first-class) vs proxy. */
export function classify(names: string[], cfg: HybridConfig): { direct: string[]; proxied: string[] } {
  const filtered = filterTools(names, cfg);
  const direct = cfg.directTools === true ? filtered.slice(0, 20)   // top 20 hot
    : filtered.filter((n) => (cfg.directTools as string[]).some((g) => matchGlob(n, g)));
  const proxied = filtered.filter((n) => !direct.includes(n));
  return { direct, proxied };   // direct → first-class; proxied → AFY proxy
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tool nóng first-class (gọi trực tiếp, nhanh) | ❌ 150-300 tok/tool → 20 tool vẫn tốn 3-6k token |
| ✅ Tool lạnh qua proxy (tiết kiệm) | ❌ Cấu hình directTools cần tuning (tool nào hot?) |
| ✅ Glob lọc linh hoạt (tên + prefix) | ❌ Phân tách direct/proxied có thể confuse agent |

## Khác các hướng gần

| | AGA Direct-Tools Hybrid | AFY MCP Proxy-Tool | registry declareAlias |
|---|---|---|---|
| Surface | Hybrid (promote + proxy) | Toàn proxy | Rename |
| Token | 150-300/tool (hot) | ~200 (all proxy) | n/a |
| Mục đích | Cân bằng hot vs lazy | Nén tối đa | Alias |

## Khi nào chọn

- Có tool nóng dùng thường (gọi trực tiếp nhanh hơn proxy)
- Muốn cân bằng prompt cost vs discovery
- Cần lọc tool theo glob (whitelist/blacklist)
- Guard: directTools cap (~20), glob match tên+prefix, fallback proxy khi direct miss
