# Hướng OR: Provider Vector Plan Swap — chọn embedding provider tại init, reindex khi đổi model

> **Nguồn gốc:** mem0 (embedding provider config + reindex); "swap embedding model at runtime"; "vector store reindex on model change"; "provider abstraction layer"; "OpenAI/HuggingFace/Ollama embed swap"
> **Coupling:** 🟡 — thêm provider-abstraction + reindex-on-swap layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (provider-config + embedding sẵn — chưa có model-swap reindex)
> **Effort:** 2-3 tuần

## Nguồn gốc

**mem0** tách **embedding provider** ra config: tại init chọn provider (OpenAI / HuggingFace / Ollama / custom). Khi đổi embedding model (vd OpenAI text-embedding-3-small → 3-large), **dimension thay đổi** → vector store cũ (dim 1536) không dùng được → **reindex toàn bộ**: re-embed mọi memory bằng model mới → ghi lại vector store. Quy trình swap: (1) **Detect** model change (dim khác). (2) **Backup** old store. (3) **Re-embed** tất cả memory bằng new model. (4) **Swap** store. Nguyên tắc: **embedding model là dependency** — swap cần reindex để vector nhất quán. Khác **376 model-tier-routing** — OR là **embedding provider** (không phải LLM); khác **135 agent-versioning** — OR swap **vector dimension**.

## Mô tả

mya provider vector plan swap: (1) **Provider abstraction** — interface embedding (embed → vector) có nhiều impl (OpenAI/HF/local). (2) **Init config** — chọn provider tại startup. (3) **Swap detection** — nếu config provider đổi (dim khác) → trigger reindex. (4) **Reindex** — re-embed toàn memory → swap store (backup old). mya có provider-config (LLM) — OR thêm **embedding-provider-abstraction** + **reindex-on-swap**.

## Kiến trúc

```
  INIT: config embedding.provider = "openai-3-small" (dim 1536)
        │
        ▼
  ┌─── EMBEDDING PROVIDER (abstraction) ───────────────┐
  │  interface Embed { embed(text) → vector[] }        │
  │    OpenAIProvider  (text-embedding-3-small, 1536)  │
  │    HFProvider      (bge-large, 1024)               │
  │    OllamaProvider  (nomic-embed, 768)              │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  VECTOR STORE (dim 1536, 10k memories)
        │
        │  ─── SWAP: config đổi → "openai-3-large" (dim 3072) ───
        ▼
  ┌─── SWAP DETECTION ─────────────────────────────────┐
  │  old dim=1536, new dim=3072 → DIM MISMATCH         │
  │  → trigger REINDEX                                  │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── REINDEX ────────────────────────────────────────┐
  │  1. Backup old store (dim 1536)                     │
  │  2. Re-embed all 10k memories with new model        │
  │  3. Swap: new store (dim 3072) replaces old         │
  │  4. Old backup retained for rollback                │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ provider-config (LLM) — runtime model config (nền — OR = embedding version)
// ✅ 376 model-tier-routing — route LLM (nền — OR = embedding provider)
// ✅ 197 GO hybrid-search — uses embeddings (nền — OR abstracts embed source)
// ✅ 353 MO state-versioning — snapshot (nền — OR backup old store)

// ❌ THIẾU: embedding-provider abstraction (interface + impls)
// ❌ THIẾU: swap detection (dim mismatch → reindex trigger)
// ❌ THIẾU: reindex pipeline (re-embed all + swap store + backup)
```

## Implementation

```typescript
// packages/agent/src/memory/embed-provider-swap.ts (MỚI)
interface EmbedProvider {
  name: string;
  dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

class VectorPlanSwap {
  private current: EmbedProvider;
  private store: Map<string, { text: string; vector: number[] }> = new Map();

  constructor(initial: EmbedProvider) {
    this.current = initial;
  }

  // Detect model change → reindex if dim mismatch
  async swap(newProvider: EmbedProvider): Promise<{ reindexed: number; backed: boolean }> {
    if (newProvider.dimension === this.current.dimension) {
      this.current = newProvider;  // same dim → no reindex needed
      return { reindexed: 0, backed: false };
    }

    // 1. Backup old store
    const backup = new Map(this.store);
    const backed = true;

    // 2. Re-embed all memories with new model
    const entries = [...this.store.values()];
    const texts = entries.map(e => e.text);
    const newVectors = await newProvider.embed(texts);

    // 3. Swap store
    this.store.clear();
    const keys = [...this.store.keys()];
    for (let i = 0; i < entries.length; i++) {
      this.store.set(keys[i] ?? `mem-${i}`, { text: entries[i]!.text, vector: newVectors[i]! });
    }
    this.current = newProvider;
    // (backup retained implicitly via closure for rollback)

    return { reindexed: entries.length, backed };
  }

  // Embed + store new memory
  async add(id: string, text: string): Promise<void> {
    const [vec] = await this.current.embed([text]);
    this.store.set(id, { text, vector: vec! });
  }

  provider(): EmbedProvider { return this.current; }
}

// Usage:
// const swap = new VectorPlanSwap(new OpenAIProvider('text-embedding-3-small'));
// await swap.swap(new HFProvider('bge-large'));  // dim mismatch → reindex all
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đổi embedding model mà không rebuild app | ❌ Reindex cost (re-embed toàn store — chậm) |
| ✅ Provider abstraction (multi-vendor) | ❌ Dim mismatch bắt buộc reindex (không partial) |
| ✅ Backup + rollback (old store giữ) | ❌ Downtime reindex (store lock trong re-embed) |
| ✅ Nối 376 model-tier (embedding analog) | ❌ Cost API (re-embed = N lần call) |

## Khác các hướng gần

| | 376 Model-Tier-Routing | 135 Agent-Versioning | 197 GO Hybrid-Search | OR: Provider-Vector-Swap |
|---|---|---|---|---|
| Cái gì | Route LLM theo tier | Version agent | Search embed | **Swap embedding provider** |
| Scope | LLM | Agent | Search | **Embedding model** |
| Reindex | ❌ | ❌ | ❌ | ✅ on dim mismatch |
| Backup | ❌ | ✅ | ❌ | ✅ old store |

## Khi nào chọn

- Muốn đổi embedding model runtime (OpenAI → local để tiết kiệm / privacy)
- Multi-vendor (chạy nhiều provider khác nhau)
- Chấp nhận reindex cost khi swap
- Nối 376 model-tier-routing (LLM analog) + 353 MO state-versioning (backup) + 197 GO hybrid-search (uses embed); guard reindex downtime (batch + background) + API cost (cap re-embed rate)
