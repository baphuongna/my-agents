# Hướng JG: Neuro-Symbolic — LLM + logic/rules, suy luận kiểm chứng được

> **Nguồn gốc:** "Neuro-Symbolic AI: An Emerging Class of AI" (IBM); "DeepProbLog"; AlphaGeometry (DeepMind 2024); "LLM+P" (Liu 2023); "Chain-of-Thought meets solver"; Prolog/Datalog hybrid
> **Coupling:** 🟡 — chạm reasoning pipeline + tool (solver)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool call + structured output sẵn — thiếu symbolic solver + verification layer)
> **Effort:** 4-6 tuần

## Nguồn gốc

Neuro-symbolic: kết hợp **neural (LLM — linh hoạt, fuzzy) với symbolic (logic/rules — chính xác, verifiable)**. IBM: "the third wave of AI — systems that learn and reason." AlphaGeometry (DeepMind 2024): LLM sinh intuition + symbolic engine verify proof — giải IMO geometry. LLM+P (Liu 2023): LLM translate problem → PDDL → symbolic planner solve → exact solution. DeepProbLog: neural + probabilistic logic. Cốt lõi: **LLM good at intuition/translation, symbolic good at rigor/verification** — chia vai: LLM propose, rules verify. Giảm hallucination (JE 265): symbolic layer catch logic error LLM bỏ sót.

## Mô tả

mya neuro-symbolic: LLM (neural) sinh hypothesis/action → symbolic layer (rules, constraints, solver) verify trước khi execute. Ví dụ: LLM đề xuất plan → symbolic planner check (dependency, deadlock JH 268) → nếu vi phạm rule → reject/revise. Hoặc: LLM sinh code → SMT solver / type-checker verify → chỉ accept nếu pass. Nối JE (265) hallucination-detection: symbolic = strong verifier. Nối JI (269) counterfactual: symbolic reason about "what-if". Nối 104 task-decomposition: LLM decompose, symbolic verify subtask consistency.

## Kiến trúc

```
  TASK / QUERY
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  NEURAL LAYER (LLM)                                  │
  │  · propose hypothesis / plan / code                  │
  │  · translate natural language → formal (PDDL/logic)  │
  │  · intuition, pattern-match                           │
  └──────────────────┬───────────────────────────────────┘
                     │ candidate solution
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  SYMBOLIC LAYER (rules / solver)                     │
  │  · verify constraints (hard rules)                   │
  │  · check logic (Prolog / SMT / type-check)           │
  │  · plan valid? (PDDL planner)                        │
  │  · proof valid? (AlphaGeometry-style)                │
  └──────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ PASS      │          │ FAIL             │
  │ execute   │          │ → feedback to    │
  │ (verified)│          │   LLM (revise)   │
  └───────────┘          └──────────────────┘
```

```
mya: tool call + structured output sẵn — thiếu: symbolic solver tool + formal translation + verify-reject loop
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool call — LLM can call external solver (sẵn)
// ✅ structured output (Zod) — formal shape (sẵn)
// ✅ JE (265) hallucination-detection — verify layer (documented)
// ✅ 104 task-decomposition — LLM decompose (documented)

// ❌ THIẾU: symbolic solver tool (PDDL / SMT / Prolog)
// ❌ THIẾU: formal translation (NL → logic/PDDL)
// ❌ THIẾU: verify-reject loop (LLM propose → solver reject → revise)
// ❌ THIẾU: rule/constraint knowledge base
```

## Implementation

```typescript
// packages/reason/src/neuro-symbolic.ts (NEW)
import type { Tool } from "@my-agent/core";

// Symbolic verifier tool — checks LLM output against hard rules
export const ruleChecker: Tool = {
  meta: { name: "rule-check", description: "verify plan against symbolic constraints" },
  async run(input: { plan: Step[]; rules: Rule[] }): Promise<ToolResult> {
    const violations: string[] = [];
    for (const rule of input.rules) {
      const ok = evaluate(rule, input.plan); // Datalog/SMT eval
      if (!ok) violations.push(`rule violated: ${rule.id}`);
    }
    if (violations.length > 0) {
      return { ok: false, output: { violations } }; // reject → LLM revises
    }
    return { ok: true, output: { verified: true } }; // pass → execute
  },
};

export class NeuroSymbolicLoop {
  constructor(private model: ModelProvider, private solver: typeof ruleChecker) {}

  async solve(task: string, rules: Rule[]): Promise<Plan> {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Neural: LLM proposes plan
      const plan = await this.model.generate(`Plan for: ${task}\nConstraints: ${JSON.stringify(rules)}`);
      // Symbolic: solver verifies
      const result = await this.solver.run({ plan: parse(plan), rules });
      if (result.ok) return parse(plan); // verified → accept
      // Failed → feedback violations → LLM revises (next attempt)
    }
    throw new Error("no verified solution after 3 attempts");
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Verifiable reasoning (IBM third wave — exact) | ❌ Symbolic solver complexity (PDDL/SMT) |
| ✅ LLM intuition + rule rigor (AlphaGeometry) | ❌ Translation gap (NL → formal lossy) |
| ✅ Giảm hallucination (symbolic catch logic error) | ❌ Slower (LLM + solver round-trip) |
| ✅ Audit-able (rule violations logged) | ❌ Rule base maintenance |

## Khác các hướng gần

| | LLM-only | JE (265) Hallucination | JG: Neuro-Symbolic |
|---|---|---|---|
| Reasoning | Neural (fuzzy) | Decompose + verify | **Neural + symbolic solver** |
| Verify | ❌ | Similarity/sampling | **Hard rule (exact)** |
| Formal | ❌ | ❌ | ✅ PDDL/SMT/Prolog |

## Khi nào chọn

- Task cần exact reasoning (planning, math, logic) — LLM hay sai
- Cần verifiable/audit-able (rule violations logged)
- Có domain rules/constraints (formalisable)
- Nối JE (265) hallucination + JI (269) counterfactual + JH (268) petri-net
