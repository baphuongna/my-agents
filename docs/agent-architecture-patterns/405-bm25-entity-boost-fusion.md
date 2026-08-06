# Hướng OO: BM25 Entity Boost Fusion — fusion BM25 + co-occur entity boosts + embedding distance

> **Nguồn gốc:** mem0 (hybrid search fusion); "BM25 keyword score + entity co-occurrence boost + embedding cosine"; "fusion weighting"; "entity-aware retrieval scoring"; "co-occur boost"
> **Coupling:** 🟢 — thêm fusion scoring layer trên hybrid search
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (hybrid-search + reranking sẵn — chưa có co-occur entity boost trong fusion)
> **Effort:** 2 tuần

## Nguồn gốc

**mem0** fusion không chỉ kết vector + BM25 — còn **boost** memory có **entity co-occur** cao với query entities. Scoring 3 thành phần: (1) **embedding distance** (cosine similarity query ↔ memory); (2) **BM25** (keyword overlap); (3) **entity co-occur boost** (memory chứa entity liên quan entity trong query → cộng điểm). Mỗi thành phần có **weight** configurable. Nguyên tắc: **vector bắt ngữ nghĩa, BM25 bắt keyword, entity-boost bắt quan hệ** — fusion 3 chiều cân bằng hơn. Khác **197 GO hybrid-search** — OO thêm **entity-boost dimension** thứ ba; khác **404 ON entity-expansion** — OO boost ở **fusion scoring** chứ không expand query.

## Mô tả

mya BM25 entity boost fusion: (1) Tính **vector score** (cosine query ↔ memory). (2) Tính **BM25 score** (keyword overlap). (3) Tính **entity-boost score** (query entities ↔ memory entities → co-occur weight). (4) **Fuse** 3 score theo weight → final rank. mya có `197 GO hybrid-search` — OO thêm **entity-boost dimension** vào fusion.

## Kiến trúc

```
  QUERY: "sushi ở đâu ngon?"  entities: [sushi, ngon]
        │
        ├──────────────┬──────────────────┐
        ▼              ▼                  ▼
  ┌──────────┐  ┌──────────┐    ┌───────────────────┐
  │ EMBEDDING│  │  BM25    │    │ ENTITY CO-OCCUR   │
  │ cosine   │  │ keyword  │    │ query entities ↔  │
  │ score    │  │ overlap  │    │ memory entities   │
  │ 0.85     │  │ 3.2      │    │ sushi↔sushi → 0.9 │
  └────┬─────┘  └────┬─────┘    └────────┬──────────┘
       │             │                   │
       ▼             ▼                   ▼
  ┌─── FUSION (weighted) ────────────────────────────┐
  │  final = w1·normalize(vec)                        │
  │        + w2·normalize(bm25)                       │
  │        + w3·normalize(entityBoost)                │
  │                                                   │
  │  w1=0.4, w2=0.3, w3=0.3                           │
  │  → rank cân bằng ngữ nghĩa + keyword + quan hệ    │
  └───────────────────────┬───────────────────────────┘
                          │
                          ▼
                   FINAL RANKED RESULTS
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 197 GO hybrid-search — vector + BM25 (nền — OO = thêm entity-boost dimension)
// ✅ 357 MS entity-trajectory — entities (nền — OO dùng cho co-occur)
// ✅ 197 GO reranking — fusion (nền — OO thêm weight entity)

// ❌ THIẾU: entity co-occur score (query entity ↔ memory entity)
// ❌ THIẾU: 3-way fusion weighting (vec + bm25 + entityBoost)
// ❌ THIẾU: normalize function (3 score thang khác nhau)
```

## Implementation

```typescript
// packages/agent/src/memory/bm25-entity-fusion.ts (MỚI)
interface MemoryCandidate {
  id: string;
  text: string;
  embedding: number[];
  entities: string[];
}

interface FusionWeights {
  vector: number;
  bm25: number;
  entityBoost: number;
}

class BM25EntityFusion {
  constructor(
    private weights: FusionWeights = { vector: 0.4, bm25: 0.3, entityBoost: 0.3 },
    private cooccur: Map<string, Map<string, number>> = new Map(),  // entityA → (entityB → count)
  ) {}

  // Fuse 3 scores → final ranked list
  fuse(
    candidates: { candidate: MemoryCandidate; vecScore: number; bm25Score: number }[],
    queryEntities: string[],
  ): { id: string; finalScore: number }[] {
    const scored = candidates.map(({ candidate, vecScore, bm25Score }) => {
      const entityScore = this.entityBoost(queryEntities, candidate.entities);
      // normalize each to [0,1] within batch
      return { candidate, vecScore, bm25Score, entityScore };
    });

    const norm = (vals: number[]) => {
      const max = Math.max(...vals, 1e-9);
      const min = Math.min(...vals, 0);
      return vals.map(v => (v - min) / (max - min || 1));
    };

    const vecN = norm(scored.map(s => s.vecScore));
    const bmN = norm(scored.map(s => s.bm25Score));
    const enN = norm(scored.map(s => s.entityScore));

    const { vector: wv, bm25: wb, entityBoost: we } = this.weights;
    return scored
      .map((s, i) => ({
        id: s.candidate.id,
        finalScore: wv * vecN[i] + wb * bmN[i] + we * enN[i],
      }))
      .sort((a, b) => b.finalScore - a.finalScore);
  }

  // Entity co-occur boost: query entities ↔ memory entities
  private entityBoost(queryEntities: string[], memoryEntities: string[]): number {
    let score = 0;
    for (const qe of queryEntities) {
      for (const me of memoryEntities) {
        const count = this.cooccur.get(qe)?.get(me) ?? 0;
        score += count;
      }
    }
    return score;
  }
}

// Usage:
// const fusion = new BM25EntityFusion({ vector: 0.4, bm25: 0.3, entityBoost: 0.3 });
// const ranked = fusion.fuse(candidates, queryEntities);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rank cân bằng (ngữ nghĩa + keyword + quan hệ) | ❌ 3 weight tuning (khó tune tối ưu) |
| ✅ Entity quan hệ được thưởng (co-occur cao) | ❌ Co-occur table maintenance (update mỗi add) |
| ✅ Flexible weight (chỉnh theo use-case) | ❌ Normalize nhạy (outlier lệch batch) |
| ✅ Nối 197 GO (3rd dimension mượt) | ❌ Cost (3 score tính mỗi query) |

## Khác các hướng gần

| | 197 GO Hybrid-Search | 404 ON Entity-Expansion | 357 MS Entity-Trajectory | OO: BM25-Entity-Fusion |
|---|---|---|---|---|
| Cái gì | Vector + BM25 | Expand query | Track entity time | **3-way fusion + boost** |
| Entity | ❌ | ✅ (expand) | ✅ | ✅ co-occur boost |
| Dimension | 2 (vec+bm25) | pre-search | post-store | **3 (vec+bm25+entity)** |
| Timing | search | pre-search | ongoing | **fusion** |

## Khi nào chọn

- Hybrid-search 2 chiều (vec+bm25) chưa đủ precision
- Có entity co-occur data (memory có entities phong phú)
- Muốn thưởng memory có quan hệ entity với query
- Nối 197 GO hybrid-search (fusion base) + 357 MS entity-trajectory (co-occur source); guard weight tuning (A/B test) + normalize outlier
