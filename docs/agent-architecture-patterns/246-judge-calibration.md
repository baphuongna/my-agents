# Hướng IL: Judge Calibration — hiệu chỉnh LLM-as-judge

> **Nguồn gốc:** Zheng et al. "LLM-as-a-Judge" (MT-Bench, 2023); "Judging LLM-as-a-Judge bias"; Bavaresco et al. "LLMs instead of Human Judges"; biased judge literature (position, verbosity, self-enhancement)
> **Coupling:** 🟡 — judge module trong eval/council, ảnh hưởng scoring
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval harness + council sẵn — thiếu judge calibration + bias correction)
> **Effort:** 2-3 tuần

## Nguồn gốc

LLM-as-a-judge (Zheng et al. 2023, MT-Bench) — dùng LLM chấm điểm output thay human — rẻ, nhanh, scalable. Nhưng nghiên cứu cho thấy **bias nghiêm trọng**: (1) **position bias** — judge thích answer A hơn B đơn giản vì đứng trước; (2) **verbosity bias** — thích answer dài; (3) **self-enhancement bias** — judge thích answer do chính model đó tạo ra. Calibration: đo agreement giữa judge và human (gold), tính **bias delta**, rồi **hiệu chỉnh** — randomize position, average multiple judgments, hoặc retrain rubric. Bavaresco et al.: "LLMs instead of Human Judges" — evaluate reliability, found context-dependent.

Khác **205 self-consistency-sampling** (vote ra answer) — IL vote cho *đánh giá/judgment* (meta-level). Khác **130 agent-arena** (so sánh model) — IL hiệu chỉnh *bản thân* thẻ chấm. Nối **186 multi-agent-debate** (judge trong debate), **134 multi-agent-consensus** (council 194), **248 success-criteria** (IN — rubric cho judge), **147 data-flywheel** (judge quality → training signal).

## Mô tả

mya judge calibration: (1) **judge** — LLM chấm output theo rubric (nối 248 IN); (2) **measure bias** — A/B test: position swap (A trước vs B trước), verbosity control, self-judge; (3) **calibrate** — đo agreement với gold (human-labeled), tính bias delta, hiệu chỉnh (average A/B, de-bias, re-rubric); (4) **trust score** — confidence của judgment (nối 238 ID). mya đã có eval harness (packages/eval) + council (packages/council) — IL thêm calibration + bias correction layer.

## Kiến trúc

```
  OUTPUT cần chấm (agent response)
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  LLM-AS-JUDGE (chấm theo rubric 248 IN)       │
  │                                               │
  │  Compare A vs B:                              │
  │   judge(A, B) → "A is better"                 │
  │   judge(B, A) → "B is better"  ← POSITION BIAS│
  │                                               │
  │  verbosity: longer answer always wins ← BIAS  │
  │  self-judge: model likes own output ← BIAS    │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────┐
  │  CALIBRATION LAYER                             │
  │                                               │
  │  ① de-bias: average A/B order → "tie"         │
  │  ② gold comparison: judge vs human-labeled     │
  │     → agreement rate: 0.71 (needs work)        │
  │  ③ bias delta: position=0.15, verbose=0.08    │
  │  ④ calibrated score = raw - bias_delta         │
  │  ⑤ trust: confidence on judgment (238 ID)     │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────┐
  │  CALIBRATED JUDGMENT                           │
  │  · score: 7.2/10 (adjusted from raw 8.1)      │
  │  · trust: 0.71 (calibrate before trusting)     │
  │  · flag: low-agreement → sample more / human   │
  └──────────────────────────────────────────────┘
```

```
mya: eval harness + council sẵn — thiếu judge calibration + bias measurement + correction
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval/src/harness.ts — eval harness (chạy judge)
// ✅ packages/eval/src/tiers.ts — eval tiers (5 tiers — judge candidate)
// ✅ packages/council — multi-agent (judge in debate 186 / consensus 134)
// ✅ 130 agent-arena — model comparison (judge-driven)
// ✅ 205 self-consistency-sampling — sampling (tool for multi-judge)
// ✅ 248 success-criteria (IN) — rubric definition (judge input)

// ❌ THIẾU: bias measurement (position/verbosity/self-enhancement)
// ❌ THIẾU: calibration layer (judge vs gold agreement + bias delta)
// ❌ THIẾU: de-bias mechanism (position randomize / average / multi-judge)
// ❌ THIẾU: judge trust score (confidence — nối 238 ID)
```

## Implementation

```typescript
// packages/eval/src/judge-calibration.ts (NEW)
interface Judgment {
  winner: "A" | "B" | "tie";
  score: number;
  rawScore: number;
  biasDelta: number;
  trust: number;   // agreement-with-gold confidence (nối 238 ID)
}

class CalibratedJudge {
  private biasProfile: { position: number; verbosity: number; self: number };

  // De-biased pairwise comparison: judge both orders, average
  async compare(a: string, b: string, rubric: Rubric): Promise<Judgment> {
    const fwd = await this.judge(a, b, rubric);   // A vs B
    const rev = await this.judge(b, a, rubric);   // B vs A (position swap)
    const winner = fwd.winner === rev.winner ? fwd.winner : "tie"; // disagree → tie

    const biasDelta = fwd.winner !== rev.winner ? this.biasProfile.position : 0;
    const rawScore = Math.max(fwd.score, rev.score);
    return { winner, score: rawScore - biasDelta, rawScore, biasDelta, trust: this.agreementRate() };
  }

  // Measure bias against gold-labeled set (human judgments)
  async calibrate(goldSet: { a: string; b: string; human: string }[]): Promise<void> {
    let agree = 0;
    for (const g of goldSet) {
      const j = await this.compare(g.a, g.b, defaultRubric);
      if (j.winner === g.human) agree++;
    }
    this.agreement = agree / goldSet.length;  // track calibration
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Judge tin cậy hơn (loại bias — Zheng 2023) | ❌ Cost (2× judge call for de-bias) |
| ✅ Agreement-with-gold measurable (Bavaresco) | ❌ Gold set needed (human-labeled — expensive) |
| ✅ Trust score — biết khi nào tin judge (238 ID) | ❌ Bias evolving (re-calibrate periodic) |
| ✅ Nối eval harness + council (sẵn) | ❌ Residual bias (calibration không loại hết) |

## Khác các hướng gần

| | 205 Self-Consistency | 130 Agent Arena | IL: Judge Calibration |
|---|---|---|---|
| Mục | Vote answer | So sánh model | **Hiệu chỉnh thẻ chấm** |
| Level | Object | Pairwise | **Meta (judge quality)** |
| Bias | ❌ | Partial | **✅ measure + correct** |

## Khi nào chọn

- Dùng LLM-as-judge để chấm agent output (eval, council debate)
- Cần trust — biết khi nào judge đáng tin (nối 238 ID)
- Chấm theo rubric (248 IN) — cần calibration cho rubric mới
- Multi-agent consensus (134) — judge calibrated → consensus đáng tin hơn
