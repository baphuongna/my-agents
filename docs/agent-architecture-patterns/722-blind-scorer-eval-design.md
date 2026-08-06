# Hướng AAT: Blind Scorer Eval Design — 2 scorer độc lập (protocol + blind ground-truth) hội tụ 1 điểm mọi dimension

> **Nguồn gốc:** f2-experiment (conclusion.md) | **Coupling:** 🟢 — thêm scorer setup vào eval harness | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có eval harness — chưa có dual-scorer protocol) | **Effort:** 1-2 tuần

## Nguồn gốc

**f2-experiment** thiết kế eval dùng **2 scorer độc lập**: **A: protocol có skill-file** (biết skill, chấm theo protocol của skill), **B: blind chỉ ground-truth** (không thấy skill, chỉ thấy đáp án đúng). Cả hai **hội tụ trong 1 điểm mọi dimension** — chứng minh **rubric sound** qua **inter-rater reliability cao**. Nếu hai scorer lệch nhau, rubric không rõ ràng (hoặc skill tự dạy cách "ăn điểm" — gaming). Nguyên tắc: **scorer độc lập + blind = bằng chứng rubric đáng tin**, không chỉ là một người chấm thuận tay.

## Mô tả

mya blind scorer eval design: packages/eval harness.ts có parity scenarios + DriftGrader. AAT thêm **dual-scorer protocol**: mỗi scenario chấm bởi **2 scorer độc lập** — scorer A nhận {protocol, skill file, response}, scorer B nhận {ground-truth, response} (blind — không thấy skill). So sánh điểm: **hội tụ (≤1 điểm lệch mọi dimension)** → rubric sound, chấp nhận; **lệch > 1** → đánh dấu rubric ambiguity (hoặc skill gaming) → phải sửa rubric. Đo **inter-rater agreement** làm CI metric. Nền: harness Mock replay + provider gọi độc lập.

## Kiến trúc

```
  SCENARIO (prompt + response + ground-truth + skill file)
        │
        ├──────────────────────────────┐
        ▼                              ▼
  ┌─── SCORER A (protocol) ──┐   ┌─── SCORER B (blind) ──┐
  │  input: skill file +     │   │  input: ground-truth + │
  │         response         │   │         response       │
  │  chấm theo protocol của  │   │  KHÔNG thấy skill      │
  │  skill                   │   │  chấm theo đáp án đúng │
  └───────────┬──────────────┘   └───────────┬────────────┘
              └──────────────┬───────────────┘
                             ▼
  ┌─── COMPARE (inter-rater) ─────────────────────────┐
  │  |A - B| ≤ 1 mọi dimension → rubric sound ✅       │
  │  |A - B| > 1 → ambiguity/gaming → sửa rubric ❌    │
  │  agreement là CI metric                            │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval harness.ts — ParityScenario + golden trace (nền)
// ✅ packages/eval egress.ts — output policy (nền scorer call)
// ✅ packages/council council.ts — fan-out providers (nền 2 scorer độc lập)
// ✅ packages/council hindsight.ts — critic (nền scorer format)
// ✅ packages/ai mock.ts — MockProvider (nền deterministic replay)

// ❌ THIẾU: dual-scorer protocol (A protocol / B blind)
// ❌ THIẾU: inter-rater agreement metric + CI gate
```

## Implementation

```typescript
// packages/eval/src/blind-scorer.ts (NEW)
export interface ScoreCard { dimensions: Record<string, number>; total: number }

export type Scorer = (input: { prompt: string; response: string; skillFile?: string; groundTruth?: string }) => Promise<ScoreCard>;

/** Scorer A: có protocol (skill file). Scorer B: blind — chỉ ground-truth. */
export function makeScorerPair(
  protocolScorer: Scorer,   // A
  blindScorer: Scorer,      // B
): { scoreA: Scorer; scoreB: Scorer } {
  return { scoreA: protocolScorer, scoreB: blindScorer };
}

/** So sánh 2 scorer — hội tụ ≤ 1 điểm mọi dimension. */
export function interRaterDelta(a: ScoreCard, b: ScoreCard): { maxDelta: number; perDimension: Record<string, number> } {
  const perDimension: Record<string, number> = {};
  let maxDelta = 0;
  for (const dim of new Set([...Object.keys(a.dimensions), ...Object.keys(b.dimensions)])) {
    const d = Math.abs((a.dimensions[dim] ?? 0) - (b.dimensions[dim] ?? 0));
    perDimension[dim] = d;
    maxDelta = Math.max(maxDelta, d);
  }
  return { maxDelta, perDimension };
}

/** Rubric sound nếu mọi dimension lệch ≤ 1. Lệch > 1 → ambiguity hoặc gaming. */
export function isRubricSound(delta: { maxDelta: number }): boolean {
  return delta.maxDelta <= 1;
}

/** Chạy eval dual-scorer cho một scenario. */
export async function evaluateBlind(
  scenario: { prompt: string; response: string; skillFile?: string; groundTruth?: string },
  pair: { scoreA: Scorer; scoreB: Scorer },
): Promise<{ a: ScoreCard; b: ScoreCard; delta: { maxDelta: number; perDimension: Record<string, number> }; sound: boolean }> {
  // A và B chạy độc lập — không share input
  const [a, b] = await Promise.all([
    pair.scoreA({ prompt: scenario.prompt, response: scenario.response, skillFile: scenario.skillFile }),
    pair.scoreB({ prompt: scenario.prompt, response: scenario.response, groundTruth: scenario.groundTruth }),
  ]);
  const delta = interRaterDelta(a, b);
  return { a, b, delta, sound: isRubricSound(delta) };
}
// CI: chạy evaluateBlind cho N scenarios → agreement % ≥ ngưỡng (vd 90%)
//   → lệch > 1 ở dimension nào → sửa rubric dimension đó
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bằng chứng rubric sound (inter-rater cao) | ❌ Gấp đôi chi phí scoring (2 model calls) |
| ✅ Phát hiện skill gaming (A cao, B thấp) | ❌ Blind phải thật sự blind — leak skill = hỏng |
| ✅ Phát hiện rubric ambiguity (lệch dimension) | ❌ Scorer B cần ground-truth chất lượng |
| ✅ CI metric — agreement đo được | ❌ Dimension thiết kế phải rõ từ đầu |

## Khác các hướng gần

| | Single scorer | AAT: Dual Blind Scorer |
|---|---|---|
| Scorer | Một (có protocol) | **A protocol + B blind** |
| Kết luận | "Điểm cao" | **"Rubric đáng tin" (agreement)** |
| Chi phí | 1 call/scenario | **2 calls/scenario** |
| Mối quan hệ | Nền | **Bổ sung bằng chứng validity** |

## Khi nào chọn

- Eval kết quả quan trọng (công bố điểm, so sánh skill)
- Nghi ngờ skill tự "dạy" cách ăn điểm (protocol bias)
- Đã có eval harness + council fan-out — thêm dual-scorer
- Guard: blind thật sự (không leak skill), agreement ≥ ngưỡng CI, sửa rubric khi lệch dimension
