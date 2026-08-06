# Hướng AJJ: Recall X-ray Provenance — recall disclosure first-class: trả lời *where/when/why* một memory được dùng + tier nào (chunk/section/raw transcript) sinh ra kết quả

> **Nguồn gốc:** remnic | **Coupling:** 🟢 — retrieval result enrichment memory | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có tier field + RetrievalResult.debug; chưa có per-hit provenance where/when/why) | **Effort:** 1.5 tuần

## Nguồn gốc

**remnic** Recall **X-ray** cho thấy **tier nào** sinh ra kết quả (chunk / section / raw transcript) và **tại sao** — three retrieval tiers + `RetrievedMemoryProvenance` contract trả lời **where / when / why** một memory được dùng. Recall disclosure là tính năng **first-class** chứ không phải log phụ — agent (và user) thấy rõ mỗi hit đến từ đâu, khi nào ghi, vì sao match.

Nguyên tắc: **provenance là output chứ không phải side-effect** — mọi hit mang theo metadata truy vết (tier, source, age, match reason); **three tiers minh bạch** — chunk (đoạn nhỏ), section (mục lớn), raw transcript (bản ghi nguyên bản) — agent biết mình đang đọc ở độ phân giải nào; **disclosure first-class** — không ẩn trong debug log, surface trong kết quả recall để agent tự đánh giá độ tin cậy.

## Mô tả

Với mya, pattern = **enrich MemoryHit + RetrievalResult thành recall X-ray**: (1) **mya có RetrievalResult (retrieve.ts)** với `debug` (armsUsed, tokenizedTerms, fuzzyCorrected) — nền debug có; (2) **mya có tier field (sqlite-recall.ts)** — `"working" | "episodic"` + `source` per hit — gần where; (3) **AJJ thêm per-hit `RetrievedMemoryProvenance`**: `{ tier, source, recordedAt, ageMs, matchReason, score, section? }` — where (tier/source), when (recordedAt/age), why (matchReason: "fts" | "vector" | "graph" | "fuzzy"); (4) **three-tier mapping** — mya working=L0/chunk, episodic=L1/section, BrainPage=L2 — thêm raw transcript tier (sqlite raw rows); (5) **surface disclosure** — recall trả hits kèm provenance summary (không chỉ debug); (6) **nối AJH** — provenance.source/session trùng timeline provenance; nối AJJ disclosure cho recall audit. `MemoryHit` mở rộng (giữ backward-compat — provenance optional).

## Kiến trúc (ASCII)

```
  RECALL QUERY
    │
    ▼ THREE-TIER RETRIEVAL
    ├─ L0 working/chunk   ──► MemoryHit + provenance{tier:"chunk",  matchReason:"fts"}
    ├─ L1 episodic/section──► MemoryHit + provenance{tier:"section",matchReason:"vector"}
    └─ L2 raw transcript  ──► MemoryHit + provenance{tier:"raw",    matchReason:"graph"}
    │
    ▼ ENRICH — RetrievedMemoryProvenance (WHERE/WHEN/WHY)
    hit.provenance = {
      tier, source,            ← WHERE  (tier nào, nguồn nào)
      recordedAt, ageMs,       ← WHEN   (khi nào ghi, cũ bao lâu)
      matchReason, score,      ← WHY    (vì sao match, độ tin)
    }
    │
    ▼ DISCLOSURE FIRST-CLASS (không phải log phụ)
    recall → hits[] kèm provenance summary cho agent + audit
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory retrieve.ts — RetrievalResult { hits, debug { armsUsed,
//   tokenizedTerms, fuzzyCorrected, totalCandidates } } (nền debug có)
// ✅ packages/memory sqlite-recall.ts — MemoryHit { tier: "working"|"episodic",
//   source } + RecallOptions + 3-tier scope (common/role/session)
// ✅ packages/core types.ts — MemoryHit { id, role, content, score } (base hit)
// ✅ packages/memory retrieve.ts — RetrievalEngine (FTS + vector + fuzzy arms)
// ✅ packages/memory memory-source.ts — ContextSource (nền where/origin)

// ❌ THIẾU: per-hit RetrievedMemoryProvenance (tier/source/age/matchReason)
// ❌ THIẾU: raw transcript tier (chunk/section/raw rõ ràng)
// ❌ THIẾU: disclosure first-class (provenance surface trong kết quả, không debug)
```

## Implementation

```typescript
// packages/memory/src/recall-provenance.ts (NEW)
export type RecallTier = "chunk" | "section" | "raw";
export type MatchReason = "fts" | "vector" | "graph" | "fuzzy";

export interface RetrievedMemoryProvenance {
  tier: RecallTier;           // WHERE — độ phân giải nào
  source: string;             // WHERE — nguồn (session/id)
  recordedAt: number;         // WHEN — khi nào ghi
  ageMs: number;              // WHEN — cũ bao lâu (now - recordedAt)
  matchReason: MatchReason;   // WHY  — vì sao match
  score: number;              // WHY  — độ tin
  section?: string;           // WHERE — mục (nếu section tier)
}

export type XrayHit = MemoryHit & { provenance?: RetrievedMemoryProvenance };

/** Enrich raw hits với provenance — disclosure first-class. */
export function xray(
  hits: MemoryHit[],
  arm: MatchReason,
  now: number,
): XrayHit[] {
  return hits.map((h) => {
    const tier: RecallTier =
      h.tier === "working" ? "chunk" : h.tier === "episodic" ? "section" : "raw";
    return {
      ...h,
      provenance: {
        tier, source: (h as { source?: string }).source ?? "?",
        recordedAt: 0, ageMs: now, matchReason: arm, score: h.score,
      },
    };
  });
}
// recall(): thay `return { hits, debug }` bằng `return { hits: xray(hits,arm),
//   debug }` — provenance surface trong kết quả (không ẩn debug). Backward-compat:
// provenance optional; agent cũ vẫn đọc MemoryHit thường.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent thấy where/when/why mỗi hit — tự đánh giá tin cậy | ❌ Provenance phình payload recall — cần compact format |
| ✅ Three-tier minh bạch — biết độ phân giải đọc | ❌ Phải giữ backward-compat (provenance optional) |
| ✅ Audit tốt — trace memory về nguồn/tuổi | ❌ recordedAt/age cần clock ổn định (core.time) |
| ✅ Nối AJH timeline provenance | ❌ Disclosure tăng token — cần toggle on/off |

## Khác các hướng gần

| | AJJ Recall X-ray | AJH Synthesis-Timeline | AJE Trace→Primitive |
|---|---|---|---|
| Trọng tâm | Disclosure provenance recall | Format entity 2 lớp | Capture pipeline |
| Cơ chế | Per-hit where/when/why + tier | Synthesis + timeline + stale | Judge + staging + commit |
| Quan hệ | Tiêu thụ MemoryHit enriched | Nguồn provenance (source/session) | Sinh raw transcript tier |

## Khi nào chọn

- Recall hiện chỉ trả hit trần — muốn agent biết memory từ đâu/tuổi bao nhiêu/vì sao match
- Quan tâm audit — trace mỗi memory về tier/source/age
- Đã có RetrievalResult.debug — nâng provenance từ debug thành first-class
- Guard: provenance optional (backward-compat), compact format, clock dùng core.time, toggle disclosure on/off để tiết kiệm token
