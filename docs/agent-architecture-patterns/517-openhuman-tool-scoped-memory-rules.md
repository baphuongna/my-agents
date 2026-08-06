# Hướng SW: Openhuman Tool-Scoped Memory Rules — rule bền vững theo tool, critical/high pin vào system prompt frozen

> **Nguồn gốc:** openhuman `tools/` (`ToolPolicy`, `PermissionLevel`, `ToolScope`, `PolicyDecision`, memory tool, `update_memory_md`); "per-tool memory rules"; "durable rules attached to tool"; "critical/high priority pinned into frozen system prompt"; "policy evaluated on hot path before execute" | **Coupling:** 🟡 — thêm tool-scoped rule store + system-prompt pin layer (rule theo tool, pin cao cấp vào prompt) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (memory + tool policy sẵn — chưa có tool-scoped rule store + frozen-prompt pin) | **Effort:** 3-4 tuần

## Nguồn gốc

**openhuman** gắn **rule bền vững theo tool**: mỗi tool (`ShellTool`, `FileWriteTool`, `BrowserTool`…) có thể mang **rule riêng** (constraint, preference, safety) — rule này **bền vững** (persist, không mất qua turn). Rule có **priority** (`critical`/`high`): rule critical/high được **pin vào system prompt frozen** (phần prompt cố định, agent luôn thấy, không bị compact mất). Rule `low`/`medium` chỉ inject khi tool active (tiết kiệm context). `ToolPolicy` đánh giá trên **hot path** trước mỗi `execute()` (allow/deny gate). Nguyên tắc: **rule theo tool** (rule Shell ≠ rule File), **priority quyết định vis** (critical pin frozen, low inject-on-demand). Khác **EJ Agent-Personalization** (prefer user toàn cục) — SW là **rule tool-scoped**; khác memory thuần — SW **pin vào frozen prompt**.

## Mô tả

mya tool-scoped memory rules: (1) **Rule store**: rule gắn theo tool name (Shell: "luôn confirm rm -rf"; File: "không ghi ngoài src/"). (2) **Priority**: critical/high/medium/low. (3) **Frozen pin**: rule critical/high → inject vào **system prompt frozen** (luôn có, compact-proof). (4) **On-demand inject**: rule low/medium → inject chỉ khi tool active (tiết kiệm token). (5) **Policy gate**: `ToolPolicy` check rule trước execute (violate → deny). mya có memory + tool system — SW thêm **tool-scoped rule store** + **frozen-prompt pin** + **priority injector**.

## Kiến trúc

```
  RULES (per tool, durable):
  Shell:  [critical] "confirm rm -rf trước khi chạy"
          [medium]  "ưu tiên nix-shell"
  File:   [high]    "không ghi ngoài src/"
          [low]     "format theo prettier"
        │
        ▼
  ┌─── PRIORITY ROUTER ──────────────────────────────────┐
  │  critical/high → PIN vào system prompt FROZEN         │
  │    (luôn thấy, compact-proof, agent không quên)        │
  │  medium/low    → inject khi tool ACTIVE (on-demand)    │
  └───────────────────────┬─────────────────────────────┘
                          │
  ┌─── SYSTEM PROMPT FROZEN ─────────────────────────────┐
  │  [pinned] Shell/critical: confirm rm -rf               │
  │  [pinned] File/high: không ghi ngoài src/              │
  │  … (luôn có, không bị compact mất)                     │
  └───────────────────────┬─────────────────────────────┘
                          │ (tool active → policy gate)
                          ▼
  ┌─── ToolPolicy (hot path, before execute) ────────────┐
  │  agent gọi rm -rf → check Shell/critical → DENY        │
  │  (rule vi phạm → block + gợi ý confirm)                │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory brain-store — durable store (nền — SW rule persist)
// ✅ tool system + meta — tool name/scope (nền — SW rule theo tool)
// ✅ system prompt assembly — prompt build (nền — SW pin frozen)

// ❌ THIẾU: tool-scoped rule store (rule gắn tool name + priority)
// ❌ THIẾU: frozen-prompt pin (critical/high → compact-proof section)
// ❌ THIẾU: on-demand injector (low/medium → inject khi tool active)
// ❌ THIẾU: policy gate (check rule before execute → deny if violate)
```

## Implementation

```typescript
// packages/agent/src/tool-scoped-rules.ts (MỚI)
type Priority = 'critical' | 'high' | 'medium' | 'low';
interface ToolRule { tool: string; text: string; priority: Priority }

class ToolScopedRules {
  private rules: ToolRule[] = [];
  private frozenPins: string[] = []; // critical/high → frozen prompt

  // add durable rule (persist)
  add(rule: ToolRule): void {
    this.rules.push(rule);
    if (rule.priority === 'critical' || rule.priority === 'high') {
      this.frozenPins.push(`[${rule.tool}/${rule.priority}] ${rule.text}`);
    }
  }

  // frozen section (compact-proof — always in system prompt)
  frozen(): string[] { return [...this.frozenPins]; }

  // on-demand: inject medium/low rules when tool active
  activeFor(tool: string): string[] {
    return this.rules
      .filter(r => r.tool === tool && (r.priority === 'medium' || r.priority === 'low'))
      .map(r => `[${r.tool}/${r.priority}] ${r.text}`);
  }

  // policy gate: check before execute → allow/deny
  check(tool: string, args: unknown, evaluate: (rule: ToolRule, args: unknown) => boolean): { allow: boolean; violated?: ToolRule } {
    for (const r of this.rules.filter(r => r.tool === tool)) {
      if (r.priority === 'critical' || r.priority === 'high') {
        if (!evaluate(r, args)) return { allow: false, violated: r };
      }
    }
    return { allow: true };
  }
}

// Usage:
// rules.add({ tool:'shell', text:'confirm rm -rf first', priority:'critical' });
// systemPrompt.frozen = rules.frozen();   // always present, compact-proof
// const gate = rules.check('shell', cmd, evalRule); // hot path before execute
// if (!gate.allow) → deny + hint
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rule bền vững theo tool (không quên qua turn) | ❌ Frozen prompt phình (nhiều critical → dài) |
| ✅ Critical/high compact-proof (luôn thấy) | ❌ Rule xung đột (2 rule critical trái chiều) |
| ✅ On-demand tiết kiệm token (low chỉ khi active) | ❌ Policy gate overhead (check mỗi execute) |
| ✅ Policy gate enforce (violate → deny) | ❌ Rule drift (tool đổi behavior → rule stale) |

## Khác các hướng gần

| | EJ Agent-Personalization | Memory thuần | SW: Tool-Scoped-Rules |
|---|---|---|---|
| Cái gì | Prefer user toàn cục | Fact tự do | **Rule gắn tool + priority** |
| Vis | Luôn | Retrieval | **Frozen pin (crit) / on-demand** |
| Enforce | ❌ | ❌ | **✅ policy gate deny** |

## Khi nào chọn

- Rule/tool constraint quan trọng (safety: rm -rf, ghi ngoài src/) cần bền vững
- Muốn rule critical không bị compact mất (frozen pin)
- Cần enforce (violate → deny, không chỉ gợi ý)
- Nối packages/memory brain-store + tool system + system prompt assembly; guard frozen-prompt size (cap critical count), rule conflict detection (2 rule trái chiều → warn), và rule freshness (tool đổi → review rule); SW = tool-scoped durable rules, kết hợp EJ Agent-Personalization (prefer user) + memory (fact)
