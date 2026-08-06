# Hướng ABH: Fuzzy Fallback Zero-Match — smart-case + auto-fuzzy: query zero-match tự retry dạng fuzzy, surface hit gần đúng

> **Nguồn gốc:** fff (README.md) | **Coupling:** 🟢 — thêm fuzzy fallback vào search path | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (có FuzzyCache + trigram fuzzy trong memory retrieve) | **Effort:** 1 tuần

## Nguồn gốc

**fff** tìm file với **smart-case kèm auto-fuzzy fallback**: (1) **smart-case** — pattern như `IsOffTheRecord` vẫn tìm thấy biến thể **snake_case** (`is_off_the_record`) — case folding thông minh, không phải case-sensitive cứng; (2) **auto-fuzzy fallback** — query **zero-match** (không có kết quả chính xác nào) tự **retry dạng fuzzy** (Levenshtein / bigram) và **surface các hit gần đúng tốt nhất** (xếp theo độ gần). Người dùng gõ sai chính tả (`IsOffTheRecrd`) vẫn ra kết quả đúng. Nguyên tắc: **exact trước, zero-match → fuzzy retry, surface best approximate hits**.

## Mô tả

mya fuzzy fallback zero-match: search path hai tầng — (1) **exact pass** (smart-case: normalize camelCase↔snake_case, case-insensitive khi hợp lý); (2) nếu **zero-match** → **fuzzy pass** (Levenshtein distance / bigram overlap trên file name) → trả **top-k hit gần đúng** kèm score (để agent biết đây là approximate, không phải exact). mya đã có packages/memory retrieve.ts `FuzzyCache` + trigram fuzzy (fuzzy correction khi 0 hits) + packages/tools fuzzy-score — ABH thêm **smart-case normalize** + **zero-match trigger** + **approximate-hit surface (score + flag)** vào search result.

## Kiến trúc

```
  QUERY "IsOffTheRecrd" (typo)
       │
       ▼
  SMART-CASE NORMALIZE
    camelCase → snake_case: "is_off_the_record"
    case-insensitive fallback cho lowercase query
       │
       ▼
  EXACT PASS ──► 0 hits? ──NO──► trả kết quả exact
       │YES
       ▼
  FUZZY PASS (Levenshtein / bigram)
    "IsOffTheRecrd" vs index
      is_off_the_record   → score 0.92   ← best approximate
      is_off_the_rack     → score 0.61
      ...
       │
       ▼
  SURFACE BEST APPROXIMATE (kèm score + approximate flag)
    [1] is_off_the_record.ts  (≈92% match — approximate)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory retrieve.ts — FuzzyCache + fuzzy correction khi 0 hits (nền — ABH core)
// ✅ packages/memory store.ts — trigram fuzzy (nền — ABH fuzzy pass analog)
// ✅ packages/tools — search-index + frecency (nền — ABH exact pass)
// ✅ packages/tools fuzzy-score — fuzzy scoring (nền — ABH score)

// ❌ THIẾU: smart-case normalize (camelCase ↔ snake_case)
// ❌ THIẾU: zero-match trigger rõ (exact pass 0 → fuzzy pass, có cờ)
// ❌ THIẾU: approximate-hit surface (score + approximate flag trong result)
```

## Implementation

```typescript
// packages/tools/src/fuzzy-fallback.ts (MỚI)

/** Smart-case normalize: camelCase ↔ snake_case + lowercase folding. */
export function smartCaseNormalize(term: string): string {
  return term
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // camelCase → snake_case
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

/** Levenshtein distance (nhỏ = gần). */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m]![n]!;
}

export interface SearchHit { path: string; score: number; approximate: boolean }

/** Search: exact (smart-case) trước; zero-match → fuzzy retry + surface best hits. */
export function searchWithFuzzyFallback(query: string, index: string[], topK = 5): SearchHit[] {
  const q = smartCaseNormalize(query);
  const exact = index
    .filter(p => smartCaseNormalize(p).includes(q))
    .map(path => ({ path, score: 1, approximate: false }));
  if (exact.length > 0) return exact.slice(0, topK); // exact pass thắng

  // ZERO-MATCH → fuzzy retry
  const fuzzy = index
    .map(path => {
      const name = smartCaseNormalize(path);
      const dist = levenshtein(q, name.slice(0, Math.max(q.length, name.length)));
      const score = Math.max(0, 1 - dist / Math.max(q.length, name.length, 1));
      return { path, score, approximate: true };
    })
    .filter(h => h.score >= 0.6) // ngưỡng: hit quá xa thì không surface
    .sort((a, b) => b.score - a.score);
  return fuzzy.slice(0, topK);
}
// Usage:
// const hits = searchWithFuzzyFallback("IsOffTheRecrd", fileIndex);
// hits[0] → { path: "is_off_the_record.ts", score: 0.92, approximate: true }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Typo-tolerant (gõ sai vẫn tìm thấy — ít bỏ cuộc sớm) | ❌ Fuzzy noise (hit xa vô nghĩa nếu ngưỡng quá thấp) |
| ✅ Smart-case (camelCase ↔ snake_case — không miss biến thể) | ❌ Fuzzy cost (Levenshtein O(n·m) trên index lớn) |
| ✅ Zero-match có đường lui (không trả "không có" mù) | ❌ Approximate flag (agent có thể tưởng exact) |
| ✅ Score trong result (agent biết độ tin cậy) | ❌ Ngưỡng tune (0.6 hợp lý? phụ thuộc codebase) |

## Khác các hướng gần

| | Case-sensitive exact | Case-insensitive exact | ABH: Smart-case + Fuzzy fallback |
|---|---|---|---|
| Typo | miss | miss | **fuzzy retry** |
| camelCase/snake | miss | miss | **normalize** |
| Zero-match | trả rỗng | trả rỗng | **surface best approximate + score** |

## Khi nào chọn

- Agent hay gõ tên file/pattern sai chính tả hoặc lẫn camelCase/snake_case
- Muốn giảm "không tìm thấy" mà không muốn đánh đổi precision quá nhiều
- Đã có FuzzyCache (packages/memory retrieve.ts) — chỉ cần gắn vào tool search
- Nối packages/tools search-index.ts + packages/memory retrieve.ts + 740 ABL weak-match-detector (chặn fuzzy noise trước khi nó vào context); guard threshold-tuning (ngưỡng fuzzy đủ cao — hit xa không vào), approximate-flag (luôn gắn cờ approximate cho hit fuzzy), và cost-bound (index lớn → prefilter bằng bigram trước Levenshtein); ABH = fuzzy fallback zero-match, kết hợp 740 ABL weak-match-detector + 741 ABM cursor-pagination-grep (giới hạn lượng hit vào context)
