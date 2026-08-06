# Hướng WK: Prompt Template Arg Grammar — template markdown + /name trigger; $1/$@/${1:-default} cú pháp slice; argument-hint tự điền vào completion

> **Nguồn gốc:** pi `prompt template` (markdown template + `/name` slash trigger; argument grammar `$1`, `$@`, `${1:-default}` slice syntax; argument-hint auto-fill vào completion) | **Coupling:** 🟢 — thêm template engine + slash-trigger + arg parser vào prompt/skill system | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (prompts + skills sẵn — chưa có template arg-grammar + slash-trigger + completion hint) | **Effort:** 2 tuần

## Nguồn gốc

**pi** prompt template là markdown có **placeholder** — user gõ `/templatename args` để trigger. Argument grammar: (1) **`$1`** — positional arg thứ 1 (vd `$1` = first arg). (2) **`$@`** — tất cả args join (vd `$@` = "arg1 arg2 arg3"). (3) **`${1:-default}`** — positional với default nếu thiếu (slice syntax). Khi user gõ `/`, **completion** hiện template list; chọn template → **argument-hint** tự điền (vd hint `/$1/$2` → user biết cần 2 args). Nguyên tắc: **markdown template + positional arg grammar + completion-guided**.

## Mô tả

mya prompt template arg grammar: (1) **Template store**: markdown template với placeholder (`$1`, `$@`, `${1:-default}`). (2) **Slash-trigger**: user gõ `/name args` → lookup template → parse args → substitute placeholder. (3) **Arg grammar**: `$1` = positional[0], `$@` = all joined, `${1:-def}` = positional[0] ?? default. (4) **Completion hint**: gõ `/` → list template; hint placeholder → user biết cần bao nhiêu args. mya có prompts + skills — WK thêm **template engine** + **arg parser** + **slash-trigger completion**.

## Kiến trúc

```
  TEMPLATE (markdown + placeholder):
  ┌─ review.md ──────────────────────────────────────────┐
  │  Review the file ${1:-src/index.ts} focusing on $@.   │
  │  Check for: $2.                                       │
  │  Priority: ${3:-medium}.                              │
  └───────────────────────────────────────────────────────┘

  USER TYPES: /review auth.ts security high
        │
        ▼
  ┌─── SLASH-TRIGGER + ARG PARSE ─────────────────────────┐
  │  name = "review"                                      │
  │  args = ["auth.ts", "security", "high"]               │
  │  positional: { 1:"auth.ts", 2:"security", 3:"high" }  │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── PLACEHOLDER SUBSTITUTE ────────────────────────────┐
  │  ${1:-src/index.ts} → "auth.ts" (arg 1 = auth.ts)     │
  │  $@ → "security high" (all args join)                 │
  │  $2 → "security"                                      │
  │  ${3:-medium} → "high" (arg 3 = high)                 │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── COMPLETION HINT (khi gõ /) ────────────────────────┐
  │  /review → hint: "/review <file> <focus> <priority>"  │
  │  → user biết cần 3 args                               │
  └────────────────────────────────────────────────────────┘

  RESULT: "Review the file auth.ts focusing on security high.
           Check for: security. Priority: high."
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts — prompt system (nền — WK template ở đây)
// ✅ packages/skills skill.ts — skill/template (nền — WK slash-trigger analog)
// ✅ packages/tui autocomplete — completion (nền — WK /-completion hint)

// ❌ THIẾU: template arg-grammar ($1, $@, ${1:-default})
// ❌ THIẾU: slash-trigger parser (/name args → template + args)
// ❌ THIẾU: placeholder substituter
// ❌ THIẾU: argument-hint completion (gõ / → hint placeholder)
```

## Implementation

```typescript
// packages/prompts/src/template-arg-grammar.ts (MỚI)
interface PromptTemplate { name: string; body: string; hint: string }

// parse "/name arg1 arg2" → { name, args[] }
function parseSlash(input: string): { name: string; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const [name, ...args] = input.slice(1).split(/\s+/);
  return { name: name!, args };
}

// substitute $1, $@, ${1:-default} trong template body
function substitute(body: string, args: string[]): string {
  const all = args.join(" ");
  return body
    .replace(/\$\{(\d+):-([^}]*)\}/g, (_, n, def) => args[Number(n) - 1] ?? def) // ${1:-default}
    .replace(/\$(\d+)/g, (_, n) => args[Number(n) - 1] ?? "")                     // $1, $2
    .replace(/\$@/g, all);                                                        // $@ all
}

// extract hint from placeholder (for completion)
function extractHint(body: string): string {
  const placeholders = [...body.matchAll(/\$\{?(\d+|@)(?::-([^}]*))?\}?/g)];
  return placeholders.map(m => `<${m[2] ?? `arg${m[1]}`}>`).join(" ");
}

// Usage:
// const tpl: PromptTemplate = { name: "review", body: "Review ${1:-src/index.ts} focus $@.", hint: "" };
// tpl.hint = extractHint(tpl.body); // "<src/index.ts> <arg@>"
// const { name, args } = parseSlash("/review auth.ts security")!;
// const rendered = substitute(tpl.body, args); // "Review auth.ts focus security."
```

## Được

- ✅ Reusable prompt (template + args — không retyping)
- ✅ Completion-guided (hint → user biết cần args nào)
- ✅ Flexible grammar ($1 positional, $@ all, ${1:-default} fallback)
- ✅ Markdown-native (template là markdown — familiar)

## Mất

- ❌ Grammar complexity (quá nhiều placeholder → template khó đọc)
- ❌ Arg ambiguity (sai số args → substitute sai/trống)
- ❌ Hint drift (placeholder thay → hint phải regenerate)
- ❌ Escape edge case (`$` literal trong markdown → conflict)

## Khác

Khác **static prompt** (prompt cố định, không args) — WK **parameterized template** (args substitute). Khác **skill trigger** (skill = tool + content) — WK **prompt-only** (template → rendered text, không tool). Khác **80 context-engineering** (general prompt design) — WK **template grammar** (positional arg substitution specifically).

## Khi nào chọn

- Prompt lặp lại với tham số (review file X, deploy env Y) → template tiết kiệm
- Muốn completion-guided (user gõ / → hint → biết args)
- Cần default value (arg thiếu → default, không trống)
- Nối packages/prompts + packages/skills skill.ts + packages/tui autocomplete; guard hint-sync (hint = placeholder — regenerate khi body thay), arg-count-validation (thiếu args → default hoặc error rõ), và escape-handling (`$` literal — escape `\$`); WK = prompt template arg grammar, kết hợp WJ skill-description-only-discovery (template as skill) + 80 context-engineering (prompt design)
