# Hướng NJ: Conditional Rule Loading — rules frontmatter glob-scope, MANDATORY token-budgeted

> **Nguồn gốc:** pi-soly (rules engine); "conditional context loading"; "frontmatter-scoped rules" (markdown YAML); "system prompt injection"; "glob matching"; "token budget allocation" (44); "linting rules" (.eslintrc); "policy as code"
> **Coupling:** 🟡 — thêm rule loader vào system prompt pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (system prompt injection sẵn — chưa có glob-scoped rule loader)
> **Effort:** 2 tuần

## Nguồn gốc

**Linting rules** (.eslintrc, biome.json): rules apply có điều kiện (per file glob, per env). pi-soly áp dụng cho **LLM behavior**: rules là markdown với frontmatter YAML — `glob: "src/**/*.test.ts"` → rule chỉ load khi prompt đề cập file test. `always: true` → load mỗi turn. Rules inject vào `## ⚠️ MANDATORY` block trong system prompt: *"These rules are NON-NEGOTIABLE. If a rule contradicts your instinct, the rule wins."* **Token-budgeted**: total rules ≤ budget (VD 2000 tokens), overflow → truncate hoặc bỏ rules lower-priority. Giống **100 prompt-compression** (giảm token) nhưng cho **rules** (không phải conversation). Khác **332 policy-enforcement** (runtime rule check) — NJ là **prompt injection** (rule trong context, LLM tự tuân thủ).

## Mô tả

