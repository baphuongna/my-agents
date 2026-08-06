# Hướng AFY: MCP Proxy-Tool — thay vì nạp hàng trăm tool definition (10k+ tokens/server), expose một mcp proxy tool ~200 tokens; agent search/describe/call tool on-demand qua `mcp({search:...})` / `mcp({tool:...})`

> **Nguồn gốc:** pi-mcp-adapter (README.md, proxy-modes.ts) | **Coupling:** 🟢 — wrapper quanh MCP server, không đổi agent loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có tool-search BM25 + registry, thiếu mcp proxy single-tool) | **Effort:** 1 tuần

## Nguồn gốc

**pi-mcp-adapter** giải bài toán **token bloat**: MCP server có thể có **hàng trăm tool**, mỗi tool definition tốn token → **10k+ tokens/server** phình prompt. Giải pháp: expose **một mcp proxy tool ~200 tokens** thay vì toàn bộ. Agent **search/describe/call on-demand**: `mcp({ search: "..." })` tìm tool, `mcp({ describe: "tool_name" })` xem schema, `mcp({ tool: "tool_name", args: {...} })` gọi. Tool definition chỉ load khi cần. Nguyên tắc: **một proxy thay trăm tool, lazy discovery**.

## Mô tả

mya mcp-proxy-tool: (1) **tool-search đã sẵn** — `packages/tools` tool-search.ts (BM25 search ranked, lazy activation); (2) **registry đã sẵn** — `packages/tools` registry.ts (named, schema-described tools); (3) **mcp proxy tool** — single tool `mcp` nhận discriminated union (search/describe/tool); (4) **lazy discovery** — tool def load khi describe/call; (5) **token saving** — ~200 tokens proxy vs 10k+ full. Nối AGA (direct-tools hybrid — hot tool first-class).

## Kiến trúc (ASCII)

```
  MCP SERVER (hàng trăm tool, 10k+ tokens nếu nạp hết)
       │
       ▼  expose MỘT proxy tool (~200 tokens)
  mcp({ ... })  ◀── discriminated union:
       │
       ├─ { search: "email" }    ──▶ list tool match (ranked)
       ├─ { describe: "send_email" } ──▶ schema của 1 tool (lazy load)
       └─ { tool: "send_email", args: {...} } ──▶ gọi tool

  agent DISCOVERY on-demand — không nạp hết vào prompt
  tiết kiệm 10k+ tokens → context cho việc chính
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools tool-search.ts — BM25 search(query) ranked (lazy activation)
// ✅ packages/tools registry.ts — ToolRegistry (named, schema-described)
// ✅ packages/tools tool-search.ts — search/describe foundation

// ❌ THIẾU: mcp proxy tool (single tool, discriminated union)
// ❌ THIẾU: lazy describe/call → MCP server
```

## Implementation

```typescript
// packages/tools/src/mcp-proxy.ts (MỚI)
import { searchTools } from "./tool-search.js";
export type McpProxyCall =
  | { search: string }
  | { describe: string }
  | { tool: string; args: Record<string, unknown> };
export interface McpServer {
  listTools(): { name: string; description: string }[];
  describe(name: string): { schema: unknown };
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}
/** Proxy tool — một tool thay trăm; agent search/describe/call on-demand. */
export async function mcpProxy(server: McpServer, call: McpProxyCall): Promise<unknown> {
  if ("search" in call) {
    const all = server.listTools();
    return searchTools(all, call.search).slice(0, 10);   // ranked
  }
  if ("describe" in call) return server.describe(call.describe);   // lazy schema
  return server.call(call.tool, call.args);              // call
}
// Tool meta: name "mcp", description ~200 tokens, schema = discriminated union above
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ ~200 tokens thay 10k+ — tiết kiệm lớn | ❌ Agent cần thêm round-trip (search→describe→call) |
| ✅ Lazy discovery — tool load khi cần | ❌ Search kém → agent không tìm thấy tool cần |
| ✅ Một tool quản lý toàn MCP server | ❌ Mất tool-specific validation ở prompt-time |

## Khác các hướng gần

| | AFY MCP Proxy-Tool | AGA Direct-Tools Hybrid | tool-search |
|---|---|---|---|
| Token | ~200 (min) | 150-300/tool (hot) | n/a (engine) |
| Discovery | on-demand union | promote hot + proxy rest | BM25 engine |
| Mục đích | Nén trăm tool | Cân bằng hot vs proxy | Search ranking |

## Khi nào chọn

- MCP server có nhiều tool (hàng trăm) gây token bloat
- Muốn agent discover tool on-demand thay vì nạp hết
- Cần tiết kiệm context cho việc chính
- Guard: search quality tốt, describe fallback khi không rõ, error rõ khi tool không tồn tại
