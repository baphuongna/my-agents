# Hướng ID: Uncertainty Quantification — calibration, confidence, abstain

> **Nguồn gốc:** Kadavath et al. "Language Models (Mostly) Know What They Know" (2022, self-consistency confidence); Tian et al. "Can LLMs Self-Correct?" calibration; Kadavath; OpenAI "Letting models say 'I don't know'"; Guo et al. "On Calibration of Modern Neural Networks"
> **Coupling:** 🟡 — chèn confidence layer vào agent decision gate
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (budget/threat-scan sẵn — thiếu confidence estimator + abstain gate)
> **Effort:** 2-3 tuần

## Nguồn gốc

Uncertainty quantification (UQ) cho LLM — đo "model có chắc không?" — nổi bật qua Kadavath et al. (2022) "Language Models (Mostly) Know What They Know": model có thể tự đánh giá confidence bằng cách so sánh log-prob giữa answer đúng/sai (self-evaluation). Tian et al. mở rộng: nhiều phương pháp — verbalized confidence ("I'm 80% sure"), self-consistency (sample nhiều → đồng thuận = chắc), logprob-based. **Calibration** (Guo et al.) — confidence score phải khớp thực tế: nếu model nói "90% sure" thì đúng 90% lần, không 60%. Khi confidence thấp → **abstain** (từ chối trả lời/hành động) thay vì hallucinate — an toàn hơn. Ajayi "unsafe action" — model không chắc → KHÔNG thực thi destructive action.

Khác **205 self-consistency-sampling** (kỹ thuật *lấy* nhiều sample — công cụ) — ID dùng kết quả đó làm *confidence signal* + quyết định abstain. Khác **226 human-approval-gates** (hỏi người khi destructive) — ID tự đo confidence trước, chỉ escalate khi thấp. Nối **239 world-model** (IE), **236 anomaly** (IB), **185 lookahead** (IC).

## Mô tả

mya UQ: trước khi agent thực thi action quan trọng (tool call destructive, answer chính thức) → ước lượng **confidence**: (1) verbalized ("how confident 0-100?"), (2) self-consistency (sample N → agreement ratio), (3) logprob nếu provider cho phép. Confidence thấp dưới threshold → **abstain**: không thực hiện, escalate human (226), hoặc thử plan khác. Calibration: track confidence vs accuracy theo thời gian → re-calibrate (confidence inflation/deflation). mya đã có budget/iteration caps (hard stop) — ID thêm *soft* confidence gate.

## Kiến trúc

```
  AGENT DECISION (answer? destructive tool call?)
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  CONFIDENCE ESTIMATOR                         │
  │                                               │
  │  ① Verbalized: "confidence: 0.72"            │
  │  ② Self-consistency: sample ×5 → agree=3/5   │
  │  ③ Logprob: mean logp = -0.4                 │
  │  → combined confidence: 0.61                  │
  └──────────────────┬───────────────────────────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
     confidence ≥ θ     confidence < θ
            │                 │
            ▼                 ▼
     ┌────────────┐    ┌─────────────────┐
     │ EXECUTE    │    │ ABSTAIN          │
     │ (proceed)  │    │ · skip action    │
     └────────────┘    │ · escalate (226) │
                       │ · try alt plan   │
                       │ · "I'm not sure" │
                       └─────────────────┘

  CALIBRATION TRACK: confidence vs actual correctness → re-calibrate θ
```

```
mya: budget/threat-scan hard limits sẵn — thiếu confidence estimator + abstain gate + calibration
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/iteration-budget.ts — hard cap (token/iteration)
// ✅ packages/core/src/threat-scan.ts — flag risky action (binary, không confidence)
// ✅ 226 human-approval-gates — pause for human (sẵn — nhưng trigger thủ công)
// ✅ 205 self-consistency-sampling — sampling technique (công cụ cho confidence)
// ✅ 168 guardrails (FL) — action guard (binary block)

// ❌ THIẾU: confidence estimator (verbalized / self-consistency / logprob)
// ❌ THIẾU: abstain gate (confidence < θ → skip/escalate)
// ❌ THIẾU: calibration tracker (confidence vs accuracy over time)
// ❌ THIẾU: per-action-type threshold (destructive → high θ)
```

## Implementation

```typescript
// packages/core/src/confidence.ts (NEW)
interface ConfidenceEstimate {
  verbalized: number;      // 0-1 from prompt
  selfConsistency: number; // agreement ratio across N samples
  logprob?: number;        // mean log-probability if available
  combined: number;        // calibrated final
}

class ConfidenceGate {
  private calib: Map<ActionType, number> = new Map(); // θ per action type

  async estimate(action: AgentAction): Promise<ConfidenceEstimate> {
    const verbalized = await this.askVerbalized(action);          // "confidence?"
    const samples = await this.sample(action, 5);                 // self-consistency
    const agree = jaccardAgreement(samples);
    const combined = 0.5 * verbalized + 0.5 * agree;              // simple blend
    return { verbalized, selfConsistency: agree, combined };
  }

  shouldAbstain(type: ActionType, est: ConfidenceEstimate): boolean {
    const theta = this.calib.get(type) ?? 0.7;  // default threshold
    return est.combined < theta;                 // destructive → raise theta
  }

  // calibration: record outcome, adjust threshold
  recordCalibration(type: ActionType, est: ConfidenceEstimate, correct: boolean): void {
    // if consistently over-confident → raise theta; under-confident → lower
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tránh hallucinate/unsafe action (abstain khi không chắc) | ❌ Latency (self-consistency = sample ×N) |
| ✅ Calibration — confidence khớp thực tế (Guo et al.) | ❌ Cost (N samples = N× token) |
| ✅ Smart escalation — chỉ hỏi human khi thực sự cần (226) | ❌ Verbalized confidence unreliable (model over-confident) |
| ✅ Nối 205 self-consistency (công cụ sẵn) | ❌ Threshold tuning per-task |

## Khác các hướng gần

| | 205 Self-Consistency | 226 Approval Gates | ID: Uncertainty Quant. |
|---|---|---|---|
| Mục | Vote ra answer | Pause hỏi human | **Đo chắc + abstain** |
| Khi | Luôn (mỗi query) | Destructive action | **Confidence < θ** |
| Signal | Agreement vote | Manual trigger | **Calibrated score** |

## Khi nào chọn

- Agent thực thi destructive/irreversible action (delete, deploy, send)
- Cần biết khi nào "không biết" → hỏi human thay vì đoán (226)
- Compliance: audit confidence của mỗi decision
- OK với cost/latency thêm đổi lấy an toàn
