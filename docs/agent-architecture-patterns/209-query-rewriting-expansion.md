# Hướng HA: Query Rewriting & Expansion — LLM chỉnh lại câu hỏi trước khi retrieval cho RAG tốt hơn

> **Nguồn gốc:** Meilisearch "Query rewriting for RAG" (rewrite cải thiện retrieval accuracy, giảm hallucination); Elastic Search Labs "Query rewriting strategies" (LLM-generated keywords, pseudo-answers, enriched terms — concrete QR strategies); arXiv 2407.12529 "Crafting the Path: Robust Query Rewriting" ("generate a new query that complements the original to improve the IR system"); AnyScale "Retrieval strategies" ("rewrite + expansion: correct spelling, expand acronyms, clarify ambiguities, add synonyms"); gopenai "LLM-Based Query Rewriting and HyDE"
> **Coupling:** 🟢 — thuần ở bước pre-retrieval, không đụng agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (hybrid search — chưa có tầng viết lại query)
> **Effort:** 1-2 tuần

## Nguồn gốc

Query rewriting: **trước khi vector/BM25 chạy, một LLM nhỏ viết lại câu hỏi — sửa chính tả, khai triển acronym, thêm từ đồng nghĩa, tách truy vấn mơ hồ — giúp retrieval đúng intent** — Meilisearch: "improves retrieval accuracy, reduces hallucinations"; Elastic: strategies cụ thể — keywords do LLM sinh, pseudo-answers (HyDE — viết câu trả lời giả rồi dùng làm query), enriched terms; arXiv 2407.12529: robust — rewrite bổ sung chứ không thay; AnyScale: acronyms, ambiguity. Điểm khác **197 hybrid-search** (BM25+vector+rồi rerank — *phía sau* truy vấn): rewrite là *đầu vào*; **84 llm-as-judge** (đánh giá kết quả — không viết lại); **178 routing** (chọn model — khác mục đích). Kết nối **41 eval-harness** (đo retrieval trước/sau rewrite), **191 kv-semantic-cache** (query rewrite giống key — có thể cache cho các query giống nhau), **25 query-planner** (tách câu hỏi con — dạng "expansions").

## Kiến trúc

```
  RAW QUERY (người dùng/agent: "tóm tắt dự án ABC" — ngắn, mơ hồ)
        │
        ▼
  REWRITER (LLM nhỏ — 1-2 call: sửa lỗi, khai acronym, đồng nghĩa)
     · dạng: 1 query / multi-query (tách nhánh) / HyDE (pseudo-answer)
        │
        ▼
  RETRIEVAL (197: BM25 + vector — ăn query đã viết lại)
        │
        ▼
  RERANK (197) ──► CONTEXT (RAG) ──► answer
   · so trước/sau bằng 41 eval-harness — giữ rewrite nếu retrieval +%
```

```
mya: query đi thẳng vào hybrid — chưa có pre-step
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 197 hybrid-search + rerank — retrieval phía sau sẵn
// ✅ 191 kv-semantic-cache — sẵn cache query giống nhau
// ✅ 84 llm-as-judge — sẵn để so kết quả 2 nhánh
// ✅ 194 rag-eval — sẵn khung đo

// ❌ THIẾU: rewritter service (1 LLM call nhỏ trước retrieval)
// ❌ THIẾU: chế độ multi-query (tách câu hỏi con — gộp kết quả)
// ❌ THIẾU: A/B so sánh rewrite vs raw (gating — bật khi tốt hơn)
```

## Implementation

```typescript
// packages/queryrewrite/src/rewrite.ts (NEW)
export async function rewrite(q: string, mode: "single" | "multi" | "hyde"): Promise<string[]> {
  const queries = await smallLLM.call({ role: "rewriter", prompt: q, mode });
  // single: 1 query chuẩn; multi: expand thành vài chùm;
  // hyde: sinh pseudo-answer rồi dùng làm vector query (gopenai)
  return queries;   // cache theo (q, mode) — 191
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Retrieval +% rõ (Meilisearch) — giảm hallucination do miss context | ❌ Thêm 1 call LLM (latency/chi phí) trước mỗi retrieval |
| ✅ Có nhiều chế độ — multi-query phủ intent nhiều nghĩa | ❌ Rewrite sai có thể *dịch chuyển* kết quả — cần gating |
| ✅ Rẻ (LLM nhỏ) — độc lập với agent | ❌ HyDE tốn token hơn (viết cả câu trả lời giả) |
| ✅ Xây trên 197/191/84 | ❌ Không cứu retrieval index kém — chỉ tối ưu mặt query |

## Khác các hướng gần

| | 197 Hybrid | 84 Judge | BBBBBBBB: Rewrite |
|---|---|---|---|
| Mục | Tìm context (BM25+vector+rerank) | Đánh giá đáp án | **Sửa/thác query trước khi tìm** |
| Vị trí | Retrieval | Sau output | **Pre-retrieval — đầu vào** |
| Quan hệ | Nền tảng | Đánh giá | **Đeo trước — cải thiện cả 197** |

## Khi nào chọn

- Query người dùng ngắn/không chuẩn (acronym, lỗi chính tả, mơ hồ)
- Retrieval đã tốt nhưng miss do từ khóa không khớp
- Đo được bằng 41 eval-harness: giữ rewrite khi recall tăng, tắt khi không
- HyDE chỉ dùng khi embedding đồng nghĩa yếu; multi-query khi intent đa nghĩa