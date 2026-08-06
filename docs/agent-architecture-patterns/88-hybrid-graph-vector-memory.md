# Hướng CJ: Hybrid Graph+Vector Memory — vừa tìm gần đúng, vừa suy luận quan hệ

> **Nguồn gốc:** "Graph-based Agent Memory: Taxonomy, Techniques" (arXiv 2602.05665, 2026); atlan/digitalapplied 2026
> **Coupling:** 🟡 — đọc/ghi có 2 index
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/memory sẵn text; thiếu graph index)
> **Effort:** 2-3 tuần

## Nguồn gốc

"Most 'memory' in production agents is a vector database with a nice name" (Neural Maze 2026). Hybrid memory — **vector + temporal knowledge graph** cùng lớp: vector cho semantic similarity, graph cho entity/relationship traversal + temporal (quan hệ thay đổi theo thời gian). atlan 2026: "Microsoft GraphRAG and Zep's temporal knowledge graph are the two most widely adopted hybrid implementations in production as of 2026"; digitalapplied 2026: "Hybrid is the dominant 2026 pattern — vector memory for recall, graph for relationships". arXiv 2602.05665 taxonomy: graph memory vượt trội "applications requiring multi-session reasoning". Khác **MM 3 tầng text** (lưu ghi chép đọc lại — *raw note retrieval*) — hybrid là **index chuyên dụng**: trích entity + quan hệ (entity/relationship extraction), lưu graph (mối quan hệ truy vết được), gộp vector (similarity search). Reddit 2026 cảnh báo: nhiều memory layer làm cùng 1 việc (extract entity → dump graph) — cần kỷ luật: graph chỉ khi cần suy luận quan hệ.

## Mô tả

mya memory thành 2 index đồng bộ (nối MM): **vector index** (hiện có — ghi chép, tìm gần đúng) + **graph index**: trích entity (người, dự án, quyết định) + quan hệ (thuộc, phụ thuộc, quyết định bởi) + temporal edge (quan hệ đổi khi nào). Query 2 chế độ: (1) recall — cosine (như MM); (2) reasoning — bắt đầu từ entity, traverse graph ("dự án X phụ thuộc ai?", "ai quyết định Y?"). Hợp nhất: vector top-k → entities → graph expand. Graph đổi = versioned (nhánh quan hệ cũ vẫn tra). Tránh bẫy "dump graph không có người dùng": chỉ trích entity khi query cần quan hệ.

## Kiến trúc

```
  packages/memory ──▶ [MM: text notes]── recall: cosine (như cũ)
                  └─▶ GRAPH INDEX (entity/relationship/temporal)
                         ▼ trích từ note + tool calls
        node: {project, person, decision}  edge: {depends, decides, owns}
        temporal: {validFrom, validTo}     versioned

  QUERY 2 chế độ:
  1. recall: "đã ghi gì về X" → vector top-k (MM)
  2. reasoning: "X phụ thuộc gì" → traverse graph từ entity X
  hợp nhất: vector top-k → extract entities → graph expand → context
```

```
mya: packages/memory SẴN (text — recall). thiếu: graph index + entity extraction
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — tầng text (MM) — nền vector recall
// ✅ packages/core — entity sẵn (tool names, task refs)
// ✅ EEEE consolidation — dọn ghi chép (trích entity tự nhiên)

// ❌ THIẾU: graph store (node/edge/temporal) + traversal
// ❌ THIẾU: entity/relationship extraction pipeline
// ❌ THIẾU: query kép (recall + reasoning) — hiện chỉ recall
// ❌ THIẾU: versioning quan hệ (edge đổi — EEEE temporal)
```

## Implementation

```typescript
// packages/memory/src/graph-memory.ts (NEW)
interface GraphMemory {
  upsertNote(note: TextNote, entities: ExtractedEntity[]): void;
  upsertEdge(from: EntityId, to: EntityId, rel: string, validFrom: Date): void;
}

function queryMemory(mem: GraphMemory, q: string): Context[] {
  const { top, entities } = recallVector(mem, q);         // 1. recall (MM)
  const related = traverse(mem, entities, hops: 2);       // 2. graph expand
  return merge(top, related);                             // context tổng hợp
}

function extractEntities(note: TextNote): ExtractedEntity[] {
  // LLM trích entity/quan hệ khi ghi — kỷ luật: chỉ khi cần reasoning
  // versioned: edge validFrom/validTo — quan hệ cũ vẫn tra được
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Recall + reasoning — 2 chế độ hỏi memory | ❌ Chi phí entity extraction (LLM calls) |
| ✅ Quan hệ truy vết được ("X phụ thuộc gì") | ❌ Bẫy dump-graph vô dụng (reddit 2026) |
| ✅ Temporal edge — quan hệ thay đổi | ❌ 2 index đồng bộ phức tạp hơn MM |
| ✅ Pattern chuẩn 2026 (GraphRAG/Zep) | ❌ mya ghi chú ít quan hệ — giá trị thấp hơn recall |
| ✅ Nối EEEE (consolidation sinh entity) | |

## Khác các hướng gần

| | MM Memory 3 tầng | EEEE Consolidation | KKKK: Hybrid |
|---|---|---|---|
| Lưu gì | Ghi chú text | Dọn nội dung | **Entity + quan hệ (graph)** |
| Truy vấn | Recall (cosine) | — | **Recall + traversal** |
| Mối quan hệ | Nền tảng | Nuôi KKKK | **Index chuyên dụng trên MM** |

## Khi nào chọn

- Hỏi về quan hệ thường xuyên ("ai/dự án nào/ảnh hưởng gì")
- Nhiều entity ổn định (dự án, người, quyết định) — graph có giá trị
- Đã có MM — thêm graph index chứ không thay
- Kỷ luật extraction: chỉ trích khi query cần reasoning