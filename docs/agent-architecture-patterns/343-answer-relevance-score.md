# Hướng ME: Answer Relevance Score — metric đánh giá output relevant + faithful

> **Nguồn gốc:** RAGAS (RAG Assessment); "faithfulness score"; "answer relevance"; "context relevance"; "groundedness metric"; TruLens; DeepEval; "LLM-as-judge" evaluation
> **Coupling:** 🟢 — thêm metric calculator (read-only)
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (eval framework sẵn — chưa có relevance/faithfulness metric)
> **Effort:** 1-2 tuần

## Nguồn gốc

**RAGAS** (RAG Assessment framework): metric đánh giá RAG — **faithfulness** (output có dựa context không — hallucination), **answer relevance** (output trả đúng câu hỏi không), **context relevance** (context retrieved có liên quan không). **TruLens / DeepEval**: tương tự — LLM-as-judge đánh chất lượng. **Groundedness**: mỗi claim trong output phải traceable đến source. Nguyên tắc: **đo chất lượng output** — không chỉ "có trả lời" mà "trả lời đúng + có bằng chứng". Nối 342 quality-pipeline — ME là **metric** cho grounding gate.

## Mô tả

mya answer relevance score: sau khi agent trả output, tính 3 metric: **faithfulness** (output ← context, không hallucination), **answer relevance** (output ↔ query, đúng trọng tâm), **context relevance** (context ↔ query, retrieve đúng). Metric dùng LLM-as-judge hoặc NLI (Natural Language Inference). Score thấp → gate fail (342) → retry/degrade. Nối 333 data-versioning — metric tracked qua dataset version. Nối 335 flywheel — metric cải thiện theo thời gian.

## Kiến trúc

```
  QUERY ──► AGENT ──► OUTPUT
              │
              ▼ (context retrieved)
  ┌─── RELEVANCE SCORING (RAGAS-style) ──────┐
  │                                          │
  │  1. FAITHFULNESS: output ← context        │
  │     · mỗi claim → trace to source?        │
  │     · 3/5 claim grounded → 0.60           │
  │                                          │
  │  2. ANSWER RELEVANCE: output ↔ query      │
  │     · output trả đúng câu hỏi?            │
  │     · score 0.85                          │
  │                                          │
  │  3. CONTEXT RELEVANCE: context ↔ query    │
  │     · retrieved context liên quan?        │
  │     · score 0.72                          │
  │         │                                │
  │    COMPOSITE: 0.72                        │
  │         │                                │
  │    score < 0.7? → FAIL (342 gate) → retry │
  │    score ≥ 0.7? → PASS                    │
  └──────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 342 MD output-quality-pipeline — gate chain (ME là grounding metric)
// ✅ 286 chain-of-verification — self-verify (nền)
// ✅ 333 LU data-versioning — track metric per version
// ✅ 335 LW feedback-flywheel — metric cải thiện theo thời gian
// ✅ 299 regression-gates-CI — eval gate (nền)

// ❌ THIẾU: faithfulness metric (claim → source trace)
// ❌ THIẾU: answer relevance metric (output ↔ query)
// ❌ THIẾU: context relevance metric (context ↔ query)
// ❌ THIẾU: LLM-as-judge scoring (hoặc NLI model)
```

## Implementation

```typescript
// packages/eval/src/relevance.ts (NEW)
interface RelevanceScore {
  faithfulness: number;       // 0-1 — output grounded in context
  answerRelevance: number;    // 0-1 — output answers query
  contextRelevance: number;   // 0-1 — context relevant to query
  composite: number;          // weighted average
}

interface ScoringContext {
  query: string;
  output: string;
  context: string[]; // retrieved sources
}

class RelevanceScorer {
  constructor(private judge: LLMJudge, private threshold = 0.7) {}

  async score(ctx: ScoringContext): Promise<RelevanceScore & { passed: boolean }> {
    const faithfulness = await this.scoreFaithfulness(ctx.output, ctx.context);
    const answerRelevance = await this.scoreAnswerRelevance(ctx.query, ctx.output);
    const contextRelevance = await this.scoreContextRelevance(ctx.query, ctx.context);
    const composite = faithfulness * 0.4 + answerRelevance * 0.35 + contextRelevance * 0.25;
    return { faithfulness, answerRelevance, contextRelevance, composite, passed: composite >= this.threshold };
  }

  // Faithfulness — mỗi claim trong output có trace to source?
  private async scoreFaithfulness(output: string, context: string[]): Promise<number> {
    const claims = await this.judge.extractClaims(output); // decompose output → claims
    let grounded = 0;
    for (const claim of claims) {
      const supported = await this.judge.checkEntailment(claim, context.join('\n')); // NLI
      if (supported) grounded++;
    }
    return claims.length > 0 ? grounded / claims.length : 1;
  }

  // Answer relevance — output trả đúng query?
  private async scoreAnswerRelevance(query: string, output: string): Promise<number> {
    return this.judge.score(`Query: ${query}\nOutput: ${output}\nRate relevance 0-1:`);
  }

  // Context relevance — retrieved context liên quan query?
  private async scoreContextRelevance(query: string, context: string[]): Promise<number> {
    const scores = await Promise.all(
      context.map(c => this.judge.score(`Query: ${query}\nContext: ${c}\nRate relevance 0-1:`))
    );
    return Math.max(...scores); // best chunk
  }
}

// Usage: const { passed } = await scorer.score({ query, output, context });
// if (!passed) → retry/degrade (342)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo chất lượng output (RAGAS proven) | ❌ LLM-as-judge cost (API call per claim) |
| ✅ Phát hallucination (faithfulness) | ❌ Judge bias (LLM judge không hoàn hảo) |
| ✅ 3 metric — multi-dimensional view | ❌ Slow (NLI per claim) |
| ✅ Nối 342 gate (metric) + 333 version (track) | ❌ Threshold cần tune (false fail/pass) |

## Khác các hướng gần

| | 286 Chain-of-Verification | 342 Quality Pipeline | ME: Relevance Score |
|---|---|---|---|
| Cái gì | LLM self-verify | Gate chain | **Metric (faith/relev/ground)** |
| LLM-as-judge | ❌ (self) | Depends | ✅ |
| Output | Pass/fail | Pass/retry/block | **Numeric score** |
| Trace | ❌ | ❌ | ✅ claim→source |

## Khi nào chọn

- RAG/agent cần đo chất lượng output (không chỉ pass/fail)
- Muốn phát hallucination (faithfulness)
- Cần metric cho 342 quality gate
- Kết hợp 342 pipeline (gate) + 333 versioning (track metric); cẩn thận judge bias + cost
