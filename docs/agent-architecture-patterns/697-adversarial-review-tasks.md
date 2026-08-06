# Hướng ZU: Adversarial Review Tasks — core tasks review-adversarial-general.xml + review-edge-case-hunter.xml là review kiểu đối thủ + săn edge case — verification đa góc nhìn cố định
> **Nguồn gốc:** BMAD-METHOD (references.md) | **Coupling:** 🟢 — 2 review task cố định trong council/adversarial | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (council/adversarial.ts + hindsight.ts — pattern đã có) | **Effort:** 1 tuần

## Nguồn gốc

**BMAD-METHOD** có 2 **core task review cố định**: (1) **review-adversarial-general.xml** — review **kiểu đối thủ** (adversarial): cố tình tìm lỗi, chỉ ra điểm yếu, đặt câu hỏi khó — như đối thủ muốn bác bỏ; (2) **review-edge-case-hunter.xml** — **săn edge case**: tìm trường hợp biên (input rỗng, concurrency, race, timeout, unicode, huge input) mà review thường bỏ qua. Hai review chạy song song/độc lập sau khi code xong — **verification đa góc nhìn cố định** (không phụ thuộc agent nhớ "phải review kỹ"). Nguyên tắc: **review đối thủ + săn edge case là 2 task cố định, không phải lời nhắc may rủi**.

## Mô tả

mya adversarial review tasks: (1) **Adversarial review** — task cố định: review như đối thủ (tìm lỗi logic, giả định sai, thiếu sót). (2) **Edge-case hunt** — task cố định: săn edge case theo checklist (empty, race, timeout, unicode, huge). (3) **Chạy độc lập** — 2 review sau khi code xong, output findings riêng. (4) **Gộp findings** — merge 2 kết quả → fix list. mya có council/adversarial.ts (`adversarialReview`) + hindsight.ts (review sau khi có answer) — ZU thêm **2 task review chuẩn hóa** + **edge-case checklist** + **merge findings**.

## Kiến trúc

```
  CODE XONG
  ┌──────────────────────────────────────────────────┐
  │  REVIEW TASK 1: adversarial-general               │
  │  ┌────────────────────────────────────────────┐   │
  │  │  nhìn như đối thủ:                          │   │
  │  │  lỗi logic, giả định sai, thiếu sót,        │   │
  │  │  câu hỏi khó → findings                     │   │
  │  └────────────────────────────────────────────┘   │
  │  REVIEW TASK 2: edge-case-hunter                  │
  │  ┌────────────────────────────────────────────┐   │
  │  │  săn edge case theo checklist:              │   │
  │  │  empty, race, timeout, unicode, huge,       │   │
  │  │  concurrency → findings                     │   │
  │  └────────────────────────────────────────────┘   │
  └────────────────────┬─────────────────────────────┘
                       ▼ merge
  ┌── FINDINGS (gộp) ──┐
  │  fix list ưu tiên    │
  └─────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council adversarial.ts — adversarialReview (nền — ZU task 1)
// ✅ packages/council hindsight.ts — hindsight review (nền — ZU review sau output)
// ✅ packages/council council.ts — CouncilProvider (nền — ZU chạy review)
// ✅ packages/eval harness.ts — ParityHarness (nền — ZU review output)
// ✅ packages/audit index.ts — AuditLog (nền — ZU lưu findings)

// ❌ THIẾU: 2 review task chuẩn hóa (adversarial-general + edge-case-hunter)
// ❌ THIẾU: edge-case checklist (empty/race/timeout/unicode/huge)
// ❌ THIẾU: merge findings (gộp 2 review → fix list)
```

## Implementation

```typescript
// packages/council/src/adversarial-tasks.ts (MỚI)

interface ReviewFinding { severity: "error" | "warning"; message: string; where?: string }

const EDGE_CASE_CHECKLIST = [
  "empty input", "null/undefined", "huge input", "unicode/emoji",
  "concurrency/race", "timeout", "retry/backoff", "duplicate call", "path traversal", "zero/negative",
] as const;

class AdversarialReviewTasks {
  constructor(
    private reviewOne: (task: string, code: string) => Promise<ReviewFinding[]>,
    private merge: (a: ReviewFinding[], b: ReviewFinding[]) => ReviewFinding[],
  ) {}

  // Task 1: adversarial-general — review như đối thủ
  async adversarialGeneral(code: string): Promise<ReviewFinding[]> {
    return this.reviewOne(
      "Review như đối thủ muốn bác bỏ: tìm lỗi logic, giả định sai, thiếu sót, " +
      "đặt câu hỏi khó nhất có thể. Output findings có severity.",
      code,
    );
  }

  // Task 2: edge-case-hunter — săn edge case theo checklist
  async edgeCaseHunter(code: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    for (const item of EDGE_CASE_CHECKLIST) {
      const f = await this.reviewOne(`Săn edge case: ${item} — code xử lý ${item} đúng chưa?`, code);
      findings.push(...f);
    }
    return findings;
  }

  // Chạy 2 review độc lập → merge findings (đa góc nhìn cố định)
  async review(code: string): Promise<{ findings: ReviewFinding[]; adversarial: ReviewFinding[]; edges: ReviewFinding[] }> {
    const [adversarial, edges] = await Promise.all([this.adversarialGeneral(code), this.edgeCaseHunter(code)]);
    return { findings: this.merge(adversarial, edges), adversarial, edges };
  }
}
// Usage:
// const reviews = new AdversarialReviewTasks(adversarialReview, mergeFindings);
// const { findings, adversarial, edges } = await reviews.review(codeSnippet);
// // 2 góc nhìn cố định: đối thủ (lỗi logic) + edge case (trường hợp biên)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Verification đa góc nhìn cố định (không may rủi) | ❌ 2 review + checklist → tốn token/LLM calls |
| ✅ Edge case có checklist (không bỏ sót quen thuộc) | ❌ Checklist cứng (edge case domain mới phải thêm) |
| ✅ Chạy độc lập (không bias lẫn nhau) | ❌ Findings nhiều → phải triage ưu tiên |
| ✅ Task cố định (agent không quên review kỹ) | ❌ Review là LLM → false positive/negative |

## Khác các hướng gần

| | Self-review | Human review | ZU: Adversarial Tasks |
|---|---|---|---|
| Góc nhìn | 1 (thiên kiến) | 1 | **2 cố định (đối thủ + edge)** |
| Checklist | Không | Cảm tính | **✅ edge-case checklist** |
| Chi phí | Thấp | Cao | **Vừa (LLM)** |

## Khi nào chọn

- Code/artifact quan trọng cần review kỹ trước khi merge
- Muốn review đối thủ (tìm lỗi thật) + săn edge case (trường hợp biên) cố định
- Muốn findings có severity để triage fix
- Nối packages/council adversarial.ts + hindsight.ts + council.ts + eval harness.ts + audit index.ts; guard checklist-coverage (edge case đủ cho domain), finding-severity (phân loại đúng error/warning), và independence (2 review không thấy nhau); ZU = adversarial review tasks, kết hợp 695 ZS party-mode-consensus (đa góc nhìn) + 684 ZH quality-convergence (findings → refine loop)
