# Hướng UR: Benchmark Anti-Cheating — cấm câu hỏi test trùng example dialogue trong skill file, chống pattern-match "thuộc lòng"

> **Nguồn gốc:** DISTILL-R2 `anti-cheating` (`benchmark_guard.py`, `example_overlap_check`); "forbid test questions matching example dialogue in skill"; "prevent memorization pattern-match"; "held-out test set"; "no overlap between train examples and eval questions" | **Coupling:** 🟢 — thêm overlap-checker vào benchmark pipeline (reject test trùng example) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có example/test overlap detector) | **Effort:** 1-2 tuần

## Nguồn gốc

**DISTILL-R2** phát hiện **lỗ hổng benchmark**: nếu câu hỏi test **giống** example dialogue trong skill file → model chỉ cần **pattern-match** (thuộc lòng) → điểm cao giả tạo (không đo độ hiểu thật). Giải pháp: **anti-cheating guard** — kiểm **overlap** giữa test questions và example dialogue; cấm test trùng/nhái example. Nguyên tắc: **held-out test** — example (train) và test phải **disjoint**, đo khả năng **generalize** chứ không thuộc lòng. Giống ML holdout — train ≠ test set. Khác UQ (chấm điểm) — UR là **data-hygiene guard** (test sạch trước khi chấm).

## Mô tả

mya benchmark anti-cheating: (1) **Overlap check**: so sánh test questions vs example dialogue (cosine/exact/fuzzy match). (2) **Reject**: test trùng/nhái example → reject (không cho vào benchmark). (3) **Held-out**: đảm bảo example (train) và test disjoint. (4) **Report**: log overlap ratio (bao nhiêu % test bị loại). mya có eval — UR thêm **overlap detector** + **reject guard** + **held-out enforcement**.

## Kiến trúc

```
  SKILL FILE chứa EXAMPLE DIALOGUE (train set)
        │
        ▼
  ┌─── OVERLAP CHECK (test vs example) ──────────────────┐
  │  test Q1 vs example: cosine 0.92 → REJECT (nhái)      │
  │  test Q2 vs example: cosine 0.31 → ACCEPT (held-out)  │
  │  test Q3 vs example: exact match → REJECT (trùng)     │
  └───────────────────────┬─────────────────────────────┘
                          │ (reject overlap)
                          ▼
  ┌─── HELD-OUT BENCHMARK (disjoint) ────────────────────┐
  │  chỉ test không trùng example → đo GENERALIZE         │
  │  (không phải thuộc lòng pattern-match)                │
  │  report: 2/5 test rejected (overlap), 3/5 accepted    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — benchmark (nền — UR guard ở đây)
// ✅ 091 synthetic-eval — test data (nền — UR check overlap)
// ✅ 84 llm-as-judge — scoring (nền — UR trước khi chấm)

// ❌ THIẾU: overlap detector (test vs example, cosine/exact/fuzzy)
// ❌ THIẾU: reject guard (trùng → loại khỏi benchmark)
// ❌ THIẾU: held-out enforcement (train ∩ test = ∅)
// ❌ THIẾU: overlap report (ratio rejected)
```

## Implementation

```typescript
// packages/eval/src/benchmark-anti-cheat.ts (MỚI)
interface Verdict { question: string; status: 'accept' | 'reject'; reason: string; similarity: number }

class BenchmarkAntiCheat {
  constructor(
    private similarity: (a: string, b: string) => number, // cosine/exact/fuzzy
    private exactThreshold: number,   // = 1.0 → trùng nguyên văn
    private fuzzyThreshold: number,   // vd 0.85 → nhái gần
  ) {}

  // check 1 test question vs all examples
  check(question: string, examples: string[]): Verdict {
    let maxSim = 0;
    let matched = '';
    for (const ex of examples) {
      const s = this.similarity(question, ex);
      if (s > maxSim) { maxSim = s; matched = ex; }
    }
    if (maxSim >= this.exactThreshold) return { question, status: 'reject', reason: `exact match: "${matched.slice(0, 40)}…"`, similarity: maxSim };
    if (maxSim >= this.fuzzyThreshold) return { question, status: 'reject', reason: `too similar (${maxSim.toFixed(2)}): "${matched.slice(0, 40)}…"`, similarity: maxSim };
    return { question, status: 'accept', reason: 'held-out', similarity: maxSim };
  }

  // filter benchmark: reject overlap, keep held-out
  filter(testQuestions: string[], examples: string[]): { accepted: string[]; rejected: Verdict[] } {
    const accepted: string[] = [];
    const rejected: Verdict[] = [];
    for (const q of testQuestions) {
      const v = this.check(q, examples);
      if (v.status === 'accept') accepted.push(q); else rejected.push(v);
    }
    return { accepted, rejected };
  }

  // report overlap ratio
  report(testQuestions: string[], examples: string[]): string {
    const { accepted, rejected } = this.filter(testQuestions, examples);
    return `Anti-cheat: ${rejected.length}/${testQuestions.length} rejected (overlap), ${accepted.length} held-out accepted`;
  }
}

// simple similarity (bag-of-words cosine)
function cosine(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let dot = 0; for (const w of ta) if (tb.has(w)) dot++;
  return dot / Math.sqrt(ta.size * tb.size);
}

// Usage:
// const guard = new BenchmarkAntiCheat(cosine, 1.0, 0.85);
// const { accepted } = guard.filter(testQs, skillExamples); // chỉ held-out
// → benchmark đo generalize, không thuộc lòng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo generalize thật (không thuộc lòng) | ❌ Test pool thu hẹp (reject nhiều → ít test) |
| ✅ Benchmark honest (không điểm ảo) | ❌ Threshold tuning (fuzzy quá lỏng/chặt) |
| ✅ Held-out enforcement (train ∩ test = ∅) | ❌ Similarity false-positive (test hợp lệ bị loại) |
| ✅ Audit (overlap ratio rõ) | ❌ Example evolution (example đổi → re-check) |

## Khác các hướng gần

| | 091 Synthetic-Eval | 84 LLM-as-Judge | UR: Benchmark-Anti-Cheat |
|---|---|---|---|
| Cái gì | Sinh data test | Chấm output | **Guard test sạch (held-out)** |
| Overlap | ❌ | ❌ | **✅ reject overlap** |
| Stage | Gen test | Scoring | **Pre-scoring guard** |

## Khi nào chọn

- Benchmark đo độ hiểu thật (không thuộc lòng)
- Skill có nhiều example dialogue → nguy cơ test trùng
- Muốn honest benchmark (không điểm ảo)
- Nối packages/eval + 091 synthetic-eval + 84 llm-as-judge; guard threshold calibration (fuzzy hợp lý), held-out ratio (đủ test sau reject), và example regeneration (test mới khi example đổi); UR = benchmark anti-cheating, chạy TRƯỚC UQ fidelity-scorecard (test sạch → chấm mới đúng)
