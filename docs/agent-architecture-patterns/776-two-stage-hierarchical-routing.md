# Hướng ACV: Two-Stage Hierarchical Routing — routing 2 tầng giảm eager skill-listing token cost; MCP tool schema là chi phí 20k+ tokens/server mỗi turn

> **Nguồn gốc:** get-shit-done (docs/dev/architecture.md) | **Coupling:** 🟢 — routing layer, provider/tool registry không đổi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có namespace router — chưa có MCP schema budget control) | **Effort:** 1-2 tuần

## Nguồn gốc

**get-shit-done** dùng **routing 2 tầng** giảm **eager skill-listing token cost**: tầng 1 chọn namespace (gọn), tầng 2 route tới concrete skill — không liệt kê hết mọi skill eager vào prompt. Tài liệu cũng chỉ ra một chi phí ẩn lớn: **MCP tool schema là chi phí 20k+ tokens/server mỗi turn** — mỗi MCP server mang theo schema của mọi tool, tính vào context window mỗi lần gọi. Cần **disciplined MCP enablement** bên cạnh **model_profile tuning** để kiểm soát context budget — không nạp MCP server nào cũng nạp hết schema. Nguyên tắc: **hai tầng routing cho mọi resource (skill/tool/MCP), schema không eager nạp, budget có kiểm soát**.

## Mô tả

mya two-stage hierarchical routing: (1) **tầng 1 — namespace/registry gọn** — skill (ACU) + tool categories + MCP server list ngắn (tên + mô tả 1 dòng); (2) **tầng 2 — schema chi tiết** — chỉ khi model chọn mới nạp schema (tool schema đầy đủ, skill body, MCP tool schemas); (3) **MCP budget control** — đếm tokens schema mỗi server, không nạp quá ngưỡng; disciplined enablement — chỉ bật MCP server thật sự cần cho task; (4) **model_profile tuning** — per-model giới hạn context budget cho schema/tool listing. Nối gateway mcp-lifecycle.ts (đã có phase + health) — ACV thêm budget layer.

## Kiến trúc

```
  PROMPT ASSEMBLY
       ▼
  TẦNG 1 — INDEX GỌN (eager, rẻ)
    skills: 6 namespace · tools: categories · MCP: server list 1 dòng
       │  model chọn
       ▼
  TẦNG 2 — SCHEMA CHI TIẾT (lazy, đắt — chỉ khi cần)
    skill body · tool schema · MCP tool schemas
       ▼
  MCP BUDGET CONTROL
    │ MCP server A: 22k tokens schema ──▶  │
    │   disciplined enablement — chỉ bật   │
    │   server thực sự cần cho task        │
    │ model_profile tuning — per-model cap │
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills namespace-router.ts (ACU) — 2-step skill routing (nền tầng 1)
// ✅ packages/skills curator.ts — loadBody (nền tầng 2 — lazy body)
// ✅ packages/gateway mcp-lifecycle.ts — McpPhase + availableTools (nền — MCP quản lý)
// ✅ packages/gateway mcp.ts — MCP client (nền — schema nguồn)
// ✅ packages/ai model-routing.ts — ModelTier + resolveTierModel (nền — model_profile tuning)
// ✅ packages/core budget.ts — createBudget (nền — context budget)

// ❌ THIẾU: MCP schema token counting + cap per server
// ❌ THIẾU: disciplined enablement policy (chỉ bật server cần)
// ❌ THIẾU: per-model schema budget (model_profile tuning cho schema)
```
## Implementation
```typescript
// packages/gateway/src/mcp-budget.ts (MỚI)
export interface McpSchemaBudget {
  /** Token đếm được của schema server này. */
  schemaTokens: number;
  /** Nạp vào prompt hay không (disciplined enablement). */
  enabled: boolean;
  reason: string;
}
const DEFAULT_SCHEMA_BUDGET = 8_000; // tokens — dưới 20k+/server mặc định
const MAX_SERVERS_PER_TURN = 4;
/** Đếm tokens schema — ước lượng 4 chars/token cho schema JSON. */
export function estimateSchemaTokens(schema: unknown): number {
  const json = JSON.stringify(schema ?? {});
  return Math.ceil(json.length / 4);
}
/** Quyết định server nào được nạp schema vào prompt. */
export function selectMcpServers(
  servers: Array<{ name: string; schema: unknown; required: boolean }>,
  opts: { budgetPerServer?: number; maxServers?: number } = {},
): McpSchemaBudget[] {
  const budget = opts.budgetPerServer ?? DEFAULT_SCHEMA_BUDGET;
  const maxServers = opts.maxServers ?? MAX_SERVERS_PER_TURN;
  const scored = servers.map((s) => ({
    ...s,
    tokens: estimateSchemaTokens(s.schema),
  })).sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0) || a.tokens - b.tokens);
  const out: McpSchemaBudget[] = [];
  let loaded = 0;
  for (const s of scored) {
    const overBudget = s.tokens > budget;
    const overCount = loaded >= maxServers;
    const enabled = s.required ? !overBudget && !overCount : !overBudget && !overCount && loaded < maxServers;
    if (enabled) loaded += 1;
    out.push({
      schemaTokens: s.tokens,
      enabled,
      reason: overBudget
        ? `schema ${s.tokens} tokens > budget ${budget} — disciplined enablement: bỏ`
        : overCount
          ? `vượt max ${maxServers} servers/turn — bỏ`
          : `nạp schema (${s.tokens} tokens)`,
    });
  }
  return out;
}
/** Báo cáo context cost — để model_profile tuning. */
export function mcpBudgetReport(budgets: McpSchemaBudget[]): string {
  const total = budgets.reduce((n, b) => n + b.schemaTokens, 0);
  const loaded = budgets.filter((b) => b.enabled).reduce((n, b) => n + b.schemaTokens, 0);
  return `MCP schema: ${loaded}/${total} tokens nạp (${budgets.filter((b) => b.enabled).length}/${budgets.length} servers)`;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Schema MCP không nạp hết — tiết kiệm 20k+ tokens/server | ❌ Model phải biết server nào cần (tầng 1 phải đủ thông tin) |
| ✅ Two-stage — eager index rẻ, lazy schema đắt đúng lúc | ❌ Lazy nạp schema thêm latency khi cần tool |
| ✅ Budget + cap per server/turn — context có kiểm soát | ❌ Server required vượt budget → tool mất, phải xử lý |
| ✅ Disciplined enablement — không "bật hết cho chắc" | ❌ Token estimate (4 chars/token) chỉ gần đúng |

## Khác các hướng gần

| | ACU: Namespace Router (skills) | ACV: Two-Stage + MCP Budget |
|---|---|---|
| Phạm vi | Skill index | **Mọi resource: skill + tool + MCP schema** |
| Token | Index 2150 → 120 | **MCP schema 20k+ → cap per server** |
| Cơ chế | Namespace + tags | **2 tầng routing + disciplined enablement** |
| Đo | Token index | **Báo cáo schema tokens nạp/tổng** |

## Khi nào chọn

- Nhiều MCP server — schema tốn 20k+ tokens/server mỗi turn
- Muốn two-stage routing cho mọi resource (skill/tool/MCP)
- Đã có ACU + mcp-lifecycle — thêm budget layer
- Guard: cap per server + per turn, báo cáo tokens nạp, required server có policy rõ
