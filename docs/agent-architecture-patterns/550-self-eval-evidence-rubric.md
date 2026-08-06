# Hướng UD: Self-Eval Evidence Rubric — agent tự chấm 5 trục, điểm thấp bắt buộc trích evidence "show the gap"

> **Nguồn gốc:** ECC `agent-self-evaluation` (5-axis rubric, evidence requirement); "score 5 axes accuracy/completeness/...", "score <5 requires evidence citation", "show the gap, don't just name it"; self-grading with proof | **Coupling:** 🟡 — thêm self-eval rubric vào turn cuối | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval + audit sẵn — chưa có self-eval rubric + evidence enforcement) | **Effort:** 2-3 tuần

## Nguồn gốc

**ECC** `agent-self-evaluation` bắt agent **tự chấm điểm** output theo **5 trục**: (1) **Accuracy** — đúng sự thật không, (2) **Completeness** — đầy đủ yêu cầu không, (3) **Relevance** — liên quan câu hỏi không, (4) **Clarity** — rõ ràng dễ hiểu không, (5) **Safety** — an toàn không gây hại. Mỗi trục thang 1–10. **Quy tắc cốt lõi**: nếu bất kỳ trục nào **< 5** (điểm thấp), agent **bắt buộc trích evidence** — phải **chỉ ra chính xác** chỗ nào của output bị thiếu/sai ("show the gap, don't just name it"). Không được nói chung chung "chưa hoàn thiện" — phải quote dòng nào, thiếu gì, vì sao. Nguyên tắc: **self-grade có teeth** — điểm thấp phải có proof, không self-congratulation.

## Mô tả

mya self-eval evidence rubric: (1) **5-axis rubric**: agent chấm accuracy/completeness/relevance/clarity/safety (1–10). (2) **Threshold gate**: trục nào < 5 → flag "cần evidence". (3) **Evidence enforcement**: trục thấp → agent phải trích output cụ thể (quote/line/section) chỉ ra gap. (4) **Gap-actionable**: evidence dẫn đến fix cụ thể (tự sửa hoặc flag cho user). mya có eval + audit — UD thêm **rubric-scorer** + **threshold-gate** + **evidence-enforcer** + **gap-reporter**.

## Kiến trúc

```
  AGENT OUTPUT (turn cuối)
        │
        ▼
  ┌─── SELF-SCORE 5 TRỤC (1–10) ────────────────────────────┐
  │  accuracy:       9/10                                      │
  │  completeness:   4/10  ◀── <5 → CẦN EVIDENCE               │
  │  relevance:      8/10                                      │
  │  clarity:        7/10                                      │
  │  safety:        10/10                                      │
  └───────────────────────┬─────────────────────────────────┘
                          │ (trục <5 → enforce evidence)
                          ▼
  ┌─── EVIDENCE ENFORCEMENT ("show the gap") ────────────────┐
  │  completeness 4/10:                                       │
  │  "Output thiếu error-handling cho case empty-input.       │
  │   Section 'parse()' dòng 42 không check `input === null`."│
  │  → TRÍCH CHÍNH XÁC, không nói chung                       │
  └───────────────────────┬─────────────────────────────────┘
                          │ (gap actionable)
                          ▼
  ┌─── ACTION (tự sửa hoặc flag) ────────────────────────────┐
  │  → tự fix: thêm null-check dòng 42                        │
  │  → hoặc flag user: "thiếu edge-case, review giúp"         │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — evaluation harness (nền — UD rubric chạy ở đây)
// ✅ packages/audit trust.ts — trust scoring (nền — UD score analog)
// ✅ packages/agent sdk.ts — agent output (nền — UD self-eval output)
// ✅ packages/core redact.ts — safety check (nền — UD safety axis)

// ❌ THIẾU: rubric-scorer (5 trục 1–10, LLM self-grade)
// ❌ THIẾU: threshold-gate (trục <5 → flag)
// ❌ THIẾU: evidence-enforcer (trục thấp → quote gap cụ thể)
// ❌ THIẾU: gap-reporter (evidence → action: tự sửa/flag)
```

## Implementation

```typescript
// packages/agent/src/self-eval-rubric.ts (MỚI)
type Axis = 'accuracy' | 'completeness' | 'relevance' | 'clarity' | 'safety';

interface AxisScore { axis: Axis; score: number; evidence?: string }
interface SelfEval { scores: AxisScore[]; passed: boolean; gaps: AxisScore[] }

class SelfEvalEvidenceRubric {
  constructor(private threshold: number) {} // vd 5

  // LLM self-grade (prompt: "score each axis 1-10, cite evidence if <threshold")
  async evaluate(output: string): Promise<SelfEval> {
    const scores = await this.selfGrade(output); // → AxisScore[]
    const gaps = scores.filter(s => s.score < this.threshold);
    // enforce: gaps PHẢI có evidence
    for (const g of gaps) {
      if (!g.evidence || g.evidence.length < 10) {
        g.evidence = '⚠ EVIDENCE THIẾU — re-grade with specific quote';
      }
    }
    return { scores, passed: gaps.length === 0, gaps };
  }

  private async selfGrade(_output: string): Promise<AxisScore[]> {
    // placeholder: LLM call → 5 axis scores
    // real impl: prompt LLM "chấm output theo 5 trục, trục <5 trích evidence"
    return [];
  }
}

// Usage:
// const eval = await rubric.evaluate(agentOutput);
// if (!eval.passed) {
//   for (const g of eval.gaps) {
//     console.log(`${g.axis}: ${g.score} → ${g.evidence}`);
//     // "completeness: 4 → Output thiếu null-check dòng 42"
//   }
// }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Self-grade có teeth (điểm thấp → phải chứng minh) | ❌ Self-eval bias (agent tự chấm dễ generous) |
| ✅ Gap cụ thể (quote, không nói chung) | ❌ LLM cost (self-grade mỗi output) |
| ✅ Actionable (evidence → tự sửa/flag) | ❌ Evidence quality (LLM quote có thể sai dòng) |
| ✅ Bắt self-congratulation (không "all 10/10" vô căn cứ) | ❌ Threshold chủ quan (5 là đúng không?) |

## Khác các hướng gần

| | 84 LLM-as-Judge | Human review | UD: Self-Eval-Rubric |
|---|---|---|---|
| Cái gì | Judge khác chấm | Người chấm | **Agent tự chấm + evidence enforcement** |
| Who | External LLM | Human | **Self** |
| Evidence | ⚠ | ✅ | **bắt buộc khi <5** |

## Khi nào chọn

- Muốn agent tự kiểm tra chất lượng (không external judge)
- Cần gap cụ thể (quote, không generic) → tự sửa được
- Tránh self-congratulation (agent luôn nói "tốt lắm")
- Nối packages/eval + packages/audit trust.ts + packages/agent sdk.ts + packages/core redact.ts; guard self-bias (calibrate score với external judge thỉnh thoảng), evidence-precision (yêu cầu quote thật, không paraphrase mơ hồ), và threshold-calibration (test threshold thực tế — quá thấp/cao); UD = self-eval evidence rubric, kết hợp 548 UB instinct-learning (instinct quality check) + 84 llm-as-judge (external cross-check)
