# Hướng MH: Slow-Fast Reasoning — dual-system: fast heuristic + slow deliberate

> **Nguồn gốc:** "Thinking, Fast and Slow" (Daniel Kahneman — System 1 / System 2); "dual-process theory"; Mixture of Depths (MoD); "adaptive compute" / "test-time compute"; "reasoning tier"; "think step-by-step" (Chain-of-Thought); DeepSeek R1 / OpenAI o1 (reasoning models)
> **Coupling:** 🟡 — thêm reasoning tier router vào agent loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (CoT/step-back sẵn — chưa có dual-system router)
> **Effort:** 1.5-2.5 tuần

## Nguồn gốc

**Dual-process theory** (Kahneman — "Thinking, Fast and Slow"): **System 1** (fast, intuitive, heuristic — đáp nhanh) + **System 2** (slow, deliberate, analytical — suy nghĩ kỹ). **Adaptive compute / test-time compute** (OpenAI o1, DeepSeek R1): model quyết định **bao nhiêu compute** bỏ vào reasoning — câu dễ → ít, câu khó → nhiều (Mixture of Depths). Nguyên tắc: **không phải query nào cũng cần reasoning sâu** — easy → fast (tiết kiệm), hard → slow (chính xác). Khác **301 latency-budget-routing** (chọn model) — MH **chọn reasoning depth** cùng model; khác **285 step-back** (1 technique) — MH là **meta-strategy** (khi nào dùng technique nào); khác **286 CoV** — MH chọn **có verify không**.

## Mô tả

mya slow-fast reasoning: agent có 2 tier — **fast** (direct answer, ít token, heuristic) và **slow** (chain-of-thought, step-back, verification, multi-step deliberate). Router phân loại query (easy/hard) → fast hoặc slow. Easy → fast (tiết kiệm latency/cost), hard → slow (chính xác). Tier switch: nếu fast không tự tin → escalate lên slow. Nối 301 latency-routing (model) — MH là **reasoning depth** trong cùng model.

## Kiến trúc

```
  USER QUERY
       │
       ▼
  ┌─── REASONING ROUTER ─────────────────────┐
  │                                          │
  │  Classify: easy or hard?                  │
  │   · "what time is it?" → EASY (0.95)      │
  │   · "debug this race condition" → HARD    │
  │                                          │
  │    ┌─────┴─────┐                         │
  │    │ EASY       │ HARD / unsure            │
  │    └─────┬─────┘                         │
  └──────────┼───────────────────────────────┘
             │
  ┌──── FAST (System 1) ────┐  ┌──── SLOW (System 2) ──────────┐
  │ direct answer            │  │ step-back (285)               │
  │ heuristic                │  │ chain-of-thought              │
  │ ≤ 200 tokens             │  │ chain-of-verification (286)   │
  │ ~0.5s latency            │  │ program-aided (287)           │
  │                          │  │ multi-step deliberate          │
  │ confident?               │  │ ≥ 1000 tokens                  │
  │  └── yes → RETURN        │  │ ~5-10s latency                 │
  │  └── no → ESCALATE ↓     │  │                                │
  └──────────┬───────────────┘  └──────────────┬─────────────────┘
             │ (fast unsure → slow)             │
             └──────────► SLOW ◄────────────────┘
                                   │
                                   ▼
                              RETURN (verified)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 285 step-back-prompting — slow technique (System 2 tool)
// ✅ 286 chain-of-verification — slow technique (System 2 tool)
// ✅ 287 program-aided-lm — slow technique (System 2 tool)
// ✅ 301 latency-budget-routing — model routing (nền — MH reasoning depth)
// ✅ 302 inference-budget-arbitration — budget (nền)

// ❌ THIẾU: reasoning tier router (classify easy/hard → fast/slow)
// ❌ THIẾU: fast path (direct, heuristic, low token)
// ❌ THIẾU: slow path orchestration (CoT + step-back + CoV)
// ❌ THIẾU: confidence-based escalation (fast → slow when unsure)
```

## Implementation

