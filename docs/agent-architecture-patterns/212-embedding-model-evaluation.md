# Hướng EEEEEEEE: Embedding Model Evaluation — chọn & đánh giá model embedding đúng dữ liệu, đo recall/NDCG

> **Nguồn gốc:** OpenLayer "Embedding Model Benchmarking Guide" (retrieval quality metrics — "how well embeddings surface relevant content in search/RAG pipelines"); arXiv 2607.23507 "Choosing a Text Embedding Model" (T3EM đạt retrieval quality cao nhất — average nDCG@10 = 0.638 — nhưng cost 7-14×); Weaviate "Evaluation Metrics for Search" (recall@K — "how many relevant items retrieved from the dataset"; MTEB); aimultiple "Open Source Embedding Models Benchmark for RAG" (14 models, 500+ curated queries, legal contracts, Recall@10); unstructured "Best Embedding Model for RAG" (NDCG@10 widely used)
> **Coupling:** 🟢 — độc lập, chỉ chạm bước embedding trong ingest/retrieval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (embeddings đang dùng mặc định — chưa benchmark trên data riêng)
> **Effort:** 1-3 tuần

## Nguồn gốc

Embedding eval: **không chọn model theo marketing — benchmark trên *dữ liệu của bạn* (queries thật + gold chunks) rồi đo recall@K/NDCG — vì model tối nhất (T3EM) đắt 7-14× nhưng chỉ hơn vài điểm** — OpenLayer: retrieval quality metrics — align với RAG; arXiv 2607.23507: T3EM cao nhất (nDCG 0.638) nhưng cost 7-14× — tradeoff rõ; Weaviate: recall@K + MTEB; aimultiple: tự benchmark 14 models trên data ngành (contracts) — model "hot" không phải luôn thắng data riêng; unstructured: nDCG@10 tiêu chuẩn. Điểm khác **194 rag-eval** (đo *cả pipeline* RAG — answer quality) — EEE đo *chỉ riêng embedding/retrieval*; **197 hybrid** (thiết kế retrieve — dùng embedding đã chọn); **209 rewrite** (sửa query — không thay embedding). Kết nối: **38 memory-management** (dùng embedding cho memory/context — nên cùng đánh giá), **41 eval-harness** (chạy benchmark), **210 chunk** (chunk strategy ảnh hưởng recall hơn cả embedding — benchmark phải cùng chunk).

## Kiến trúc

```
  GOLD SET (queries thật + chunks liên quan — do bạn tạo/annotate 50-100)
        │
        ▼
  BENCHMARK (embed cùng set qua N models — MTEB-style, on your data)
     · metrics: recall@K · nDCG@10 · MRR
        │
        ▼
  COMPARE (điểm + cost + latency/vector — arXiv: cost 7-14×)
        │
        ▼
  PICK (chọn model đủ điểm trong ngân sách — not the "best" blindly)
        │
        ▼
  ROLLOUT (đổi embedding → reindex (210) → track qua 41)
```

```
mya: embedding fixed — chưa có gold set + bench trên data thật
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 41 eval-harness — sẵn khung chạy đo
// ✅ 194 rag-eval — sẵn đo pipeline (nhưng embedding riêng chưa)
// ✅ 197 hybrid search — sẵn nơi thay embedding
// ✅ 38 memory-management — cùng nơi dùng embedding

// ❌ THIẾU: gold set (queries + chunks đúng — cần annotate)
// ❌ THIẾU: bench runner (chạy N model trên cùng set)
// ❌ THIẾU: decision gate (điểm vs cost/latency — arXiv tradeoff)
```

## Implementation

```typescript
// packages/embedbench/src/bench.ts (NEW)
export async function chooseEmbedding(gold: GoldSet): Promise<EmbedChoice> {
  const rows = await Promise.all(CANDIDATES.map(async (m) => ({
    m, recall: await recallAtK(m, gold, 10),         // Weaviate metric
    cost: m.pricePerToken, lat: await lat(m),
  })));
  return pickPareto(rows);    // không "best" — theo ngân sách (arXiv trade)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết model nào đúng data mình — recall + tới đâu (aimultiple) | ❌ Cần làm gold set + chạy bench — công ban đầu |
| ✅ Khỏi tốn 7-14× cho model "top" không cần thiết (arXiv) | ❌ Đo không tốt (gold sai) → chọn sai embedding |
| ✅ Bắt trước: benchmark trước → sau đó mới đổi — ít rủi | ❌ Reindex khi đổi model — tốn công + thời gian |
| ✅ Xây trên 41/194/197 | ❌ Chỉ tối ưu 1 khâu — chunk (210) vẫn quan trọng hơn |

## Khác các hướng gần

| | 194 RAG-eval | 197 Hybrid | EEEEEEEE: Embed-eval |
|---|---|---|---|
| Mục | Đo chất answer cả pipeline | Thiết kế retrieval | **Chọn/chấm model embedding** |
| Phạm vi | End-to-end | Retrieval runtime | **Chỉ khâu embedding** |
| Quan hệ | Bao toàn | Nơi dùng | **Lựa chọn cơ sở — sau đó 197 dùng** |

## Khi nào chọn

- Chưa từng benchmark embedding trên data riêng — đang dùng model "mặc định"
- Chất lượng retrieval lõm mà không biết tại embedding hay chunk (210)
- Sắp chọn model mới / muốn giảm cost — cần số liệu thay cho cảm giác
- Không khi: đang ổn, không đổi gì — tránh công vô ích