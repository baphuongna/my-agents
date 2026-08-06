# Hướng CE: Tool Discovery & Registry Network — tìm/cài tool theo nhu cầu

> **Nguồn gốc:** Smithery / MCPHub / modelcontextprotocol.io servers (2025-2026); MCP ecosystem
> **Coupling:** 🟢 Protocol — tool qua MCP, thêm/bớt không đụng code
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (mcp-client + OO registry sẵn; thiếu discovery/index)
> **Effort:** 1-2 tuần

## Nguồn gốc

MCP ecosystem bùng nổ 2025-2026 → nhu cầu **discovery**: kho tool chuẩn hóa (Smithery, MCPHub, modelcontextprotocol/servers) — tìm MCP server theo mô tả, xem đánh giá, **cài 1 lệnh** (`npx -y @smithery/cli install`). Pattern: agent **chủ động tìm tool khi thiếu** — task cần tool X → query registry → xác thực (nguồn, độ phổ biến, maintainer) → install MCP server → dùng. Khác **OO Tool Registry** (registry *nội bộ* các tool mya tự viết) — discovery là **kho ngoài** (cài tool mới từ internet); khác **NNN Tool Maker** (tự viết tool) — discovery là **tìm tool đã tồn tại**; khác **BBB Capability Cards** (A2A giữa agents) — đây là hạ tầng MCP tools.

## Mô tả

mya gặp task cần khả năng chưa có (scrape web, đọc PDF, phân tích image) → RR routing thấy gap → **discovery query** lên registry (Smithery-class): `{ search: "web scrape", protocol: mcp }` → kết quả kèm metadata (downloads, maintainer, stars) → **xác thực + chọn** (OO policy: allowlist nguồn tin cậy, review schema tool) → install (mcp-client sẵn connect) → tool mới vào OO registry (đánh dấu "external") → dùng. Khác hẳn cài thủ công: agent **tự phát hiện gap + đề xuất** — nhưng quyết định cuối là con người qua gate (OO approve) — tool từ internet là **trust boundary** (chạy mã lạ — nối KKK secrets, RRR firewall, NNN verify). Quản lý lifecycle: update, uninstall, taint khi hỏng (QQ).

## Kiến trúc

```
  task cần khả năng mới ──► RR: gap detection (không tool khớp)
        │
        ▼
  DISCOVERY (query kho: Smithery/MCPHub)
        │  metadata: downloads · maintainer · protocol · stars
        ▼
  XÁC THỰC + CHỌN (OO: allowlist nguồn, review schema)
        │  con người approve (trust boundary — tool từ internet)
        ▼
  INSTALL (mcp-client connect) ──► OO registry (đánh dấu external)
        │  lifecycle: update · uninstall · taint khi hỏng (QQ)
        ▼
  AGENT DÙNG TOOL MỚI (KKK secrets + RRR firewall bọc)
```

```
mya: mcp-client (connect) + OO registry (chứa) + QQ taint SẴN
     thiếu: discovery query + gate approve + lifecycle ngoài
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/gateway/src/mcp-client.ts — connect MCP server mới cài
// ✅ OO ToolRegistry — nơi đăng ký tool external + permission
// ✅ QQ registry taint — tool hỏng → gỡ
// ✅ packages/gateway/src/mcp-oauth.ts — auth cho server mới
// ✅ KKK/RRR — bọc tool ngoài (secret + firewall)

// ❌ THIẾU: discovery query (search registry + metadata)
// ❌ THIẾU: gate approve (con người duyệt tool từ internet)
// ❌ THIẾU: lifecycle (update/uninstall theo phiên bản)
```

## Implementation

```typescript
// packages/tools/src/discovery.ts (NEW)
interface RegistryHit {
  name: string; protocol: "mcp"; description: string;
  downloads: number; maintainer: string; stars: number;
}

async function discoverTool(gap: string, policy: ToolPolicy): Promise<Tool | null> {
  const hits = await queryRegistry({ search: gap, protocol: "mcp" });  // Smithery-class
  const candidates = hits.filter((h) => policy.allowlist(h.maintainer)); // OO
  const chosen = await humanApprove(candidates[0] ?? null);              // GATE
  if (!chosen) return null;
  await installMcp(chosen);                       // mcp-client + oauth
  return registry.register({ ...chosen, external: true });  // OO + taint (QQ)
}
// TRUST BOUNDARY: tool từ internet chạy mã lạ — KKK/RRR bọc mọi call
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự phát hiện gap + đề xuất tool phù hợp | ❌ Tool từ internet = **trust boundary** (mã lạ) — cần gate |
| ✅ Không tự viết lại tool có sẵn (tiết kiệm vs NNN) | ❌ Chất lượng registry không đồng đều (downloads ≠ tốt) |
| ✅ mcp-client + OO + taint sẵn — thêm discovery | ❌ Phụ thuộc kho ngoài (chết → không discover) |
| ✅ Lifecycle quản được (update/taint) | ❌ Schema tool ngoài không theo chuẩn mya (ACI) |
| ✅ Kết hợp KKK/RRR bọc an toàn | |

## Khác các hướng gần

| | OO Tool Registry | NNN Tool Maker | FFFF: Tool Discovery |
|---|---|---|---|
| Tool từ đâu | mya tự viết | Agent viết | **Kho ngoài (MCP)** |
| Gate | Roles | Verify tests | **Con người approve** |
| Mối quan hệ | Chứa tool mới | Đối chọn (viết vs tìm) | Cấp tool cho OO |

## Khi nào chọn

- Task thường cần khả năng mới (web, PDF, media) — không muốn tự viết
- Muốn agent đề xuất tool nhưng con người quyết định (gate)
- Đã có mcp-client + OO + taint — thêm discovery layer
- Chấp nhận quản lý tool ngoài (update/lifecycle)