mya conditional rule loading: (1) rules = markdown files (`.agents/rules/`) với frontmatter `{glob?, always?, priority}`; (2) mỗi turn, rule loader: match glob vs prompt content (file paths mentioned) → chọn rules relevant; (3) inject vào MANDATORY block, token-budgeted (total ≤ budget); (4) built-in rules (soly/*) priority cao nhất — user rules không override. `/rules` command: toggle, disable, show token breakdown. `/why`: show rules grounded last turn. Nối 373 plan-branch (STATE.md + rules inject cùng turn) + 44 cost-budget.

## Kiến trúc

```
  RULES (.agents/rules/):
  ┌──────────────────────────────────────────────┐
  │ temp-files.md         always: true  pri: 100 │
  │ release-discipline.md glob: "package.json"   │
  │ test-conventions.md   glob: "**/*.test.ts"   │
  │ security-checklist.md glob: "src/**/*.ts"    │
  └──────────────────────────────────────────────┘
        │
        │  User prompt: "Add tests for src/api/handler.ts"
        │
        ▼
  ┌─── RULE LOADER (per turn) ──────────────────────┐
  │                                                  │
  │  1. SCAN prompt for file paths:                  │
  │     → src/api/handler.ts, *.test.ts mentioned    │
  │                                                  │
  │  2. MATCH globs:                                 │
  │     temp-files.md       ✅ (always)              │
  │     test-conventions.md ✅ (glob *.test.ts)      │
  │     security-checklist ✅ (glob src/**/*.ts)     │
  │     release-discipline ❌ (no package.json)      │
  │                                                  │
  │  3. TOKEN BUDGET (total ≤ 2000 tokens):          │
  │     sort by priority → fit in budget             │
  │     overflow → drop lowest priority              │
  │                                                  │
  │  4. INJECT into system prompt:                   │
  │  ## ⚠️ MANDATORY: soly project rules             │
  │  **These rules are NON-NEGOTIABLE…**             │
  │  ### [soly] temp-files.md …                      │
  │  ### test-conventions.md …                       │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 373 plan-as-branch-workflow — STATE.md + system prompt injection (nền)
// ✅ 44 cost-budget — token budgeting (nền — NJ applies to rules)
// ✅ 100 prompt-compression — token reduction (nền)
// ✅ 332 policy-enforcement — runtime rules (nền — NJ = prompt-level)
// ✅ system prompt construction — sẵn

// ❌ THIẾU: rule loader (glob matching vs prompt content)
// ❌ THIẾU: frontmatter parsing (YAML: glob, always, priority)
// ❌ THIẾU: token-budget allocation (fit rules ≤ budget)
// ❌ THIẾU: MANDATORY block injection (non-negotiable rules)
// ❌ THIẾU: /rules + /why commands (toggle, token breakdown)
```

## Implementation

```typescript
// packages/agent/src/rule-loader.ts (NEW)
import { minimatch } from 'minimatch';

interface Rule {
  name: string;
  content: string;
  glob?: string;       // match against file paths in prompt
  always?: boolean;    // load every turn
  priority: number;    // higher = wins budget
  sourceLabel: string; // 'soly' (built-in) | 'user'
}

class ConditionalRuleLoader {
  constructor(
    private rules: Rule[],
    private tokenBudget: number = 2000,
  ) {}

  // Load rules for this turn — match glob, fit budget
  loadForPrompt(userPrompt: string): { rules: Rule[]; totalTokens: number; dropped: Rule[] } {
    // 1. Extract file paths from prompt
    const filePaths = this.extractPaths(userPrompt);

    // 2. Match: always:true OR glob matches any mentioned path
    const matched = this.rules.filter((rule) => {
      if (rule.always) return true;
      if (rule.glob) return filePaths.some((p) => minimatch(p, rule.glob!));
      return false; // no glob + no always → never auto-load
    });

    // 3. Sort by priority (built-in soly > user), then fit token budget
    const sorted = matched.sort((a, b) => {
      if (a.sourceLabel === 'soly' && b.sourceLabel !== 'soly') return -1;
      if (a.sourceLabel !== 'soly' && b.sourceLabel === 'soly') return 1;
      return b.priority - a.priority;
    });

    const selected: Rule[] = [];
    const dropped: Rule[] = [];
    let tokens = 0;
    for (const rule of sorted) {
      const ruleTokens = this.estimateTokens(rule.content);
      if (tokens + ruleTokens <= this.tokenBudget) {
        selected.push(rule);
        tokens += ruleTokens;
      } else {
        dropped.push(rule);
      }
    }

    return { rules: selected, totalTokens: tokens, dropped };
  }

  // Build MANDATORY block for system prompt
  buildMandatoryBlock(rules: Rule[]): string {
    const body = rules.map((r) => `### [${r.sourceLabel}] ${r.name}\n${r.content}`).join('\n\n');
    return [
      '## ⚠️ MANDATORY: project rules',
      '',
      '**These rules are NON-NEGOTIABLE. If a rule contradicts your instinct, the rule wins.**',
      '',
      body,
    ].join('\n');
  }

  private extractPaths(prompt: string): string[] {
    // match file-path-like strings: src/foo/bar.ts, *.test.ts, etc.
    const matches = prompt.match(/[\w./-]+\.\w+/g);
    return matches ?? [];
  }
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4); // ~4 chars per token
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rules context-aware (chỉ load relevant, tiết kiệm token) | ❌ Glob matching false positive/negative |
| ✅ MANDATORY → LLM tuân thủ rule (non-negotiable) | ❌ Token budget overflow (rules bị drop) |
| ✅ Built-in rules priority cao nhất (user không override) | ❌ LLM có thể vẫn ignore rules (no runtime enforcement) |
| ✅ Token breakdown visible (`/rules`, `/why`) | ❌ Rule maintenance (stale rules accumulate) |

## Khác các hướng gần

| | 332 Policy-Enforcement | 100 Prompt-Compression | 373 Plan-Branch | NJ: Conditional-Rules |
|---|---|---|---|---|
| Mục | Runtime rule check | Reduce tokens | Workflow state | **Inject rules vào prompt** |
| Khi | Runtime | Pre-send | Each turn | **Each turn (glob-scoped)** |
| Budget | ❌ | ✅ | ❌ | **Token-budgeted rules** |

## Khi nào chọn

- Nhiều rules (project conventions, security, temp-files) → chỉ load relevant
- Muốn force LLM tuân thủ (MANDATORY block, non-negotiable)
- Cần token budget (rules không overflow context)
- Nối 373 plan-branch (rules + STATE.md inject cùng turn) + 332 policy-enforcement (runtime + prompt = defense-in-depth)
