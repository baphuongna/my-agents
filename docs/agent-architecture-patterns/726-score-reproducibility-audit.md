# Hướng AAX: Score Reproducibility Audit — published score phải tái lập bằng câu hỏi in-domain mới lạ, không chỉ re-run cùng set

> **Nguồn gốc:** f2-experiment (conclusion.md) | **Coupling:** 🟢 — thêm reproducibility gate vào eval pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có eval harness + edge set — chưa có audit gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**f2-experiment** phát hiện **điểm công bố 97/100 không tái lập**: scoring độc lập cho **71-72/100** — **edge-honesty sụt từ 20/20 xuống 6-7/20**. Nguyên nhân: score gốc dùng câu hỏi quen thuộc (recall), scoring độc lập dùng **câu hỏi in-domain mới lạ** — model không recall được nên bộc lộ fabrication. Bài học: **mọi published score cần kiểm chứng bằng câu hỏi in-domain mới lạ** — re-run cùng set chỉ chứng minh deterministic, không chứng minh score đúng. Nguyên tắc: **reproducibility = tái lập trên dữ liệu mới, không phải chạy lại dữ liệu cũ**.

## Mô tả

mya score reproducibility audit: packages/eval harness.ts + edge-question.ts (AAU) + blind-scorer.ts (AAT) sẵn nền. AAX thêm **audit gate**: khi có score công bố, chạy **repro audit**: (1) **re-run cùng set** — deterministic check (cùng input → cùng điểm, dùng MockProvider); (2) **fresh in-domain set** — sinh câu hỏi mới lạ trong domain (không trùng set cũ, novelty check); (3) **so sánh** — score mới lệch > ngưỡng (vd 10 điểm) → **score cũ không đáng tin**, đánh dấu stale/unreliable. Audit kết quả ghi vào metadata của score (provenance + reproducibility status).

## Kiến trúc

```
  PUBLISHED SCORE (97/100)
        │
        ▼
  ┌─── REPRO AUDIT ──────────────────────────────────┐
  │  1. re-run cùng set → deterministic?              │
  │     (cùng input → cùng điểm — MockProvider)       │
  │  2. fresh in-domain set (mới lạ, novelty check)   │
  │     → score mới (71-72/100 — edge honesty sụt)    │
  │  3. |old - new| > 10 điểm → KHÔNG đáng tin        │
  │     → đánh dấu unreliable + lý do (recall bias)   │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/eval harness.ts — golden scenario runner (nền re-run)
// ✅ packages/eval edge-question.ts (AAU) — novel edge set (nền fresh set)
// ✅ packages/eval blind-scorer.ts (AAT) — dual scorer (nền độc lập chấm)
// ✅ packages/ai mock.ts — MockProvider (nền deterministic re-run)
// ✅ packages/core canonical-json.ts — canonical (nền so score ổn định)

// ❌ THIẾU: reproducibility gate (fresh set + delta check)// ❌ THIẾU: score metadata (provenance + reliability status)
```

## Implementation

```typescript
// packages/eval/src/repro-audit.ts (NEW)export interface PublishedScore {
  score: number;        // 0..100
  edgeHonesty: number;  // điểm honesty trên edge dimension
  evaluatedAt: number;
}

export interface ReproResult {
  deterministic: boolean;    // re-run cùng set → cùng điểm
  freshScore: number;        // score trên fresh in-domain set
  freshEdgeHonesty: number;
  delta: number;             // |published - fresh|
  reliable: boolean;         // delta ≤ 10 && deterministic
  reason: string;
}

/** 1. Deterministic re-run: cùng set, MockProvider → cùng điểm. */
export function rerunSameSet(runOnce: () => Promise<number>, runTwice: () => Promise<number>): boolean {
  // deterministic: kết quả hai lần chạy phải bằng nhau
  return Promise.all([runOnce(), runTwice()]).then(([a, b]) => a === b);
}

/** 2. Fresh in-domain set: sinh câu hỏi mới (novelty check — AAU). */
export async function freshInDomainScore(
  generateQuestions: () => Promise<Array<{ id: string; question: string }>>,
  scoreQuestion: (q: { id: string; question: string }) => Promise<{ total: number; edgeHonesty: number }>,
): Promise<{ score: number; edgeHonesty: number }> {
  const questions = await generateQuestions();
  const results = await Promise.all(questions.map(scoreQuestion));
  const score = results.reduce((s, r) => s + r.total, 0) / Math.max(1, results.length);
  const edgeHonesty = results.reduce((s, r) => s + r.edgeHonesty, 0) / Math.max(1, results.length);
  return { score, edgeHonesty };
}

/** 3. Audit gate: published score có tái lập không. */
export async function auditPublishedScore(
  published: PublishedScore,
  opts: {
    rerunSame: () => Promise<boolean>;
    generateFresh: () => Promise<Array<{ id: string; question: string }>>;
    scoreFresh: (q: { id: string; question: string }) => Promise<{ total: number; edgeHonesty: number }>;
    maxDelta?: number;
  },
): Promise<ReproResult> {
  const maxDelta = opts.maxDelta ?? 10;
  const deterministic = await opts.rerunSame();
  const fresh = await freshInDomainScore(opts.generateFresh, opts.scoreFresh);
  const delta = Math.abs(published.score - fresh.score);
  const reliable = deterministic && delta <= maxDelta;
  return {
    deterministic,
    freshScore: fresh.score,
    freshEdgeHonesty: fresh.edgeHonesty,
    delta,
    reliable,
    reason: reliable
      ? "score tái lập trên in-domain set mới"
      : `KHÔNG tái lập: delta ${delta.toFixed(1)} (ngưỡng ${maxDelta}) — edge honesty ${published.edgeHonesty} → ${fresh.edgeHonesty.toFixed(1)}; nghi recall bias trên set cũ`,
  };
}
// Usage: auditPublishedScore(published, { rerunSame, generateFresh, scoreFresh })
//   → reliable=false → đánh dấu score unreliable + thêm vào metadata
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lộ score ảo (recall bias) — chỉ tin score tái lập | ❌ Sinh fresh in-domain set tốn công mỗi lần audit |
| ✅ Deterministic check tách bạch (re-run ≠ tái lập) | ❌ Delta ngưỡng 10 là heuristic — domain khác ngưỡng khác |
| ✅ Edge honesty là dimension bắt buộc so sánh | ❌ Audit tốn thêm model calls (fresh set) |
| ✅ Metadata score có reliability status | ❌ Fresh set vô tình trùng set cũ (novelty check phải chạy) |

## Khác các hướng gần

| | Re-run cùng set | AAX: Repro Audit |
|---|---|---|
| Chứng minh | Deterministic | **Tái lập trên dữ liệu mới** |
| Set | Cùng | **Fresh in-domain (novelty)** |
| Kết luận | "Chạy lại được" | **"Score đáng tin"** |
| Mối quan hệ | Nền | **Gate trên published score** |

## Khi nào chọn

- Score được công bố/dùng quyết định (so sánh skill, chọn model)
- Nghi ngờ score cao do set cũ recall (bias — nối AAV)
- Đã có eval harness + edge set + blind scorer — thêm audit gate
- Guard: novelty check fresh set, delta ngưỡng theo domain, reliability status vào metadata score
