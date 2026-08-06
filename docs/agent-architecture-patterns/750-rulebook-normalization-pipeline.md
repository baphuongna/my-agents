# Hướng ABV: Rulebook Normalization Pipeline — quy tắc từ nhiều format (native .gjc, cursor .mdc, windsurf, cline) normalize về Rule shape duy nhất, precedence theo tên + provider priority

> **Nguồn gốc:** gajae-code (docs/rulebook-matching-pipeline.md) | **Coupling:** 🟡 — thêm rule parser + normalizer vào prompt/skills layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill frontmatter + prompt assembler — chưa có rule normalization) | **Effort:** 2 tuần

## Nguồn gốc

**gajae-code** nhận **quy tắc từ nhiều format**: native `.gjc`, **cursor `.mdc`**, **windsurf** (`.windsurfrules`), **cline** (`.clinerules`) — rồi **normalize tất cả về một Rule shape duy nhất**. Sau đó: (1) **precedence theo tên** — rule trùng tên → rule có precedence cao hơn thắng; (2) **provider priority** — provider nào được ưu tiên hơn (VD native > cursor > windsurf > cline) quyết định khi xung đột; (3) **tách thành hai loại**: **rulebook rules** — đi vào **system prompt** + `rule://` (load khi cần), và **TTSR interrupt rules** — rule **interrupt** (kích hoạt khi pattern match trong lúc agent chạy). Nguyên tắc: **mọi format → 1 Rule shape, precedence giải xung đột (tên + provider), tách system-prompt rules vs interrupt rules**.

## Mô tả

mya rulebook normalization pipeline: (1) **parsers** — parse `.gjc` / `.mdc` / windsurf / cline về **Rule shape** chung `{ name, description, body, source, priority }`; (2) **precedence** — trùng tên → provider priority (native > cursor > windsurf > cline); (3) **split** — rulebook rules (vào system prompt + `rule://` progressive load) vs **TTSR interrupt rules** (match pattern → trigger hành vi). mya có packages/skills skill.ts (frontmatter normalize) + packages/prompts assembler.ts (system prompt) — ABV thêm **rule parsers** (nhiều format) + **precedence resolution** + **rule/TTSR split**.

## Kiến trúc

```
  RULE SOURCES (nhiều format)
  ├─ native  .gjc        ─┐
  ├─ cursor  .mdc        ─┤
  ├─ windsurf .windsurfrules ─┤  PARSE → Rule shape duy nhất
  └─ cline   .clinerules ─┘     { name, description, body, source, priority }
       │
       ▼
  PRECEDENCE RESOLUTION
    trùng tên → provider priority: native > cursor > windsurf > cline
    (rule thắng giữ, rule thua bỏ hoặc ghi conflict)
       │
       ▼
  SPLIT
  ├─ RULEBOOK RULES ──► system prompt + rule:// (progressive load)
  └─ TTSR INTERRUPT RULES ──► pattern match → interrupt agent khi khớp
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SKILL.md frontmatter normalize (nền — ABV Rule shape analog)
// ✅ packages/prompts assembler.ts — assemblePrompt/system prompt (nền — ABV rulebook target)
// ✅ packages/prompts compress.ts — prompt compression (nền — ABV progressive load analog)
// ✅ packages/core session-utils.ts — steer/delivery modes (liên quan — ABV interrupt delivery)

// ❌ THIẾU: rule parsers (.gjc / .mdc / windsurf / cline → Rule)
// ❌ THIẾU: precedence resolution (tên + provider priority)
// ❌ THIẾU: rulebook vs TTSR interrupt split
```

## Implementation

```typescript
// packages/skills/src/rulebook.ts (MỚI)

export interface Rule {
  name: string;
  description: string;
  body: string;
  source: "native" | "cursor" | "windsurf" | "cline";
  /** Interrupt rule: pattern → trigger khi agent đang chạy. */
  interruptPattern?: RegExp;
}

const PROVIDER_PRIORITY: Record<Rule["source"], number> = {
  native: 4, cursor: 3, windsurf: 2, cline: 1,
};

/** Parse từng format → Rule shape duy nhất. */
export function parseRule(source: Rule["source"], raw: string): Rule[] {
  const rules: Rule[] = [];
  for (const block of raw.split(/^---$/m)) {
    const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? `rule-${rules.length}`;
    const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const body = block.replace(/^name:.*$/m, "").replace(/^description:.*$/m, "").trim();
    const interruptPattern = block.match(/^trigger:\s*\/(.+)\/$/m)?.[1];
    rules.push({ name, description, body, source, interruptPattern: interruptPattern ? new RegExp(interruptPattern) : undefined });
  }
  return rules;
}

/** Precedence: trùng tên → provider priority thắng; tách rulebook vs interrupt. */
export function normalizeRulebook(all: Rule[]): { rulebook: Rule[]; interrupts: Rule[] } {
  const byName = new Map<string, Rule>();
  for (const rule of all) {
    const existing = byName.get(rule.name);
    if (!existing || PROVIDER_PRIORITY[rule.source] > PROVIDER_PRIORITY[existing.source]) {
      byName.set(rule.name, rule); // provider priority thắng
    }
  }
  const unique = [...byName.values()];
  return {
    rulebook: unique.filter(r => !r.interruptPattern),           // → system prompt + rule://
    interrupts: unique.filter(r => r.interruptPattern),          // → TTSR trigger
  };
}

// Usage:
// const gjc = parseRule("native", readFile(".gjc"));
// const mdc = parseRule("cursor", readFile("**/*.mdc"));
// const { rulebook, interrupts } = normalizeRulebook([...gjc, ...mdc]);
// assemblePrompt(rulebook);           // rulebook → system prompt
// registerInterrupts(interrupts);     // TTSR → trigger khi pattern khớp
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một shape cho mọi format (không code riêng từng loại) | ❌ Parser per format (format mới → thêm parser) |
| ✅ Precedence rõ (tên + provider priority — xung đột giải được) | ❌ Priority opinionated (native > cursor có thể không đúng mọi nơi) |
| ✅ Tách rulebook/interrupt (system prompt ổn định, interrupt động) | ❌ Interrupt regex (pattern quá rộng → trigger sai) |
| ✅ Progressive load (rule:// — không nhét hết vào prompt) | ❌ Duplicate rules (nhiều source trùng ý — phải resolve) |

## Khác các hướng gần

| | Chỉ dùng 1 format | Nhét hết rules vào prompt | ABV: Normalization Pipeline |
|---|---|---|---|
| Format | 1 | 1 | **nhiều (.gjc/.mdc/windsurf/cline)** |
| Xung đột | — | lẫn lộn | **precedence (tên + provider)** |
| Prompt size | nhỏ | phình | **rulebook + rule:// progressive** |
| Interrupt | — | — | **TTSR tách riêng** |

## Khi nào chọn

- Dự án có rules từ nhiều nguồn (cursor rules, cline rules, native rules) — cần gộp
- Muốn precedence rõ ràng khi rule trùng tên/xung đột
- Muốn tách rule tĩnh (system prompt) vs rule động (interrupt)
- Nối packages/skills skill.ts + packages/prompts assembler.ts + compress.ts; guard precedence-transparency (conflict phải ghi log — không im lặng), interrupt-width (regex interrupt hẹp — không trigger mù), và prompt-budget (rulebook không vượt budget — progressive rule:// load); ABV = rulebook normalization pipeline, kết hợp 636 XL skill-frontmatter-portability (frontmatter portability — rule cũng portable) + 747 ABS (skills/ output từ memory cũng normalize về Rule shape)
