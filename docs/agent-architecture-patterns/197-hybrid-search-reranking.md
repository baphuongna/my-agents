# Hướng PPPPPPPP: Hybrid Search & Reranking — BM25 + vector + rerank: lấy đúng nhất, không bỏ sót

> **Nguồn gốc:** Qdrant "Hybrid Search with Reranking" (dense embeddings semantic + sparse keyword + rerank); YouTube "Complete Guide to Hybrid Search in RAG" (BM25 + RRF fusion + rerank top candidates); Superlinked "Optimizing RAG with Hybrid Search & Reranking" (keyword + vector + semantic rerank — precision & recall); digitalapplied "Hybrid Search Reference 2026" (embedding eval, RRF config, cross-encoder); Weaviate (native hybrid — BM25 + dense + weights)
> **Coupling:** 🟡 — retriever phải chạy 2 index + reranker
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (R RAG + KKKKKK retrieval sẵn; thiếu hybrid/rerank)
> **Effort:** 1-3 tuần

## Nguồn gốc

Hybrid search: **không tin 1 kiểu — chạy BM25 (từ khóa chính xác) + vector (nghĩa) → fusion (RRF) → rerank top bằng cross-encoder để chọn đoạn tốt nhất** — Qdrant: "dense embeddings for semantic search, sparse embeddings for keyword search, and reranking"; YouTube guide: "generating dense embeddings, fusing rankings with RRF, and re-ranking the top candidates"; Superlinked: "combining keyword search, vector search, and semantic reranking improves RAG retrieval precision and recall"; digitalapplied: production pipeline — embedding model eval, RRF fusion config, cross-encoder rerank. Điểm khác **R RAG** (retrieve-then-generate đơn giản — vector hoặc keyword) và **KKKKKK retrieval** (rewrite/query nâng cấp) — PPPPPPPP *tăng chất lượng lấy*: (1) dual index — BM25 sparse (từ khóa, tên riêng, mã số) + dense vector (nghĩa — paraphrase); (2) fusion — RRF: gộp 2 ranking (Qdrant — reciprocal rank), không cần weight chỉnh (đơn giản); (3) rerank — cross-encoder chấm lại top-K (chính xác hơn bi-encoder — digitalapplied), giữ top-N cuối; (4) tunning — thử embedding model (eval — KKKKKK), RRF k, cross-encoder; (5) production — 900k chunks scale (reddit — Milvus + BM25), filter metadata; (6) đo — MMMMMMMM RAG eval: retrieval precision/recall trước-sau hybrid (bằng chứng cải thiện). Nối R (nền), KKKKKK (query/rerank có), MMMMMMMM (đo), JJJJJJJJ (cache kết quả retrieve — đừng hybrid lại mỗi lần), WWWWWW (query type — keyword-heavy vs semantic → ưu tiên index), 187 (agentic RAG — hybrid là 1 step trong loop).

## Kiến trúc

```
  QUERY
        │
        ├── BM25 (sparse — keyword chính xác: tên, mã)  Qdrant sparse
        └── VECTOR (dense — semantic: paraphrase)        Qdrant dense
        │
        ▼
  FUSION (RRF — Qdrant/YouTube): gộp 2 ranking — không cần weight
        │
        ▼
  RERANK (cross-encoder — digitalapplied): chấm lại top-K → giữ top-N
        │
        ▼
  RAG/AGENTIC RAG (187) — dùng top-N tốt nhất (precision + recall ↑)
```

```
mya: R RAG + KKKKKK SẴN — thiếu: hybrid (BM25) + RRF + rerank
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ R RAG + vector index — dense (nền)
// ✅ KKKKKK retrieval — query rewrite (nền nâng cấp)
// ✅ MMMMMMMM RAG eval — đo precision/recall (bằng chứng)
// ✅ WWWWWW intent — biết loại query (keyword vs semantic)
// ✅ JJJJJJJJ cache — cache retrieve kết quả
// ✅ 187 agentic RAG — loop dùng retrieve (đích)

// ❌ THIẾU: BM25/sparse index (keyword search)
// ❌ THIẾU: RRF fusion (gộp ranking)
// ❌ THIẾU: cross-encoder reranker (chấm lại top-K)
```

## Implementation

```typescript
// packages/search/src/hybrid.ts (NEW)
export class HybridSearch {
  async search(q: Query, topK: number): Promise<Chunk[]> {
    const [bm25, dense] = await Promise.all([          // dual index (Qdrant)
      sparse.search(q), vector.search(q)]);
    const fused = rrf(bm25, dense, K=60);              // RRF fusion (YouTube)
    return crossEncoder.rerank(q, fused.slice(0, topK*3)); // rerank top → topK
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Precision + recall đều tốt — 2 index bù nhau (Superlinked) | ❌ 2 index + rerank — tốn tài nguyên/chi phí |
| ✅ RRF đơn giản — không tinh weight thủ công | ❐ Cross-encoder chậm — chỉ rerank top-K (không toàn bộ) |
| ✅ Keyword chính xác (tên/mã) + nghĩa đều bắt được | ❌ 2 index phải đồng bộ (chunk update cả 2) |
| ✅ Xây trên vector + KKKKKK + MMMMMMMM | ❌ Chunk nhỏ/ngắn — hybrid lợi ít |

## Khác các hướng gần

| | R RAG | KKKKKK Retrieval | PPPPPPPP: Hybrid |
|---|---|---|---|
| Index | 1 (vector/keyword) | — | **2 (BM25 + vector)** |
| Chọn lọc | — | Query | **RRF + rerank** |
| Quan hệ | Nền | Cải query | **Nâng chất lượng lấy đoạn** |

## Khi nào chọn

- Dữ liệu hỗn hợp: có tên riêng/mã (cần keyword) + văn bản (cần semantic)
- RAG precision chưa đủ — cần bằng chứng cải thiện (MMR đo)
- Scale lớn — hybrid production (900k chunks — Milvus)
- Đã có vector + KKKKKK — thêm BM25 + RRF + cross-encoder