# Hướng ABL: Weak-Match Detector — gắn cờ fuzzy noise phân tán trước khi nó làm ngập context của agent

> **Nguồn gốc:** fff (README.md) | **Coupling:** 🟢 — thêm weak-match detector vào search result pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có fuzzy + search — chưa có weak-match flag) | **Effort:** 1 tuần

## Nguồn gốc

**fff** có **weak-match detector**: phát hiện **fuzzy noise phân tán** — hàng loạt kết quả khớp yếu, rải rác, không liên quan — **trước khi** chúng làm ngập context của agent. Khi một query fuzzy trả về quá nhiều hit có score thấp, detector nhận ra "đây là noise, không phải signal" và **chặn** (hoặc gắn cờ) thay vì để agent nhận cả đống kết quả vô nghĩa. Mục tiêu: **chặn từ gốc** — không để fuzzy noise chiếm context window. Nguyên tắc: **detect weak matches trước khi render, flag hoặc chặn, context không bị ngập**.

## Mô tả

mya weak-match detector: search result pipeline thêm một bước — sau khi fuzzy search trả hits, **phân tích phân bố score**: (1) hit có score dưới ngưỡng → **weak**; (2) tỉ lệ weak quá cao (> X%) hoặc weak hits quá nhiều (> N) → **noise pattern**; (3) hành động: **chặn** (không trả hits yếu, chỉ trả top-k mạnh) hoặc **gắn cờ** (trả kèm cảnh báo "kết quả yếu — có thể sai"). mya có packages/memory retrieve.ts FuzzyCache + packages/tools fuzzy-score — ABL thêm **weak-match classifier** + **noise gate** (chặn/flag trước render).

## Kiến trúc

```
  QUERY "authServce" (typo nặng)
       │
       ▼
  FUZZY SEARCH ──► hits với score
    authService.ts      0.88   ← mạnh
    authServer.ts       0.55   ← weak
    auth-service-utils  0.42   ← weak
    authSettings.ts     0.38   ← weak
    autocomplete.ts     0.31   ← weak
       │
       ▼
  WEAK-MATCH DETECTOR
    weak ratio = 4/5 = 80% > 60%  → NOISE PATTERN
    → chặn hits weak, chỉ giữ top mạnh + cảnh báo
       │
       ▼
  RESULT (context không ngập)
    [1] authService.ts (0.88)
    ⚠️ "Có N hits yếu bị chặn — query có thể sai chính tả"
  → agent không nhận 4 hits vô nghĩa vào context
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory retrieve.ts — FuzzyCache + fuzzy correction (nền — ABL fuzzy source)
// ✅ packages/tools — search-index + frecency (nền — ABL hit pipeline)
// ✅ 736 ABH fuzzy-fallback-zero-match — fuzzy retry (nền — ABL áp trên kết quả fuzzy)
// ✅ packages/tools fuzzy-score — fuzzy scoring (nền — ABL score input)

// ❌ THIẾU: weak-match classifier (score < ngưỡng → weak)
// ❌ THIẾU: noise gate (weak ratio quá cao → chặn/flag)
// ❌ THIẾU: context protection (kết quả render không bao gồm noise)
```

## Implementation

```typescript
// packages/tools/src/weak-match-detector.ts (MỚI)

export interface ScoredHit { path: string; score: number }

export interface DetectionResult {
  hits: ScoredHit[];        // hits mạnh giữ lại
  blockedWeak: number;      // số hits yếu bị chặn
  noise: boolean;           // có noise pattern không
  warning?: string;         // cảnh báo cho agent
}

const WEAK_THRESHOLD = 0.6;   // dưới đây = weak match
const NOISE_RATIO = 0.6;      // >60% hits là weak → noise
const MAX_WEAK_BLOCKED = 50;  // chặn tối đa (không đếm vô hạn)

/** Detect weak matches: phân loại + quyết định chặn/flag trước khi render. */
export function detectWeakMatches(hits: ScoredHit[]): DetectionResult {
  const strong = hits.filter(h => h.score >= WEAK_THRESHOLD);
  const weak = hits.filter(h => h.score < WEAK_THRESHOLD);
  const weakRatio = hits.length > 0 ? weak.length / hits.length : 0;
  const noise = weakRatio > NOISE_RATIO && weak.length > 0;

  if (!noise) {
    // không noise: giữ tất cả (kể cả weak — agent có thể cần)
    return { hits, blockedWeak: 0, noise: false };
  }

  // NOISE: chặn weak hits, chỉ giữ top strong + cảnh báo
  return {
    hits: strong,
    blockedWeak: Math.min(weak.length, MAX_WEAK_BLOCKED),
    noise: true,
    warning: `⚠️ ${weak.length} hits yếu bị chặn (score < ${WEAK_THRESHOLD}) — query có thể sai chính tả, thử fuzzy-fallback`,
  };
}

// Usage:
// const { hits, blockedWeak, warning } = detectWeakMatches(fuzzyHits);
// if (warning) ctx.prepend(warning);          // agent biết có noise
// renderHits(hits);                            // context không bị ngập
// → 80% weak → chặn 4/5, chỉ 1 hit mạnh vào context
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context protected (noise không vào prompt — tiết kiệm token) | ❌ False positive (chặn nhầm hit yếu nhưng cần thiết) |
| ✅ Agent biết có noise (warning kèm theo — không im lặng) | ❌ Threshold tune (0.6 / 60% — phụ thuộc codebase) |
| ✅ Chặn từ gốc (không để noise tới prompt rồi mới lọc) | ❌ Mất recall (hit weak nhưng đúng bị chặn) |
| ✅ Zero LLM (heuristic score thuần — không model) | ❌ Score quality (fuzzy score kém → detector kém theo) |

## Khác các hướng gần

| | Trả hết hits | Truncate top-N | ABL: Weak-Match Detector |
|---|---|---|---|
| Noise vào context | ✅ (ngập) | một phần | **chặn theo score pattern** |
| Agent biết noise | không | không | **warning kèm** |
| Precision | thấp | trung bình | **cao (chỉ hits mạnh)** |
| Recall | cao | cao | **có thể thấp hơn (chặn weak)** |

## Khi nào chọn

- Fuzzy search trả quá nhiều hit yếu làm agent bối rối / ngập context
- Muốn context window không bị lãng phí cho kết quả vô nghĩa
- Đã có fuzzy scoring (packages/tools + memory) — chỉ thêm detector layer
- Nối packages/tools search-index.ts + packages/memory retrieve.ts + 736 ABH (fuzzy fallback); guard threshold-tuning (calibrate WEAK_THRESHOLD + NOISE_RATIO theo codebase), warning-transparency (luôn cho agent biết hits bị chặn — không im lặng), và recall-safety (chỉ chặn khi noise pattern rõ — không chặn single weak hit); ABL = weak-match detector, kết hợp 736 ABH fuzzy-fallback-zero-match (noise → gợi ý retry) + 741 ABM cursor-pagination-grep (kiểm soát lượng kết quả vào context)
