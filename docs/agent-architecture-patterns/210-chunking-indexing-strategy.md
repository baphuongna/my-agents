# Hướng CCCCCCCC: Chunking & Indexing Strategy — tách tài liệu đúng mức cho retrieval: parent-child, semantic

> **Nguồn gốc:** prodinit "RAG Chunking Strategies" ("Hierarchical (parent-child) chunking là hiệu suất cao nhất cho production — small chunks cho vector retrieval chính xác, parent chunks cho context"); Dell "Chunk Twice, Retrieve Once" ("cách split tài liệu ảnh hưởng trực tiếp khả năng hiểu + retrieve; poor chunking → kém"); dev.to "10 Chunking Strategies That Make or Break Your RAG" ("chunking strategy có ảnh hưởng bằng hoặc hơn embedding model selection"); TowardsAI "Parent-Child Document Architecture" (child trong parent qua sliding windows + semantic merging); insertchat (small chunks retrieval — large parent chunks cho LLM context)
> **Coupling:** 🟡 — chạm pipeline ingest + retrieval của mọi RAG
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (chunk đồng mức — chưa parent-child)
> **Effort:** 2-4 tuần

## Nguồn gốc

Chunking: **quyết định mức chia tài liệu khi index — ảnh hưởng retrieval bằng/ hơn cả chọn embedding (dev.to)** — flat chunk (đồng mức, token window) hay *parent-child*: giữ vài cấp — child nhỏ (embed để tìm chính xác) + parent lớn hơn (trả cho LLM, giữ narrative đủ ý). Dell: "Chunk Twice, Retrieve Once" — chia theo loại content (markdown, code, PDF…) phải khác. prodinit: hierarchical là high-performance nhất. Ngoài fixed-size còn semantic chunking (giữ ý đóng kín), sliding window + merge (Towards AI), GraphRAG (chuyển nodes — parent-child hơn graph?). Kết nối: **197 hybrid-search** (tận chunks), **209 rewrite** (đầu vào — sửa query), **194 rag-eval** (đo recall@K giữa chunk strategy), **38 memory-management** (index notes/context) — cùng cơ tầng. Với mya — retrieve trên doc + notes — nhưng index phẳng, child/parent chưa có.

## Kiến trúc

```
  DOC ← INGEST (many: .md, .json, code, PDF)
        │
        ▼
  SPLIT theo loại (Dell — content-type cụ thể, không 1-size)
        │
  ┌──────┤ CHILD chunks (nhỏ — để tìm đúng: sliding windows/semantic merge)
  │      └ PARENT containing pass (lớn hơn — giữ đầy đủ ý)
        │
        ▼
  EMBED (child cho retrieval — cũng embedding model)
        │
        ▼
  RETRIEVE child ──► RETURN vận parent (budget) cho LLM (insert_chat: rich context)
   · so 209 rewrite · đo 194 recall
```

```
mya: doc chunk flat — chưa hierarchy, chưa content-type split
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 197 hybrid-vector — sẵn load index cho chunk
// ✅ 194 rag-eval — sẵn đo recall mỗi strategy
// ✅ 209 rewrite — khi chunk vẫn miss
// ✅ 38 memory-management — chunk cho notes/conversation

// ❌ THIẾU: split-per-type (pdf vs markdown vs code)
// ❌ THIẾU: parent-child (2 cấp) — index child, return parent
// ❌ THIẾU: semantic-chunk (merge câu đuổi nghĩa đóng — Towards/AI)
```

## Implementation

```typescript
// packages/chunk/src/strategy.ts (NEW)
export function split(doc: Doc, type: DocType): Tree {
  const units = type === "md" ? mdBlocks(doc) : type === "pdf" ? paraBlocks(doc) : lineBlocks(doc);
  const parents = mergeSemantically(units);          // Towards-AI — kín nghĩa
  const children = parents.flatMap(slidingWindow);   // child nhỏ embed
  return { parents, children };                      // parent return, child index
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Retrieve chính xác (child) + đủ ý (parent) — "học embedding" | ❌ Ít code hơn; phải tính 2 cấp + pointer |
| ✅ Nhiều content type — mỗi loại split đúng (Dell) | ❌ Chunk sai (thừa/thiếu) làm retrieval kém dù có embedding tốt |
| ✅ Giá tốt: parent-child thường thắng flat–single (thường thắng) | ❌ GraphRAG / summar per chunk — đắt hơn, không luôn cần |

## Khác các hướng gần

| | 197 Retrieval | 209 Rewrite | CCCCCCCC: Chunk |
|---|---|---|---|
| Mục | Tra cứu index | Sửa truy vấn | **Cấu tạo index — mức chia tài liệu** |
| Vị trí | Runtime | Pre-query | **Ingest/ build index** |
| Quan hệ | Tiêu thụ | Đầu vào | **Lớp đầu của mọi RAG — ảnh hưởng recall** |

## Khi nào chọn

- Doc dài (PDF/ĐK/code) đem embedding phẳng miss
- Muốn tăng recall mà không chọn lại model embedding (dev.to: chunk>embedding)
- Đã có RAG loop đánh giá (194) — tối ưu giữa chunk size, child/parent
- Parent-child khi: cần ngữ cảnh lớn mà muốn query đúng — semantic khi tài liệu ý liền mạch