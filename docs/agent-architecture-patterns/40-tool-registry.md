# Hướng OO: Tool Registry + Permission Matrix — schema tập trung, least-privilege

> **Nguồn gốc:** Plugin systems (Emacs/VS Code); OpenAI function calling schemas (2023)
> **Coupling:** 🟡 Public API — tools phải đăng ký qua registry
> **Agent-agnostic:** ⚠️ — schema mya riêng, bridge cho pi (registerTool)
> **Code sẵn:** ✅ ToolRegistry (agent) + roles registry (core) + pi.registerTool bridge
> **Effort:** 1 tuần (chuẩn hóa + permission matrix)

## Nguồn gốc

Hệ plugin lớn nhất thế giới (VS Code, Emacs) đều có **một nơi đăng ký extension point** + schema kiểm tra lúc load. LLM agents cần điều đó gấp đôi: function-calling yêu cầu **JSON schema chính xác** cho từng tool, và **permission matrix** — tool nào agent nào được gọi, tham số nào được phép (least-privilege). Không registry → schema lệch nhau giữa các nơi, tool "ma" không ai kiểm soát.

## Mô tả

**ToolRegistry** là nơi duy nhất: đăng ký tool (name + schema + handler + permission tag), render thành OpenAI function schemas, kiểm tra permission trước khi chạy. **Roles** (packages/core/roles.ts) gắn tập tool + model + prompt theo vai trò. Bridge với pi qua `pi.registerTool()` để tool mya xuất hiện trong TUI pi.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                    TOOL REGISTRY (mya)                      │
│                                                            │
│  register(Tool)  ──►  ┌──────────────────────┐             │
│                      │  name + jsonSchema    │             │
│                      │  handler + permission │             │
│                      │  source: native|bridge│             │
│                      └──────────┬───────────┘             │
│                                 ▼                          │
│        ┌────────────┬──────────┴──────────┬─────────────┐  │
│        ▼            ▼                     ▼             ▼  │
│  buildOpenAITools  renderToolsBlock    permissionGate   │  │
│  (function schemas)(stableTier prompt) (role → allowed) │  │
│                                                            │
│  Roles (core/roles.ts):  coder → [read, edit, bash]        │
│                          reviewer → [read]                 │
│                          default → subset                  │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// packages/agent/src/index.ts — createAgent()
const toolRegistry = new ToolRegistry();          // registry tập trung
// renderToolsBlock(registry)    → stable tier prompt (tên + mô tả)
// buildOpenAITools(registry)    → OpenAI function-calling schemas

// packages/print/src/mya-bridge.ts — bridge sang pi
pi.registerTool({ name, description, parameters, handler, permission });
// 15+ tools bridge (roles, skills, kanban, memory, v.v.)

// packages/core/src/roles.ts — role registry (load ~/.mya/roles/*.json)
// role = { prompt overlay, tools, model } — chưa có permission tag chặt chẽ
```

## Permission matrix (phần thiếu)

```typescript
// packages/agent/src/permission.ts (NEW)
interface PermissionTag {
  roles: string[];                  // ai được gọi
  args?: Record<string, unknown>;   // arg nào được phép (allowlist)
  rateLimit?: { cap: number; perMs: number };
}

async function guardToolCall(
  registry: ToolRegistry,
  role: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = registry.get(toolName);
  if (!meta) return { ok: false, reason: `unknown tool ${toolName}` };
  if (!meta.permission.roles.includes(role)) {
    return { ok: false, reason: `${role} không có quyền gọi ${toolName}` };
  }
  for (const [k, allowed] of Object.entries(meta.permission.args ?? {})) {
    if (args[k] !== undefined && !isAllowed(args[k], allowed)) {
      return { ok: false, reason: `${toolName}.${k} = ${JSON.stringify(args[k])} bị cấm` };
    }
  }
  return { ok: true };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nơi nhìn toàn bộ tool surface | ❌ Tool không đăng ký → không dùng được |
| ✅ Schema chuẩn cho function-calling | ❌ Permission tag phải được bảo trì theo role |
| ✅ Least-privilege theo role (chống leo thang) | ❌ Bridge pi.registerTool phụ thuộc API pi |
| ✅ Prompt stable tier sinh từ registry | ❌ Roles lệch với code → tool "ma" (đã có test) |
| ✅ Đã có sẵn phần lớn (agent + core + bridge) | |

## Khác Policy Engine (Hướng O)

| | O: Policy Engine | OO: Tool Registry |
|---|---|---|
| Vị trí | Gate YES/NO trên *hành vi agent* | Danh mục + schema + permission của *tools* |
| Câu hỏi | "Hành động này có được phép?" | "Tool này tồn tại? Schema? Ai được gọi?" |
| Trạng thái | Chính sách cấp cao (guard rails) | Cấu trúc tool surface (low-level) |

## Khi nào chọn

- Nhiều tools + nhiều roles → cần danh mục tập trung
- Function-calling (cần schema chính xác)
- Cần least-privilege (reviewer đọc không ghi)
- Muốn prompt stable tier tự sinh từ registry
- Đã có ToolRegistry + roles — thêm permission tag là đủ