```typescript
// packages/agent/src/dual-reasoning.ts (NEW)
type ReasoningTier = 'fast' | 'slow';

interface QueryFeatures {
  difficulty: number;    // 0-1 (router prediction)
  confidence: number;    // 0-1
}

class DualReasoningRouter {
  constructor(private slowTechniques: SlowTechnique[], private fastThreshold = 0.6) {}

  // Classify — easy or hard?
  async classify(query: string): Promise<QueryFeatures> {
    // Heuristic: short factual → easy, long analytical → hard
    const wordCount = query.split(/\s+/).length;
    const hasCode = /```|function|class|error|debug/i.test(query);
    const hasReasoningKeywords = /why|explain|analyze|compare|design|debug/i.test(query);
    const difficulty = Math.min(1, (wordCount > 50 ? 0.3 : 0) + (hasCode ? 0.4 : 0) + (hasReasoningKeywords ? 0.4 : 0));
    return { difficulty, confidence: 1 - difficulty };
  }

  async reason(query: string, context: unknown): Promise<{ answer: string; tier: ReasoningTier }> {
    const features = await this.classify(query);

    // EASY + confident → fast
    if (features.difficulty < this.fastThreshold) {
      const fast = await this.fastPath(query, context);
      if (fast.confidence > 0.7) return { answer: fast.answer, tier: 'fast' };
      // Fast unsure → escalate to slow
    }

    // HARD or fast-unsure → slow
    const slow = await this.slowPath(query, context);
    return { answer: slow.answer, tier: 'slow' };
  }

  // System 1 — direct, heuristic, low token
  private async fastPath(query: string, _ctx: unknown): Promise<{ answer: string; confidence: number }> {
    const answer = await llm.complete(`${query}\n[Answer directly, concisely]`, { maxTokens: 200 });
    const confidence = await this.estimateConfidence(answer);
    return { answer, confidence };
  }

  // System 2 — multi-technique deliberate
  private async slowPath(query: string, ctx: unknown): Promise<{ answer: string }> {
    let working = query;
    // Apply slow techniques in sequence
    for (const technique of this.slowTechniques) {
      working = await technique.apply(working, ctx); // step-back (285) → CoT → CoV (286)
    }
    const answer = await llm.complete(working, { maxTokens: 2000 });
    return { answer };
  }

  private async estimateConfidence(answer: string): Promise<number> {
    return answer.includes('I\'m not sure') || answer.includes('uncertain') ? 0.3 : 0.8;
  }
}

interface SlowTechnique { apply(query: string, ctx: unknown): Promise<string>; }
interface LLM { complete(prompt: string, opts?: { maxTokens?: number }): Promise<string>; }
const llm: LLM = undefined as unknown as LLM;
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm cost/latency (easy → fast) (Kahneman) | ❌ Router miss-classify (hard → fast → sai) |
| ✅ Chính xác khi cần (hard → slow) | ❌ Slow path expensive (CoT+CoV token) |
| ✅ Confidence escalation (fast→slow tự động) | ❌ Two code path maintain |
| ✅ Nối 285/286/287 (slow techniques) | ❌ Difficulty classifier cần tune |

## Khác các hướng gần

| | 301 Latency Routing | 285 Step-Back | 286 Chain-of-Verification | MH: Slow-Fast |
|---|---|---|---|---|
| Cái gì | Chọn model | 1 slow technique | 1 verify technique | **Meta: khi nào fast/slow** |
| Adaptive | Model choice | ❌ (always) | ❌ (always) | ✅ tier per query |
| System 1 | ❌ | ❌ | ❌ | ✅ fast path |
| System 2 | ❌ | ✅ | ✅ | ✅ orchestrated |

## Khi nào chọn

- Mix query easy/hard (muốn tiết kiệm easy, chính xác hard)
- Muốn adaptive compute (test-time compute như o1/R1)
- Có slow techniques sẵn (285/286/287) — cần meta-router
- Kết hợp 301 model routing (model) + MH reasoning depth (depth trong model); tune difficulty classifier + confidence threshold
