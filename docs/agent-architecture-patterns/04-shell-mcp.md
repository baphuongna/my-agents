# Hướng D: Shell + MCP Server — chuẩn giao thức, opt-in

> **Coupling:** 🟢 Zero — chuẩn MCP, không API nội bộ
> **Agent-agnostic:** ✅ — bất kỳ agent hỗ trợ MCP
> **Effort:** 2-3 tuần

## Mô tả

mya spawn agents làm subprocess. mya chạy MCP Server (Model Context Protocol) expose features (memory, audit, skills, cost) qua stdio JSON-RPC. Agents CONNECT nếu hỗ trợ MCP. Agents không connect cũng chạy bình thường (opt-in).

## Kiến trúc

```
┌─ mya daemon ─────────────────────────────────────────────┐
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  MCP SERVER (mya exposes features)               │    │
│  │                                                  │    │
│  │  Tools:                                          │    │
│  │  · memory_recall(query) → facts/takes            │    │
│  │  · memory_record(fact)                           │    │
│  │  · audit_log(action, result)                     │    │
│  │  · skill_search(query) → skills                  │    │
│  │  · cost_report()                                 │    │
│  │  · kanban_list() / kanban_claim(task)            │    │
│  │                                                  │    │
│  │  Protocol: stdio JSON-RPC 2.0                    │    │
│  │  (MCP standard — any agent can connect)          │    │
│  └────────────────────┬─────────────────────────────┘    │
│                       │                                   │
│  spawn("pi", [        │ spawn("claude",      spawn("xyz") │
│    "--mcp-server",    │   ["--mcp",            ["--mcp",  │
│     "mya-mcp"])       │    "mya-mcp"])         "mya-mcp"])│
│                       │                                   │
└───────────────────────┼───────────────────────────────────┘
                        │ MCP protocol
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │   pi     │ │ claude   │ │ opencode │
    │ subprocess│ │subprocess│ │subprocess│
    │          │ │          │ │          │
    │ own TUI  │ │ own CLI  │ │ own TUI  │
    │ own tools│ │ own tools│ │ own tools│
    │ +mya MCP │ │ +mya MCP │ │ (no MCP) │
    │ (opt-in) │ │ (opt-in) │ │ = native │
    └──────────┘ └──────────┘ └──────────┘
```

## mya ĐÃ CÓ MCP infrastructure

```typescript
// packages/gateway/src/mcp-client.ts — ĐÃ CÓ MCP CLIENT
// Connects to external MCP servers, discovers tools, exposes as pi tools
export class McpManager {
  private servers = new Map<string, McpServer>();
  // spawn MCP server process, discover tools, proxy calls
}

// packages/gateway/src/mcp-lifecycle.ts — 11-phase FSM
// CẦN THÊM: MCP SERVER (mya expose tools to agents)
// Hiện chỉ có MCP CLIENT (mya consumes external tools)
```

## Code cần thêm

```typescript
// packages/gateway/src/mcp-server-endpoint.ts (NEW)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = new Server(
  { name: "mya-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register mya's features as MCP tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "memory_recall", description: "Recall facts from Brain memory",
      inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "memory_record", description: "Record a fact",
      inputSchema: { type: "object", properties: { fact: { type: "string" } } } },
    { name: "audit_log", description: "Log an action to Merkle audit",
      inputSchema: { type: "object", properties: { action: { type: "string" }, result: { type: "string" } } } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  switch (name) {
    case "memory_recall": return { content: [{ type: "text", text: JSON.stringify(await brain.recall(args.query)) }] };
    case "memory_record": await brain.recordFact(args.fact); return { content: [{ type: "text", text: "recorded" }] };
    case "audit_log": auditLog.append({ kind: "mcp", ...args }); return { content: [{ type: "text", text: "logged" }] };
  }
});
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chuẩn MCP — bất kỳ agent hỗ trợ MCP | ❌ pi chưa có MCP client built-in |
| ✅ Zero coupling (chuẩn, không API nội bộ) | ❌ Claude CLI chưa cài để test |
| ✅ Opt-in (agent không connect cũng chạy) | ❌ Tools trùng lặp (agent có tools riêng + mya tools) |
| ✅ Memory/audit/skills qua standard protocol | ❌ Latency (JSON-RPC round-trip) |
| ✅ Agents upgrade độc lập hoàn toàn | ❌ pi cần thêm `--mcp` flag (chưa có) |

## Vấn đề pi chưa có MCP client

pi hiện nhận MCP qua mya-bridge extension (in-process). Pi CLI standalone không tự connect MCP server.

Giải pháp:
1. Wrapper script: `mya-mcp-bridge` — spawn pi + inject MCP-connected extension
2. Hoặc đợi pi thêm `--mcp-server` flag
3. Hoặc dùng Claude (đã có MCP support theo docs)

## Khi nào chọn

- Muốn chuẩn giao thức (MCP) thay vì API nội bộ
- Agents hỗ trợ MCP (Claude có, pi cần thêm)
- OK với opt-in (agent không connect cũng chạy)
- Lâu dài sạch nhất cho interoperability
