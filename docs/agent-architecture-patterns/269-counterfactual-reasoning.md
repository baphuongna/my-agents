# Hướng JI: Counterfactual Reasoning — suy luận "nếu không X thì sao"

> **Nguồn gốc:** Pearl "Causality" (2009); Lewis "Counterfactuals" (1973); "Counterfactual Thinking in LLMs"; "What-If" analysis; causal inference; "regret" in RL
> **Coupling:** 🟡 — chạm planning + reasoning pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (104 task-decomp + planning sẵn — thiếu counterfactual simulator)
> **Effort:** 3-4 tuần

## Nguồn gốc

Counterfactual reasoning: **"nếu không làm X thì kết quả khác thế nào?"** — suy luận về nhân quả, không chỉ tương quan. Pearl "Causality" (2009): do-calculus — formal framework cho intervention ("do(X)"). Lewis (1973): counterfactual logic — "nếu A khác thì B khác?" LLM counterfactual: "Counterfactual Thinking in LLMs" — model reason về alternative scenarios. What-If analysis: explore decision space — thử từng branch, so sánh outcome. RL "regret": so sánh action đã chọn vs best alternative. Cốt lõi: **simulate alternative** — không chỉ plan forward, mà reason "tại sao không chọn khác?" → học, debug, improve decision.

## Mô tả

mya counterfactual: sau khi agent chọn action → hỏi "nếu chọn alternative thì sao?" — (1) generate counterfactual scenario (LLM), (2) simulate outcome (symbolic JG 267 hoặc rerun), (3) compare → regret analysis → learn. Hoặc pre-decision: explore branches trước chọn (what-if tree). Nối 104 task-decomposition: counterfactual = explore subtask alternative. Nối JG (267) neuro-symbolic: symbolic simulate counterfactual. Nối 118 error-analysis: "nếu không sai bước X thì kết quả sao?" → root cause.

## Kiến trúc

```
  DECISION POINT: agent chọn action A
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  COUNTERFACTUAL EXPLORER                              │
  │                                                      │
  │  Actual:      do(A) → outcome_A (observed)           │
  │                                                      │
  │  Counterfactuals (Pearl do-calculus):                │
  │    do(B) → simulate → outcome_B  (LLM + symbolic)    │
  │    do(C) → simulate → outcome_C                      │
  │    do(¬A) → "what if did nothing?" → outcome_¬A      │
  └──────────────────┬───────────────────────────────────┘
                     │ compare outcomes
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  REGRET / CAUSAL ANALYSIS                            │
  │                                                      │
  │  outcome_A vs outcome_B vs outcome_C                 │
  │    → was A optimal? (regret = best - actual)         │
  │    → causal: did A cause outcome_A? (Pearl)          │
  │    → lesson: next time prefer B if outcome_B > A     │
  └──────────────────┬───────────────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  LEARN (update decision policy / memory)             │
  │  · 118 error-analysis: root cause via counterfactual │
  │  · 112 learning-from-corrections: store lesson       │
  └──────────────────────────────────────────────────────┘
```

```
mya: 104 task-decomp + planning sẵn — thiếu: counterfactual simulator + regret scoring + causal memory
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 104 task-decomposition — planning (documented)
// ✅ 118 error-analysis — root cause (documented)
// ✅ 112 learning-from-corrections — store lessons (documented)
// ✅ JG (267) neuro-symbolic — symbolic simulate (documented)

// ❌ THIẾU: counterfactual generator (alternative scenarios)
// ❌ THIẾU: outcome simulator (rerun with different action)
// ❌ THIẾU: regret scoring (best - actual)
// ❌ THIẾU: causal memory (store counterfactual lessons)
```

## Implementation

```typescript
// packages/reason/src/counterfactual.ts (NEW)
interface Scenario { action: string; outcome: number; rationale: string; }

export class CounterfactualReasoner {
  constructor(private model: ModelProvider, private simulator: (a: string) => Promise<number>) {}

  // Post-decision: "what if chose alternative?"
  async analyze(actual: Scenario, alternatives: string[]): Promise<CounterfactualReport> {
    const scenarios: Scenario[] = [actual];
    for (const alt of alternatives) {
      // Generate counterfactual + simulate outcome
      const rationale = await this.model.generate(
        `If instead of "${actual.action}", agent did "${alt}", what happens?`
      );
      const outcome = await this.simulator(alt); // rerun with alt (JG 267 symbolic)
      scenarios.push({ action: alt, outcome, rationale });
    }
    const best = Math.max(...scenarios.map((s) => s.outcome));
    const regret = best - actual.outcome; // Pearl-style regret
    return { scenarios, best, regret, optimal: actual.outcome === best };
  }

  // Pre-decision: explore branches before choosing (what-if tree)
  async whatIf(task: string, actions: string[]): Promise<Scenario[]> {
    const explored: Scenario[] = [];
    for (const a of actions) {
      const outcome = await this.simulator(a);
      explored.push({ action: a, outcome, rationale: "" });
    }
    explored.sort((x, y) => y.outcome - x.outcome);
    return explored; // pick best → reduce future regret
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hiểu nhân quả (Pearl — không chỉ tương quan) | ❌ Simulation cost (rerun each alternative) |
| ✅ Regret analysis — học từ quyết định kém | ❌ LLM counterfactual hallucination (JE 265) |
| ✅ What-if explore — giảm regret trước chọn | ❌ Causal inference hard (confounders) |
| ✅ Root cause (118 — "nếu không X?") | ❌ Counterfactual ≠ reality (sim approximation) |

## Khác các hướng gần

| | 104 Task-Decomp | JG (267) Neuro-Symbolic | JI: Counterfactual |
|---|---|---|---|
| Mục | Chia task | Verify rule | **Explore alternative ("what-if")** |
| Hướng | Forward plan | Verify propose | **Branch + compare** |
| Learn | ❌ | ❌ | ✅ regret → lesson |

## Khi nào chọn

- Cần hiểu nhân quả (Pearl — không chỉ "what happened")
- Decision high-stakes — explore alternative trước chọn
- Post-mortem / error-analysis (118) — "nếu không sai X?"
- Nối 104 decomp + 118 error-analysis + 112 corrections + JG (267) symbolic
