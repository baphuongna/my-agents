# Hướng MR: Time-Aware Memory Retrieval — xếp hạng retrieval theo thì (hiện tại/quá khứ/tương lai)

> **Nguồn gốc:** mem0 (temporal-aware retrieval — rank theo recency + tense); "temporal relevance"; "recency bias" in retrieval; "time-decayed scoring"; "bi-temporal query"; "when did this happen?" vs "is this still true?"
> **Coupling:** 🟢 — thêm temporal ranking layer vào retrieve.ts
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retrieve.ts + lifecycle decay + weibull sẵn — chưa có tense-aware ranking)
> **Effort:** 1-2 tuần

## Nguồn gốc

**mem0**: retrieval xếp hạng theo **thì (tense)** — query "current status" ưu tiên fact mới nhất (present), query "what happened?" ưu tiên sự kiện quá khứ (past), query "deadline?" ưu tiên fact tương lai (future). **Recency bias**: fact mới relevant hơn fact cũ cho câu hỏi hiện tại. **Bi-temporal**: fact có `validFrom`/`validTo` — query hỏi "at time T" → filter interval. Nguyên tắc: **thời gian thay đổi relevance** — không chỉ semantic similarity, mà **temporal alignment** với intent query. Khác **264 temporal-knowledge** (fact gắn time edge) — MR **retrieval ranking** theo tense; khác **356** (self — MR = 356); khác **351 MM append-only** (store temporal) — MR **query** temporal.

## Mô tả

mya time-aware retrieval: retrieve.ts thêm **temporal ranking** — phân loại query tense (present/past/future) → re-rank results. (1) **Present** ("status hiện tại?") → ưu tiên fact `validTo IS NULL` (current), recency boost. (2) **Past** ("đã xảy ra gì?") → ưu tiên event có `validFrom` trong range. (3) **Future** ("deadline nào?") → ưu tiên fact `validFrom > now`. Score = `semantic_sim × temporal_weight`. Nối 351 MM (validFrom/validTo source), retrieve.ts (ranking), weibull.ts (recency decay), 264 temporal-knowledge. Query intent parser phát hiện tense markers ("hiện tại", "đã", "sắp").

## Kiến trúc

```
  USER QUERY: "dự án X status gì?"
       │
       ▼
  ┌─── TENSE DETECTION ─────────────────────────┐
  │                                             │
  │  "status gì" → PRESENT (hiện tại)           │
  │  "đã xảy ra" → PAST   (quá khứ)             │
  │  "deadline"   → FUTURE (tương lai)          │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  ┌─── TEMPORAL RE-RANK ────────────────────────┐
  │                                             │
  │  semantic candidates (retrieve.ts)          │
  │       × temporal_weight:                    │
  │                                             │
  │  PRESENT: validTo IS NULL → ×1.0            │
  │           recent validFrom → recency boost  │
  │  PAST:    validFrom in query range → ×1.0   │
  │           outside range → ×0.3              │
  │  FUTURE:  validFrom > now → ×1.0            │
  │           past facts → ×0.2                 │
  │                                             │
  │  final_score = semantic_sim × temporal_w    │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
              RETURN time-ranked facts
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/retrieve.ts — retrieval engine (nền — MR thêm temporal rank)
// ✅ packages/memory/src/weibull.ts — recency decay (nền recency)
// ✅ packages/memory/src/lifecycle.ts — decay by time (nền)
// ✅ 264 temporal-knowledge — time-aware fact edge (nền)
// ✅ 351 MM append-only — validFrom/validTo (temporal interval source)

// ❌ THIẾU: tense detection (query intent → present/past/future)
// ❌ THIẾU: temporal weight function (per-tense scoring)
// ❌ THIẾU: temporal re-rank layer (semantic × temporal)
// ❌ THIẾU: point-in-time filter (query "at time T" → validFrom ≤ T < validTo)
```

## Implementation

```typescript
// packages/memory/src/temporal-retrieve.ts (NEW)
type Tense = 'present' | 'past' | 'future';

interface TemporalFact {
  content: string;
  validFrom: number;
  validTo: number | null;  // null = current
  semanticScore: number;
}

class TimeAwareRetrieval {
  // Detect query tense from natural language markers
  detectTense(query: string): Tense {
    if (/sắp|deadline|will|planned|future|tuần sau|ngày mai/i.test(query)) return 'future';
    if (/đã|was|happened|before|quá khứ|lần trước|ago/i.test(query)) return 'past';
    return 'present'; // default
  }

  // Temporal weight — how relevant is this fact for the detected tense?
  temporalWeight(fact: TemporalFact, tense: Tense, now = Date.now()): number {
    const isCurrent = fact.validTo === null;
    switch (tense) {
      case 'present':
        if (isCurrent) return 1.0;
        return 0.2; // past fact — less relevant for "current"
      case 'past':
        if (!isCurrent && fact.validFrom < now) return 1.0; // historical event
        return 0.3;
      case 'future':
        if (fact.validFrom > now) return 1.0; // scheduled/deadline
        return 0.2;
    }
  }

  // Re-rank: semantic × temporal
  rank(facts: TemporalFact[], query: string, now = Date.now()): TemporalFact[] {
    const tense = this.detectTense(query);
    return facts
      .map(f => ({ ...f, finalScore: f.semanticScore * this.temporalWeight(f, tense, now) }))
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  // Point-in-time query — "what was true at time T?" (nối 351 MM)
  atTime(facts: TemporalFact[], t: number): TemporalFact[] {
    return facts.filter(f => f.validFrom <= t && (f.validTo === null || t < f.validTo));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Query "current" trả fact mới nhất (mem0 recency) | ❌ Tense detection heuristic (miss-classify) |
| ✅ "Past" / "Future" filter (deadline, history) | ❌ Temporal weight tuning (per-domain) |
| ✅ Point-in-time query ("at time T") | ❌ Extra ranking step (latency) |
| ✅ Nối 351 MM (validFrom/validTo) | ❌ Facts without timestamp → ambiguous tense |

## Khác các hướng gần

| | 264 Temporal Knowledge | 351 MM Append-Only | retrieve.ts (semantic) | MR: Time-Aware |
|---|---|---|---|---|
| Cái gì | Time edge | Per-fact interval | Semantic rank | **Tense-aware rank** |
| Tense | ❌ | ❌ | ❌ | **present/past/future** |
| Re-rank | ❌ | ❌ | ❌ | **semantic × temporal** |

## Khi nào chọn

- Query có ý thời gian rõ ("current", "past", "deadline")
- Facts có validFrom/validTo (nối 351 MM)
- Muốn "current status" không trả fact cũ
- Kết hợp retrieve.ts (semantic) + 351 MM (temporal interval) + 264 temporal-knowledge (edge) + weibull.ts (recency); tune tense markers per language
