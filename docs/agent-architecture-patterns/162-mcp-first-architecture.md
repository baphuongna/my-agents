# Hướng FF: MCP-First Architecture — agent là MCP server/client, mọi thứ qua protocol

> **Nguồn gốc:** arXiv 2505.02279 "A Survey of Agent Interoperability Protocols" (MCP/ACP/A2A); AWS "Open Protocols for Agent Interoperability" (agents as MCP servers — microservice-like); CSA "Agentic MCP Security Best Practices v1"; Backslash "What is MCP"
> **Coupling:** 🟡 — các component phải lộ qua MCP (protocol-bound)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (MCP gateway + tool registry + ACP sẵn; thiếu expose layer)
> **Effort:** 2-3 tuần

## Nguồn gốc

MCP-first: **mọi năng lực agent = MCP server; agent dùng = MCP client — micro-service style** — arXiv 2505.02279: khảo sát 4 giao thức interoperability — MCP (tool), ACP (agent), A2A (agent-to-agent); AWS: "Agents exposed as MCP servers provide a micro-service-like architecture that decouples agents from each other, leveraging MCP as the common integration point"; CSA v1: "MCP operates as a client-server protocol — MCP host (Claude Desktop, Cursor, enterprise orchestration)"; Backslash: "AI models only see what an MCP server explicitly exposes, actions gated behind approvals". Điểm khác **BBB MCP gateway** (mya đứng giữa nhiều MCP servers — consume) — GGGGGGG *cả hai chiều*: mya không chỉ gọi MCP ngoài mà *chính nó là MCP server* — expose tool/skill/context cho agent khác (A2A-style giao tiếp qua MCP — AWS), mỗi năng lực là server riêng (granular — microservice), security theo chuẩn CSA (identity, secret manager, approvals). Nối BBB (gateway — consume), NNN (registry — expose gì), IIIIII (supply chain — verify server), TTTTTT (identity — MCP auth), UUUU (perm — gating actions per user).

## Mô tả

mya MCP-first: (1) **expose layer** — tool/skill/năng lực mya bọc thành MCP servers riêng (1 năng lực = 1 server — dễ tái dùng, kiểm soát scope); (2) **agent-as-server** — agent mya tự lộ qua MCP (AWS: agents as MCP servers — agent khác gọi như micro-service); (3) **security chuẩn CSA** — mỗi server: identity (TTTTTT), secret manager (KKKK), approvals (CCCC) — "models only see what server explicitly exposes" (Backslash); (4) **protocol-first** — giao tiếp giữa các component qua MCP (không function call trực tiếp) — đổi/ghép dễ; (5) **verify** — server từ ngoài verify (IIIIII supply chain — chữ ký/SBOM); (6) **registry** — NNN quản danh sách server nội/ngoại, expose policy (UUUU — ai gọi được gì).

## Kiến trúc

```
  NĂNG LỰC mya (tool/skill/context) ──► MCP SERVER (1 năng lực = 1 server)
        │  (agent-as-server — AWS microservice-style)
        ▼
  AGENT KHÁC / HOST (Claude Desktop, Cursor, orchestration) ──► MCP CLIENT
        │  gọi qua protocol — không function call trực tiếp
        ▼
  SECURITY (CSA v1): identity (TTTTTT) · secret manager (KKKK)
   approvals (CCCC) · model chỉ thấy cái server expose (Backslash)
        │
        ▼
  QUẢN LÝ: NNN registry · expose policy (UUUU) · verify (IIIIII)
```

```
mya: MCP gateway + NNN + ACP SẸN — thiếu: expose layer (mya là MCP server)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ BBB MCP gateway — consume MCP servers ngoài (nền)
// ✅ NNN tool registry — quản năng lực (thêm expose)
// ✅ KKKK credential broker — secret manager (CSA)
// ✅ CCCC HITL — approvals (CSA gating)
// ✅ TTTTTT identity — auth (CSA agent identity)
// ✅ IIIIII supply chain — verify server ngoài
// ✅ UUUU perms — gating actions

// ❌ THIẾU: expose layer (mya là MCP server)
// ❌ THIẾU: agent-as-server (AWS pattern — lộ agent qua MCP)
// ❌ THIẾU: MCP security hardening (CSA v1 checklist)
```

## Implementation

```typescript
// packages/mcp/src/expose.ts (NEW)
export class MCPExposer {
  expose(agent: Agent): McpServer {
    return this.server({
      name: agent.name, tools: this.tools(agent),   // NNN — năng lực lộ
      auth: identity.mcp(agent),                    // TTTTTT — CSA identity
      gate: (action) => perms.check(action),        // UUUU + CCCC approvals
      secrets: broker.scope(agent),                 // KKKK — secret manager
    }); // AWS: agent-as-server — agent khác gọi như micro-service
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tái dùng năng lực — agent khác gọi qua chuẩn MCP | ❌ Protocol-bound — thêm lớp chuyển tiếp |
| ✅ Granular scope — model chỉ thấy cái expose (Backslash) | ❐ Security phức tạp (CSA — identity/secret/approve) |
| ✅ Microservice-style — đổi/ghép năng lực dễ | ❌ Latency/overhead qua protocol so với gọi thẳng |
| ✅ Xây trên gateway + registry + broker | ❌ 1 máy 1 agent — MCP-first thừa |

## Khác các hướng gần

| | BBB MCP Gateway | ACP Bridge | GGGGGGG: MCP-First |
|---|---|---|---|
| Chiều | Consume (gọi ngoài) | ACP protocol | **Expose — mya là server** |
| Vai trò | Client | Bridge | **Cả client + server qua MCP** |
| Thêm | — | — | **Agent-as-server + CSA security** |

## Khi nào chọn

- Agent/tool của bạn được người khác dùng — expose qua chuẩn MCP
- Hệ agent nhiều component — giao tiếp qua protocol thay gọi thẳng
- Đã có BBB + NNN + KKKK + TTTTTT — thêm expose + CSA hardening
- Muốn interop (Anthropic MCP ecosystem, Cursor, Claude Desktop)