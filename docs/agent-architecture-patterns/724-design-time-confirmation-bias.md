# Hướng AAV: Design-Time Confirmation Bias — author vừa build skill vừa thiết kế test nên câu hỏi khớp thứ skill được tinh chỉnh

> **Nguồn gốc:** f2-experiment (conclusion.md) | **Coupling:** 🟢 — thêm bias guard vào eval thiết kế | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có eval harness — chưa có bias check) | **Effort:** 1 tuần

## Nguồn gốc

**f2-experiment** phát hiện **design-time confirmation bias**: author vừa build skill vừa thiết kế test questions nên **câu hỏi tự nhiên khớp với thứ skill được tinh chỉnh** — eval đo đúng thứ mình vừa làm, không đo tổng quát. **Edge question độc lập, đối nghịch** (người khác sinh, hoặc sinh trước khi skill tồn tại) **phá vỡ alignment này**. Nguyên tắc: **test questions phải độc lập với quá trình build** — nếu cùng người vừa sửa bug vừa viết câu hỏi kiểm tra bug đó, điểm cao là hệ quả tất yếu, không phải bằng chứng chất lượng.

## Mô tả

mya design-time confirmation bias guard: packages/eval harness.ts có scenario set. AAV thêm **bias guard**: (1) **separation** — test questions sinh bởi người/role khác với người build (hoặc sinh TRƯỚC khi skill tồn tại — snapshot timestamp); (2) **overlap audit** — so câu hỏi với skill diff: câu hỏi trùng keyword với feature vừa thêm → đánh dấu "aligned" (dễ bias); (3) **adversarial set** — câu hỏi đối nghịch (edge, ngoài scope) bắt buộc có mặt với tỷ lệ tối thiểu (vd 30%) để kéo eval về tổng quát. Ghi provenance mỗi câu hỏi: `{author, createdBeforeSkill, overlap}`.

## Kiến trúc

```
  TEST QUESTION SET (thiết kế cùng lúc với skill build)
        │
        ▼
  ┌─── BIAS GUARD ────────────────────────────────────┐
  │  1. provenance: author + createdBeforeSkill (ts)   │
  │  2. overlap audit: câu hỏi trùng feature mới thêm   │
  │     → aligned (bias-prone) — đánh dấu              │
  │  3. adversarial set: edge/ngoài scope — tỷ lệ ≥ 30%│
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── REPORT ────────────────────────────────────────┐
  │  %aligned vs %independent — alignment cao = cảnh báo│
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval harness.ts — scenario registry (nơi thêm provenance)
// ✅ packages/eval tiers.ts — tier classification (nền bias tier)
// ✅ packages/skills curator.ts — skill provenance (nền createdBeforeSkill)
// ✅ packages/core canonical-json.ts — canonical (nền overlap hash)
// ✅ packages/tools codegraph.ts — diff analysis (nền overlap audit)

// ❌ THIẾU: question provenance + overlap audit
// ❌ THIẾU: adversarial-set tỷ lệ tối thiểu
```

## Implementation
```typescript
// packages/eval/src/bias-guard.ts (NEW)
export interface QuestionProvenance {
  id: string;
  authorRole: "builder" | "independent";
  /** Câu hỏi sinh trước khi skill tồn tại? (ts so với skill first-commit). */
  createdBeforeSkill: boolean;
  /** Keyword trùng feature vừa thêm vào skill? */
  overlapsRecentChange: boolean;
}

export interface BiasReport {
  aligned: number;       // builder + overlap → bias-prone
  independent: number;   // independent role HOẶC createdBeforeSkill
  adversarialRatio: number; // câu hỏi edge/ngoài scope / tổng
  warning: boolean;
}

/** Audit overlap: câu hỏi trùng keyword với skill diff. */
export function auditOverlap(
  q: { id: string; question: string },
  recentSkillKeywords: string[],
): boolean {
  const lower = q.question.toLowerCase();
  return recentSkillKeywords.some((k) => lower.includes(k.toLowerCase()));
}

/** Phân loại câu hỏi thành aligned hay independent. */
export function classifyQuestion(p: QuestionProvenance): "aligned" | "independent" {
  const builderAligned = p.authorRole === "builder" && !p.createdBeforeSkill;
  return builderAligned && p.overlapsRecentChange ? "aligned" : "independent";
}

/** Báo cáo bias — cảnh báo khi alignment cao / adversarial thấp. */
export function buildBiasReport(
  questions: QuestionProvenance[],
  adversarialCount: number,
): BiasReport {
  const aligned = questions.filter((q) => classifyQuestion(q) === "aligned").length;
  const independent = questions.length - aligned;
  const adversarialRatio = adversarialCount / Math.max(1, questions.length);
  return {
    aligned,
    independent,
    adversarialRatio,
    warning: aligned / Math.max(1, questions.length) > 0.5 || adversarialRatio < 0.3,
  };
}

/** Gate: chấp nhận eval chỉ khi bias dưới ngưỡng. */
export function assertUnbiased(r: BiasReport): void {
  if (r.warning) {
    throw new Error(
      `BIAS GUARD: aligned=${r.aligned} (cao), adversarial=${(r.adversarialRatio * 100).toFixed(0)}% (< 30%). ` +
      `Thêm câu hỏi độc lập (role khác / sinh trước skill) và edge set.`,
    );
  }
}
// Usage: sau khi thiết kế question set — assertUnbiased(buildBiasReport(...))
//   → alignment cao = phải bổ sung independent questions
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lộ alignment — điểm cao do tự thiết kế câu hỏi | ❌ Provenance phải ghi từ đầu (hồi tố khó) |
| ✅ Adversarial set bắt buộc — kéo về tổng quát | ❌ Keyword overlap heuristic — có thể miss semantic overlap |
| ✅ Gate rõ ràng (aligned > 50% → chặn) | ❌ Sinh câu hỏi trước skill khó thực hành (phải snapshot) |
| ✅ Kết hợp AAU edge — một hệ thống | ❌ Phân vai builder/independent cần quy trình rõ |

## Khác các hướng gần

| | Blind scorer (AAT) | AAV: Bias Guard |
|---|---|---|
| Chống gì | Scorer bias | **Test-design bias** |
| Cơ chế | Scorer độc lập | **Question provenance + overlap audit** |
| Đo gì | Rubric sound | **Alignment/adversarial ratio** |
| Mối quan hệ | Scoring | **Trước scoring — thiết kế set** |

## Khi nào chọn

- Một người/team vừa build skill vừa viết test — cần chống tự khen
- Điểm eval quan trọng (công bố, so sánh) — cần bằng chứng khách quan
- Đã có eval harness — thêm provenance + bias gate
- Guard: provenance bắt buộc mọi câu hỏi, adversarial ≥ 30%, kết hợp AAU (edge) + AAT (blind)
