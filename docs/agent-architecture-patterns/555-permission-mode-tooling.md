# Hướng UI: Permission Mode Tooling — map tool → required PermissionMode, quyết định prompt/block cho từng call

> **Nguồn gốc:** claw-code `PermissionEnforcer` (tool→PermissionMode mapping, ReadOnly/WorkspaceWrite/DangerFullAccess, prompt/block decision); "map tool to required permission", "ReadOnly/WorkspaceWrite/DangerFullAccess", "decide prompt or block per call" | **Coupling:** 🟡 — thêm permission-enforcer vào tool dispatch | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (permission + approval sẵn — chưa có mode-mapping + prompt/block enforcer) | **Effort:** 2-3 tuần

## Nguồn gốc

**claw-code** `PermissionEnforcer` gắn mỗi tool với **required PermissionMode** — 3 cấp: (1) **ReadOnly** — tool chỉ đọc (read/ls/grep), không cần prompt. (2) **WorkspaceWrite** — tool ghi trong workspace (edit/write/mkdir), cần user **prompt** (confirm trước khi chạy). (3) **DangerFullAccess** — tool nguy hiểm (exec/bash/network/delete ngoài workspace), cần user **prompt + warning** hoặc **block** nếu mode hiện tại không đủ. Khi agent gọi tool, enforcer check: **current mode** ≥ **required mode**? Nếu đủ → allow; nếu thiếu → **prompt user** (confirm) hoặc **block** (auto-reject nếu không thể escalate). Nguyên tắc: **permission theo tool, không theo agent** — mỗi tool có yêu cầu riêng, enforce từng call.

## Mô tả

mya permission mode tooling: (1) **Mode catalog**: ReadOnly < WorkspaceWrite < DangerFullAccess (ladder). (2) **Tool→mode map**: mỗi tool gắn required mode. (3) **Enforcer**: current mode ≥ required → allow; thiếu → prompt/block. (4) **Per-call decision**: mỗi tool-call check riêng (không blanket-allow). mya có permission + approval — UI thêm **mode-ladder** + **tool-mode-map** + **per-call-enforcer** + **escalation-prompt**.

## Kiến trúc

```
  AGENT gọi tool (vd: bash "rm -rf /tmp/old")
        │
        ▼
  ┌─── TOOL → MODE MAP ──────────────────────────────────────┐
  │  read/ls/grep  → ReadOnly                                 │
  │  edit/write    → WorkspaceWrite                            │
  │  bash/exec     → DangerFullAccess                          │
  │  bash(rm -rf)  → DangerFullAccess                          │
  └───────────────────────┬─────────────────────────────────┘
                          │ (required = DangerFullAccess)
                          ▼
  ┌─── ENFORCER (current ≥ required?) ───────────────────────┐
  │  current mode: WorkspaceWrite                              │
  │  required:    DangerFullAccess                              │
  │  current < required → ESCALATE                             │
  │    → prompt user: "bash rm -rf needs Danger. Allow?"       │
  │    → user YES → allow (this call only)                     │
  │    → user NO  → BLOCK (tool-call rejected)                 │
  └────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools permission.ts — permission (nền — UI mode ở đây)
// ✅ packages/tools approval.ts — user approval (nền — UI prompt dùng)
// ✅ packages/tools path-safety.ts — path safety (nền — UI workspace boundary)
// ✅ packages/tools dispatch.ts — tool dispatch (nền — UI enforce ở đây)

// ❌ THIẾU: mode-ladder (ReadOnly < WorkspaceWrite < DangerFullAccess)
// ❌ THIẾU: tool-mode-map (tool → required mode)
// ❌ THIẾU: per-call enforcer (current ≥ required → allow/prompt/block)
// ❌ THIẾU: escalation-prompt (user confirm để escalate mode)
```

## Implementation

```typescript
// packages/tools/src/permission-mode-enforcer.ts (MỚI)
type PermissionMode = 'ReadOnly' | 'WorkspaceWrite' | 'DangerFullAccess';
const LADDER: Record<PermissionMode, number> = { ReadOnly: 1, WorkspaceWrite: 2, DangerFullAccess: 3 };

type Decision = { allow: boolean; prompt?: string };

class PermissionModeEnforcer {
  private currentMode: PermissionMode = 'ReadOnly';
  constructor(
    private toolMode: Map<string, PermissionMode>,
    private askUser: (prompt: string) => Promise<boolean>,
  ) {}

  setMode(mode: PermissionMode): void { this.currentMode = mode; }

  // per-call enforcement
  async check(toolName: string, args: unknown): Promise<Decision> {
    const required = this.inferMode(toolName, args);
    if (LADDER[this.currentMode] >= LADDER[required]) return { allow: true };
    // escalate: prompt user
    const prompt = `Tool "${toolName}" requires ${required} (current: ${this.currentMode}). Allow this call?`;
    const ok = await this.askUser(prompt);
    return { allow: ok, prompt: ok ? undefined : `BLOCKED: ${toolName} needs ${required}` };
  }

  // infer required mode (tool default + arg inspection)
  private inferMode(toolName: string, args: unknown): PermissionMode {
    const base = this.toolMode.get(toolName) ?? 'ReadOnly';
    // danger heuristics: rm -rf, network, outside workspace
    if (typeof args === 'string' && /rm\s+-rf|curl|wget/i.test(args)) return 'DangerFullAccess';
    return base;
  }
}

// Usage:
// enforcer.setMode('WorkspaceWrite');
// const d = await enforcer.check('bash', 'rm -rf /tmp/old');
// → prompt: "bash requires DangerFullAccess. Allow?" → user decides
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Permission theo tool (không blanket-allow toàn agent) | ❌ Prompt fatigue (tool nguy hiểm hay prompt) |
| ✅ Mode ladder rõ (ReadOnly < Write < Danger) | ❌ Mode inference heuristic (rm -rf detect có thể miss variant) |
| ✅ Per-call decision (mỗi call check riêng) | ❌ Escalation UX (user phải confirm nhiều) |
| ✅ Block unsafe (current < required → reject) | ❌ Current-mode tracking (stateful, dễ sai) |

## Khác các hướng gần

| | Approval (y/n) | Path-safety check | UI: Permission-Mode |
|---|---|---|---|
| Cái gì | Confirm mỗi write | Path trong workspace | **Tool → mode → allow/prompt/block** |
| Granularity | Per-tool | Per-path | **Per-call (tool + arg)** |
| Mode awareness | ❌ | ❌ | **✅ ReadOnly/Write/Danger** |

## Khi nào chọn

- Cần permission granular (không blanket-allow mọi tool)
- Muốn mode ladder (ReadOnly agent không bao giờ write/exec)
- Tool nguy hiểm cần user prompt (exec/rm/network)
- Nối packages/tools permission.ts + approval.ts + path-safety.ts + dispatch.ts; guard mode-inference-precision (danger heuristic bắt đủ variant), prompt-fatigue (escalation cache — cùng tool+args đã allow trong session), và current-mode-integrity (mode không bị flip ngoài ý muốn); UI = permission mode tooling, kết hợp 554 UH observer-loop-guard (log permission decision) + packages/tools approval (user confirm layer)
