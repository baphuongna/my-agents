# Hướng AAO: Strategy Anchor Document — STRATEGY.md chứa target problem, approach, persona, metrics làm durable anchor cho mọi spec

> **Nguồn gốc:** compound-engineering-plugin (README.md) | **Coupling:** 🟢 — thêm document layer, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (markdown + skill model sẵn) | **Effort:** 1 tuần

## Nguồn gốc

**compound-engineering-plugin** lệnh **ce-strategy** tạo **STRATEGY.md** chứa: **target problem** (vấn đề cần giải), **approach** (hướng giải quyết), **persona** (ai dùng/ai review), **metrics** (đo thành công bằng gì). Đây là **durable anchor** — các pha **ideate/brainstorm/plan** đọc nó làm **grounding** để chiến lược **thấm vào từng spec** (không lệch hướng giữa chừng). Nguyên tắc: **một trang chiến lược bền, mọi spec dẫn chiếu** — spec thay đổi nhưng anchor giữ định hướng.

## Mô tả

mya strategy anchor document: packages/skills skill.ts + packages/workflows runner.ts có markdown + workflow nền. AAO thêm **STRATEGY.md contract**: file đặt ở repo root (hoặc `.mya/strategy.md`) với frontmatter chuẩn: `target_problem`, `approach`, `persona`, `metrics` (danh sách đo được). **Grounding hook**: khi agent bắt đầu ideate/brainstorm/plan (nối AAL loop), đọc STRATEGY.md và inject vào system prompt như context anchor; mỗi spec sinh ra phải **dẫn chiếu** section nào của strategy (spec header ghi `strategy_ref: [target_problem|approach|...]`). Eval: metrics trong strategy là tiêu chí chấm spec có đúng hướng không.

## Kiến trúc

```
  STRATEGY.md (durable anchor — repo root)
  ┌────────────────────────────────────────────────────┐
  │  target_problem: "giảm token lãng phí trong loop"   │
  │  approach: "detector + actionable remediation"      │
  │  persona: "power user, agent operator"              │
  │  metrics: ["waste_ratio < 5%", "yield > 60%"]       │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── GROUNDING HOOK ────────────────────────────────┐
  │  ideate/brainstorm/plan (AAL loop)                 │
  │   → inject STRATEGY.md vào prompt (context anchor) │
  │   → spec sinh ra có strategy_ref (section nào)     │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── EVAL ──────────────────────────────────────────┐
  │  metrics trong strategy = tiêu chí chấm spec       │
  │  spec lệch strategy → reject sớm (rẻ)              │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SKILL.md frontmatter model (nền format STRATEGY.md)
// ✅ packages/skills curator.ts — load markdown tree (nền đọc STRATEGY.md)
// ✅ packages/workflows runner.ts — workflow ctx (nơi inject anchor)
// ✅ packages/prompts inject.ts — prompt injection (nơi chèn anchor)
// ✅ packages/eval harness.ts — golden eval (nền chấm theo metrics)

// ❌ THIẾU: STRATEGY.md contract + parser
// ❌ THIẾU: grounding hook (inject vào ideate/brainstorm/plan)
// ❌ THIẾU: strategy_ref validation (spec phải dẫn chiếu)
```

## Implementation

```typescript
// packages/workflows/src/strategy-anchor.ts (NEW)
import { readFileSync } from "node:fs";

export interface Strategy {
  targetProblem: string;
  approach: string;
  persona: string;
  metrics: string[]; // đo được — dùng làm tiêu chí eval
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** Parse STRATEGY.md frontmatter — fail nếu thiếu section bắt buộc. */
export function parseStrategy(markdown: string): Strategy {
  const fm = markdown.match(FRONTMATTER_RE)?.[1];
  if (!fm) throw new Error("STRATEGY.md thiếu frontmatter");
  const get = (k: string): string => fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  const metrics = [...fm.matchAll(/^metrics:\s*\[([^\]]*)\]/m)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
  const s: Strategy = { targetProblem: get("target_problem"), approach: get("approach"), persona: get("persona"), metrics };
  if (!s.targetProblem || !s.approach || !s.persona || !s.metrics.length) {
    throw new Error("STRATEGY.md thiếu target_problem/approach/persona/metrics");
  }
  return s;
}

/** Load anchor + render thành prompt block. */
export function loadStrategyAnchor(path = "STRATEGY.md"): { strategy: Strategy; prompt: string } {
  const strategy = parseStrategy(readFileSync(path, "utf8"));
  const prompt = [
    "# STRATEGY ANCHOR (durable — mọi spec phải khớp)",
    `- Vấn đề: ${strategy.targetProblem}`,
    `- Hướng: ${strategy.approach}`,
    `- Persona: ${strategy.persona}`,
    `- Metrics (tiêu chí thành công): ${strategy.metrics.join("; ")}`,
    "Spec sinh ra phải ghi strategy_ref trỏ vào section đã dùng.",
  ].join("\n");
  return { strategy, prompt };
}

/** Validate spec: có strategy_ref hợp lệ không. */
export function validateSpecAnchor(spec: string, s: Strategy): boolean {
  const ref = spec.match(/^strategy_ref:\s*\[?([^\]]+)\]?/m)?.[1];
  if (!ref) return false;
  return ref.split(/[,\s]+/).some((r) => [s.targetProblem, s.approach, s.persona].includes(r.trim()));
}
// Usage: inject prompt vào brainstorm/plan phase của AAL loop
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Định hướng bền — spec không lệch giữa chừng | ❌ Strategy lỗi thời → anchor sai hướng cả chuỗi |
| ✅ Metrics đo được — eval khách quan | ❌ Frontmatter strict — thiếu section fail sớm |
| ✅ Persona rõ — ai dùng, ai review | ❌ Grounding inject thêm token (prompt dài hơn) |
| ✅ Rẻ — markdown + parser, không đụng runtime | ❌ Phải duy trì strategy_ref trong spec |

## Khác các hướng gần

| | Skill frontmatter | AAO: Strategy Anchor |
|---|---|---|
| Phạm vi | Một skill | **Toàn dự án/chiến dịch** |
| Mục đích | Chỉ dẫn thao tác | **Định hướng + metrics** |
| Grounding | Khi invoke skill | **Mọi ideate/brainstorm/plan** |
| Mối quan hệ | Nền format | **Layer trên (dùng chung format)** |

## Khi nào chọn

- Chiến dịch nhiều spec — cần anchor định hướng chung
- Muốn đo thành công bằng metrics (không chỉ hoàn thành)
- Đã có skill markdown model — thêm STRATEGY.md contract + grounding hook
- Guard: parse strict (fail khi thiếu section), validate strategy_ref, metrics phải đo được
