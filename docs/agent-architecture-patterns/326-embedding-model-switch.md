# Hướng LN: Embedding Model Switch — đổi embedding model, migrate/reindex vector store

> **Nguồn gốc:** "Vector index migration"; embedding model versioning; "re-embedding"; HNSW rebuild; "dimensionality change"; "lazy re-embed"; dual-write migration
> **Coupling:** 🟡 — chạm memory store + embed + index
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/memory + embed sẵn — thiếu re-index pipeline + dual-write + dimension compat + versioned KB)
> **Effort:** 3-4 tuần

## Nguồn gốc

Embedding model switch: text-embedding-3-small → 3-large (dim 1536→3072). Vấn đề: **vector cũ (1536d) không so được với mới (3072d)** — phải re-embed toàn bộ KB. Vector index (HNSW): rebuild khi dim đổi. Migration strategies: (1) **dual-write** — viết cả old+new index trong transition; (2) **lazy re-embed** — re-embed on-demand khi query miss; (3) **full reindex** — batch re-embed tất cả; (4) **dimensionality reduction** — project new về old dim (lossy). Versioned KB (LA 313): tag embed model version → biết fact nào cần re-embed. Cốt lõi: **đổi embed = đổi tọa độ** — mọi vector phải re-compute hoặc compat.

## Mô tả

mya embedding switch: text-embedding-v1 → v2. (1) **version** — KB đã tag version (LA 313); (2) **dual-write** — fact mới embed cả v1+v2 (transition); (3) **re-index** — batch re-embed tất cả fact cũ sang v2; (4) **cutover** — query dùng v2, retire v1; hoặc **lazy** — re-embed on query miss. Dimension khác → full reindex (không compat). Nối LA (313) incremental-kb (versioned), 325 model-retirement (retire old embed), 165 dedup (re-embed thay đổi similarity).

## Kiến trúc

```
  OLD: text-embedding-v1 (dim 1536) → KB all v1 embeddings
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  DECISION: same dim or different?                    │
  │  · same dim (1536→1536): can mix (lazy or dual)      │
  │  · diff dim (1536→3072): MUST full reindex            │
  └──────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────────┐    ┌──────────────────────────┐
  │ DUAL-WRITE       │    │ FULL REINDEX (diff dim)  │
  │ new fact → v1+v2 │    │ batch re-embed all facts │
  │ query → v2       │    │ rebuild HNSW index       │
  │ old facts: lazy  │    │ (one big job)           │
  │   re-embed on    │    └──────────────────────────┘
  │   query miss     │
  └────────┬─────────┘
           │ transition done
           ▼
  ┌──────────────────────────────────────────────────────┐
  │  CUTOVER                                              │
  │  · all facts re-embedded to v2                        │
  │  · query uses v2 only                                 │
  │  · retire v1 (325 retirement)                         │
  │  · version tag updated (LA 313)                       │
  └──────────────────────────────────────────────────────┘
```

```
mya: packages/memory + embed sẵn — thiếu re-index pipeline + dual-write + version migration
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — embed + vector store (sẵn)
// ✅ LA (313) incremental-kb — versioned KB (documented — tag embed model)
// ✅ 165 memory-dedup — similarity (re-embed changes it — document)
// ✅ 325 model-retirement — retire old (documented)

// ❌ THIẾU: re-index pipeline (batch re-embed all facts)
// ❌ THIẾU: dual-write (write old+new during transition)
// ❌ THIẾU: lazy re-embed (on query miss)
// ❌ THIẾU: dimension-compat check (mix safe? or must reindex?)
```

## Implementation

```typescript
// packages/memory/src/embed-migrate.ts (NEW)
interface KBFact { id: string; text: string; embedding: number[]; embedModel: string; }

export class EmbeddingMigration {
  constructor(private store: KBStore, private embed: (text: string, model: string) => Promise<number[]>) {}

  // Full reindex — re-embed all facts to new model (diff dim)
  async reindex(newModel: string, batchSize = 100): Promise<number> {
    let count = 0;
    for await (const batch of this.store.iterBatch(batchSize)) {
      await Promise.all(batch.map(async (f) => {
        f.embedding = await this.embed(f.text, newModel);
        f.embedModel = newModel;
      }));
      count += batch.length;
    }
    return count;
  }

  // Dual-write — new facts embedded both old + new (transition)
  async dualWrite(text: string, oldModel: string, newModel: string): Promise<KBFact> {
    const [oldEmb, newEmb] = await Promise.all([
      this.embed(text, oldModel),
      this.embed(text, newModel),
    ]);
    return { id: cryptoId(), text, embedding: newEmb, embedModel: newModel, oldEmbedding: oldEmb } as KBFact;
  }

  // Lazy re-embed — on query, if fact still old version, re-embed it
  async queryAndMigrate(query: string, newModel: string): Promise<KBFact[]> {
    const qEmb = await this.embed(query, newModel);
    const hits = await this.store.search(qEmb);
    // Lazy migrate: re-embed any stale-version facts
    await Promise.all(hits.filter((f) => f.embedModel !== newModel).map(async (f) => {
      f.embedding = await this.embed(f.text, newModel);
      f.embedModel = newModel;
    }));
    return hits;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Better embeddings (v2 recall/precision) | ❌ Reindex cost (re-embed all = $ + time) |
| ✅ Versioned — track which embed model (LA 313) | ❌ Dimension change = no compat (full reindex) |
| ✅ Dual-write — zero-downtime transition | ❌ Dual storage cost during transition |
| ✅ Lazy migrate — gradual (no big batch job) | ❌ Mixed-version similarity inconsistency |

## Khác các hướng gần

| | 325 Model-Retirement | LA (313) Incremental-KB | LN: Embedding Switch |
|---|---|---|---|
| Mục | Retire LLM | Build KB from session | **Switch embed + reindex** |
| Vector | ❌ (LLM text) | Embed new facts | **Re-embed all + migrate** |
| Version | ❌ | Session + embed tag | **Embed model tag → migrate** |

## Khi nào chọn

- Upgrade embedding model (v1→v2) — cần reindex
- KB đã version-tagged (LA 313) — biết fact nào stale
- Cần zero-downtime (dual-write or lazy)
- Nối LA (313) incremental-kb + 325 retirement + 165 dedup + packages/memory
