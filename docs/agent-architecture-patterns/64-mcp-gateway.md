# Hướng BL: MCP Gateway — tổng hợp nhiều MCP servers sau một endpoint

> **Nguồn gốc:** arcade.dev "MCP Gateway Pattern" (2025); zuplo/xenoss/requesty (2025-2026)
> **Coupling:** 🟢 Protocol — client chỉ thấy 1 MCP surface
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (phần lớn — mcp-client + lifecycle + OAuth sẵn; thiếu aggregation facade)
> **Effort:** 1-2 tuần

## Nguồn gốc

MCP Gateway (2025-2026 trend khi số MCP servers bùng nổ): một **MCP server duy nhất** đứng giữa agents và **nhiều MCP servers backend** — "federated/aggregated view" (arcade.dev: "single MCP entrypoint that federates tools from multiple MCP servers into one managed tool surface"). Gateway lo: discovery/aggregation (gộp tool catalog), routing (tool này ở server nào), policy (ai được gọi tool gì), auth (mỗi backend khác nhau), rate-limit, observability tập trung (zuplo: thay vì "combing through logs across multiple MCP servers"). Khác **04 Shell+MCP** (mya expose *1* server), khác **OO Tool Registry** (registry tool nội bộ, không phải protocol), khác **BBB A2A** (tầng agent-to-agent, không phải hạ tầng MCP).

## Mô tả

mya làm **gateway**: expose 1 MCP endpoint → agents/CLI gọi tool qua đó → gateway route tới đúng backend server (firecrawl, git, kanban, pi...) → gộp schema, enforce policy (OO roles), centralize OAuth (mcp-oauth sẵn), emit trace (JJJ). `packages/gateway` đã có: `mcp-client.ts` (client gọi servers), `mcp-lifecycle.ts` (connect/disconnect/health), `mcp-oauth.ts` + `mcp-oauth-store.ts` (OAuth/PKCE per server) — nghĩa là mya *đã là MCP client đầy đủ*; thiếu phần **server facade tổng hợp** + policy routing.

## Kiến trúc

```
  agents / clients
       │  (1 MCP endpoint duy nhất)
       ▼
  MCP GATEWAY (mya)
  ├─ aggregation: gộp tool catalog từ N backends (schema merge, đổi tên xung đột)
  ├─ routing: tool ──► server đúng (tool registry, OO policy)
  ├─ auth: OAuth/PKCE per backend (mcp-oauth.ts sẵn)
  ├─ policy: roles gating trước khi forward (OO)
  └─ observability: span per call (JJJ), rate-limit (SS)
       │
       ▼
  backends: firecrawl · git · kanban · pi-rpc · search ...
```

```
mya: packages/gateway/src/mcp-client.ts + mcp-lifecycle.ts + mcp-oauth.ts SẴN
     thiếu: gateway server facade (aggregation + routing policy)
```

## mya ĐÃ CÓ (phần lớn)

```typescript
// ✅ packages/gateway/src/mcp-client.ts — MCP client gọi backend servers
// ✅ packages/gateway/src/mcp-lifecycle.ts — lifecycle connect/health
// ✅ packages/gateway/src/mcp-oauth.ts + mcp-oauth-store.ts — OAuth/PKCE per server
// ✅ packages/gateway/src/mcp-reliability.ts — retry/backoff cho MCP calls
// ✅ packages/gateway/src/provider-registry.ts — registry provider (dùng cho routing)

// ❌ THIẾU: server facade — expose 1 MCP endpoint tổng hợp (hiện là client thuần)
// ❌ THIẾU: schema aggregation (gộp catalog, resolve tool name conflict)
// ❌ THIẾU: policy routing theo OO roles trước khi forward
```

## Implementation

```typescript
// packages/gateway/src/gateway-server.ts (NEW)
interface GatewayConfig {
  backends: Array<{ id: string; url: string; tools: string[] }>;
}

class McpGateway {
  private catalog: Map<string, { backendId: string; schema: ToolSchema }>;

  async start(): Promise<void> {
    for (const b of this.backends) {
      const client = await connectMcp(b);        // mcp-lifecycle.ts
      for (const tool of await client.listTools()) {
        this.catalog.set(tool.name, { backendId: b.id, schema: tool });
      }
    }
    this.serve("mcp://gateway");                  // 1 endpoint cho tất cả
  }

  async callTool(name: string, args: unknown, caller: AgentId): Promise<Result> {
    if (!this.permitted(caller, name)) return denied;   // OO roles
    const { backendId } = this.catalog.get(name)!;
    return this.forward(backendId, name, args);         // + span JJJ, rate-limit SS
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent thấy 1 surface — không cần biết N server | ❌ Gateway là single point (cần resilience — GG) |
| ✅ Policy/rate-limit/observability tập trung 1 chỗ | ❌ Aggregation schema xung đột tên cần resolve |
| ✅ OAuth per backend đã có — tận dụng sẵn | ❌ Forward thêm hop (latency nhỏ) |
| ✅ Routing tiện: thêm server không đổi client | ❌ Server đặc biệt (streaming) khó aggregate |
| ✅ MCP client+lifecycle+OAuth sẵn — chỉ thêm facade | |

## Khác các hướng gần

| | 04 Shell+MCP | OO Tool Registry | MMM: MCP Gateway |
|---|---|---|---|
| Hướng | mya là server (1) | Registry nội bộ | mya là **gateway tổng hợp** |
| Phạm vi | Expose cho external | Tool của mya | Nhiều MCP servers → 1 |
| Policy | Không | Roles | Roles + routing + auth + telemetry |
| Tầng | Protocol | Code | Protocol + hạ tầng |

## Khi nào chọn

- Nhiều MCP servers (firecrawl, git, kanban, pi...) khó quản lý rải rác
- Muốn policy + observability tập trung (kết hợp JJJ)
- Muốn expose 1 endpoint chuẩn cho external agents (04 mở rộng)
- MCP client + OAuth sẵn — thêm facade server là bước ngắn