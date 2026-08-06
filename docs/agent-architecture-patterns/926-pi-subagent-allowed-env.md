# Hướng AIP: Subagent Allowed-Env — allowlist enforcement qua env `PI_SUBAGENT_ALLOWED` truyền vào child pi process; child filter registry trước khi LLM thấy tool description

> **Nguồn gốc:** pi-subagent4 | **Coupling:** 🟡 — chạm spawn boundary của subagent | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn toolsAllowList + cron allowlist; subagent còn prompt-based) | **Effort:** 2 tuần

## Nguồn gốc

**pi-subagent4** enforce delegation allowlist **ở runtime boundary**: spawn child pi process kèm env `PI_SUBAGENT_ALLOWED` (danh sách tool được phép); child **filter tool registry trước khi LLM nhìn thấy tool description** — model không bao giờ biết tồn tại tool ngoài allowlist. Đây là **hard boundary**: ràng buộc nằm ở runtime (tool không được đăng ký) chứ không phải prompt ("use only these tools") — prompt bảo không dùng nhưng tool vẫn hiện, model vẫn có thể gọi nhầm; registry filter thì tool không tồn tại trong context của model.

Nguyên tắc: **delegation constraint phải là runtime boundary (allowlist tool registry của child), không phải instruction**; env là kênh truyền cấu hình spawn tự nhiên (spawn args, không cần protocol riêng); filter trước prompt assembly → tiết kiệm token + chống misuse.

## Mô tả

Với mya, pattern = **spawn-time allowlist → child registry filter**: (1) **spawnSubagent/AgentPool.acquire** nhận `allowedTools?: string[]`; (2) khi tạo session child, allowlist được truyền **như config runtime** (không chỉ nối vào system prompt) — với runtime pi thì qua `tools: opts.toolsAllowList` (createAgentSession); với core agent thì filter `ToolRegistry` của sub-session; (3) **filter registry trước prompt assembly** — stableTier tools block + openAITools schemas chỉ chứa tool được phép; (4) **kế thừa denied list** — `DELEGATE_BLOCKED_TOOLS` (task/delegate/spawn/exec/bash) luôn áp cho subagent, không thể allowlist override; (5) **nối sẵn có**: core/runtime-spi `StartOpts.toolsAllowList`, print/cron-role `CRON_DENY_MODE_TOOLS` (cron deny-mode đã dùng allowlist đúng pattern này), core/roles `filterToolsForRole`. Điểm khác spawnSubagent hiện tại — `toolLine` chỉ là prompt overlay (`"Allowed tools: ... Use only these tools."`) — AIP thay bằng filter registry thật.

## Kiến trúc (ASCII)

```
  PARENT (spawn)
    ├─ quyết định allowlist: allowedTools = [...] ∩ (all - DELEGATE_BLOCKED_TOOLS)
    └─ spawn CHILD (env PI_SUBAGENT_ALLOWED / toolsAllowList)
         ▼
  CHILD BOOT
    ├─ đọc allowlist (env/config — không phải prompt)
    ├─ FILTER TOOL REGISTRY trước prompt assembly
    │    └─ registry.list() = registry ∩ allowlist
    ├─ stableTier tools block = CHỈ tool được phép
    ├─ openAITools schemas = CHỈ tool được phép
    └─ LLM không bao giờ thấy tool ngoài allowlist
         (prompt "chỉ dùng các tool này" là lớp thứ 2, không phải ranh giới)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core runtime-spi.ts — StartOpts.toolsAllowList (kênh runtime boundary)
// ✅ packages/print/src/runtimes/pi-in-process.ts — toolsAllowList → createAgentSession({ tools })
// ✅ packages/print/src/cron-role.ts — CRON_DENY_MODE_TOOLS allowlist (deny-mode, đúng pattern)
// ✅ packages/core types.ts — DELEGATE_BLOCKED_TOOLS (subagent deny list)
// ✅ packages/core roles.ts — filterToolsForRole (filter registry theo role)

// ❌ THIẾU: spawnSubagent allowedTools → filter registry (hiện chỉ là prompt overlay)
// ❌ THIẾU: AgentPool.acquire nhận allowlist vào createSession
// ❌ THIẾU: env PI_SUBAGENT_ALLOWED cho child pi process spawn
```

## Implementation

```typescript
// packages/agent/src/index.ts — thay prompt-only bằng registry filter (NEW helpers)
import { DELEGATE_BLOCKED_TOOLS } from "@my-agent/core";
import type { ToolRegistry } from "@my-agent/tools";

/** Allowlist hiệu lực: allowed ∩ (all − DELEGATE_BLOCKED_TOOLS). */
export function effectiveSubagentTools(
  registry: ToolRegistry,
  allowedTools: string[] | undefined,
): string[] {
  const all = registry.list().map((t) => t.name);
  const allowed = allowedTools ? new Set(allowedTools) : new Set(all);
  return all.filter((n) => allowed.has(n) && !DELEGATE_BLOCKED_TOOLS.has(n));
}

/** Tạo sub-session với registry đã filter — LLM không thấy tool ngoài allowlist. */
export function buildSubagentToolRegistry(
  parent: ToolRegistry,
  allowedTools: string[] | undefined,
): ToolRegistry {
  const names = new Set(effectiveSubagentTools(parent, allowedTools));
  const sub = new ToolRegistry();
  for (const t of parent.list()) {
    const impl = parent.get(t.name);
    if (impl && names.has(t.name)) sub.register(impl);   // runtime boundary
  }
  return sub;
}
// spawnSubagent: dùng subRegistry cho openAITools + stableTier tools block
// (toolLine prompt giữ làm lớp thứ 2 — nhưng registry filter là ranh giới chính)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hard boundary — tool ngoài allowlist không tồn tại trong context | ❌ Cần spawn/config riêng per-subagent (không reuse registry cha trực tiếp) |
| ✅ Tiết kiệm token — model không thấy description không cần | ❌ Allowlist phải đủ — thiếu tool làm subagent kẹt |
| ✅ Chống misuse delegation (deny list kế thừa) | ❌ Tool động (Composio/MCP) phải filter tại thời điểm register |
| ✅ Nối cron-role pattern đã có (deny-mode allowlist) | ❌ Env-based yêu cầu child process riêng — in-process subagent dùng object |

## Khác các hướng gần

| | AIP Allowed-Env | ADE Mailbox Dispatch | AIR Abort Threading |
|---|---|---|---|
| Trọng tâm | Ranh giới quyền tool của subagent | Audit messaging | Điều khiển lifecycle |
| Cơ chế | Env + registry filter | Log trạng thái + idempotent | AbortSignal threading |
| Quan hệ | Nền tảng bảo mật delegation | Nối intercom | Nối spawn lifecycle |

## Khi nào chọn

- Delegation cần hard boundary — không tin prompt instruction ("use only these tools")
- Đã có toolsAllowList (runtime-spi) + cron allowlist — thống nhất subagent vào pattern
- Subagent là process riêng (pi) — env là kênh spawn tự nhiên
- Guard: allowlist không override được DELEGATE_BLOCKED_TOOLS; tool động filter tại register