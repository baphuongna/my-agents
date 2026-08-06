# Hướng ON: Entity Query Expansion — expand query bằng entities liên quan trước embed

> **Nguồn gốc:** mem0 (entity-store + query expansion); "expand query with related entities"; "entity-association enrichment"; "entity-store lookup before embedding"; "semantic neighborhood query"
> **Coupling:** 🟢 — thêm entity-expansion step trước embed/query
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (entity-extraction + entity-store sẵn — chưa có query-expansion lookup)
> **Effort:** 2 tuần

## Nguồn gốc

**mem0** duy trì **entity-store** — mỗi entity có metadata + entities liên quan (co-occur / relation). Khi query, trước khi embed, hệ thống **expand query**: tìm entities trong query → tra entity-store → lấy **entities liên quan** → enrich query gốc. Vd query "món ăn yêu thích" → entity-store biết "sushi" liên quan "user" qua relation `likes` → query mở rộng thành "món ăn yêu thích sushi sashimi Nhật Bản". Nguyên tắc: **query ngắn thiếu ngữ nghĩa** — expand bằng entity-neighborhood tăng recall. Khác **197 GO hybrid-search** — ON là **pre-search expansion**; khác **357 MS entity-trajectory** — ON expand **query input** chứ không track entity theo thời gian.

## Mô tả

mya entity query expansion: trước hybrid-search, (1) **extract entities** từ query (NER / keyword). (2) **Lookup entity-store**: mỗi entity → tìm related entities (co-occur, relation). (3) **Expand query**: ghép related entities vào query (synonyms, broader/narrower). (4) **Embed expanded query** → search recall cao hơn. mya có `357 entity-trajectory` + `348 AST-KG` — ON thêm **query-expander** dùng entity-store.

## Kiến trúc

```
  USER QUERY: "Món ăn yêu thích?"
        │
        ▼
  ┌─── ENTITY EXTRACTION (NER) ────────────────────────┐
  │  query → entities: ["món ăn", "yêu thích"]          │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── ENTITY-STORE LOOKUP ────────────────────────────┐
  │  "món ăn" → related: {sushi, phở, pizza}            │
  │     (co-occur trong memory trước)                   │
  │  "yêu thích" → relation: user.likes → sushi, phở    │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── QUERY EXPANSION ────────────────────────────────┐
  │  original: "Món ăn yêu thích?"                      │
  │  expanded: "Món ăn yêu thích sushi sashimi phở      │
  │             pizza Nhật Việt Ý"                      │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── EMBED EXPANDED + HYBRID SEARCH ─────────────────┐
  │  expanded query → embed → search → recall cao hơn   │
  │  (match memory "user thích sushi" ngay cả khi       │
  │   query gốc không nhắc sushi)                       │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 357 MS entity-trajectory — entity tracking (nền — ON = query expand từ entity)
// ✅ 348 MJ AST-KG — knowledge graph (nền — entity-store)
// ✅ 197 GO hybrid-search — search (nền — ON expand query trước search)
// ✅ 224 HP knowledge-editing — fact entities (nền)

// ❌ THIẾU: query entity extractor (NER trên query input)
// ❌ THIẾU: entity-store lookup (entity → related entities)
// ❌ THIẾU: query expander (ghép related vào query)
```

## Implementation

```typescript
// packages/agent/src/memory/entity-query-expansion.ts (MỚI)
interface EntityNode {
  name: string;
  type: string;                  // 'food' | 'person' | 'place' ...
  related: Map<string, number>;  // relatedEntity → co-occur count
}

class EntityQueryExpander {
  constructor(private store: Map<string, EntityNode>) {}

  // Extract entities from query (simple keyword / NER)
  extract(query: string): string[] {
    // placeholder — real impl uses NER or keyword dict
    return query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  }

  // Expand query with related entities from store
  expand(query: string, maxExpansion = 5): string {
    const entities = this.extract(query);
    const additions = new Set<string>();

    for (const e of entities) {
      const node = this.store.get(e);
      if (!node) continue;
      // top related by co-occur count
      const related = [...node.related.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxExpansion);
      related.forEach(([name]) => additions.add(name));
    }

    if (additions.size === 0) return query;
    return `${query} ${[...additions].join(' ')}`;
  }
}

// Usage:
// const expander = new EntityQueryExpander(entityStore);
// const expanded = expander.expand('Món ăn yêu thích?');
//   → 'Món ăn yêu thích sushi sashimi phở pizza'
// const results = await hybridSearch(embed(expanded));   // recall cao hơn
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Recall cao hơn (match memory không nhắc trực tiếp) | ❌ Query drift (expand quá → match sai) |
| ✅ Tận dụng entity-store (co-occur đã biết) | ❌ Expansion cost (lookup mỗi query) |
| ✅ Entity-store update liên tục (học dần) | ❌ Cold-start (store rỗng → không expand) |
| ✅ Nối 357 MS entity-trajectory (reuse store) | ❌ Noise (related yếu → dilute query) |

## Khác các hướng gần

| | 197 GO Hybrid-Search | 357 MS Entity-Trajectory | 405 OO BM25-Entity-Boost | ON: Entity-Query-Expansion |
|---|---|---|---|---|
| Cái gì | Vector + BM25 | Track entity theo time | Boost BM25 bằng entity | **Expand query trước search** |
| Timing | During search | Post-store | During fusion | **Pre-search** |
| Entity store | ❌ | ✅ | ✅ | ✅ lookup |
| Recall | Tốt | ❌ | Tốt | ✅ cao hơn |

## Khi nào chọn

- Query ngắn / mơ hồ (thiếu ngữ nghĩa để match)
- Có entity-store phong phú (co-occur đã học)
- Muốn recall cao (match memory liên quan gián tiếp)
- Nối 357 MS entity-trajectory (entity-store) + 197 GO hybrid-search (search base); guard query drift (cap maxExpansion) + noise (filter co-occur count thấp)
