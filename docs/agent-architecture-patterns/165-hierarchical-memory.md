# Hướng FI: Hierarchical Memory Architecture — bộ nhớ agent phân cấp (working/episodic/semantic/procedural)

> **Nguồn gốc:** IBM "What Is AI Agent Memory?" (episodic — recall past experiences); MongoDB "Agent Memory Guide" (short-term: working/semantic cache/shared; long-term: episodic/semantic/procedural/associative); mem0 "Long-Term Memory for AI Agents"; emasterlabs "Architecture and Orchestration of Memory Systems" (records of past conversations, task executions, decisions)
> **Coupling:** 🟡 — các thành phần phải đọc/ghi qua memory layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (conversation memory + knowledge base sẵn; thiếu phân cấp)
> **Effort:** 3-5 tuần

## Nguồn gốc

Hierarchical memory: **nhiều tầng nhớ khác nhau cho từng mục đích — working (ngắn, phiên), episodic (trải nghiệm), semantic (kiến thức), procedural (kỹ năng)** — IBM: "Episodic memory allows AI agents to recall specific past experiences, similar to how humans remember individual events"; MongoDB: "Short-term memory (Working Memory, Semantic Cache, Shared Memory) and long-term memory (Episodic, Semantic, Procedural, and Associative)"; mem0: "Episodic memory anchors interactions, semantic memory stores facts and preferences, procedural memory tracks behaviors"; emasterlabs: "Episodic memory stores records of past experiences — past conversations, task executions, decisions made". Điểm khác **V episodic** (nhớ từng trải nghiệm — replay) và **R facts** (sự thật dạng knowledge) — JJJJJJJ *toàn cục phân cấp*: working (ngắn hạn — session, ngữ cảnh hiện tại), episodic (chuyện đã xảy ra — IBM), semantic (kiến thức chắt lọc từ trải nghiệm — ctoi: "semantic distills patterns"), procedural (cách làm — kỹ năng đã học), associative/shared (dùng chung giữa agent — MongoDB) + **policy**: cái gì ghi tầng nào, khi nào lên semantic (chắt lọc), retention (NNNN), TTL. Nối V (episodic có rồi), R (semantic — knowledge), M (memory), WWWWWW (working — context), OOOOOO (long-term), GGGGGG (TTD — lấy từ episodic).

## Mô tả

mya hierarchical memory: (1) **working memory** — ngữ cảnh phiên hiện tại (WWWWWW session context — ngắn, token-bound); (2) **episodic memory** — log trải nghiệm có cấu trúc (V: task nào, quyết định gì, kết quả — IBM recall); (3) **semantic memory** — kiến thức chắt lọc (R + pipeline: episodic → extract → semantic — "distills patterns" ctoi), ví dụ "tool X lỗi với input Y"; (4) **procedural memory** — kỹ năng: "task loại này làm thế nào" (học từ thành công lặp lại — mem0 behaviors); (5) **shared/associative** — nhớ dùng chung nhiều agent (MongoDB Shared Memory); (6) **memory manager** — chính sách: ghi gì tầng nào, nâng cấp episodic→semantic theo tần suất, TTL + retention (NNNN), xóa (155 right-to-be-forgotten).

## Kiến trúc

```
  WORKING (ngắn): context phiên (WWWWWW) — token-bound
        │  khi xong phiên
        ▼
  EPISODIC (V): trải nghiệm có cấu trúc — "what happened when" (ctoi)
        │  chắt lọc — distills patterns (lặp lại/quant trọng)
        ▼
  SEMANTIC (R): kiến thức — facts + lessons (mem0)
  PROCEDURAL: kỹ năng — "làm loại task này thế nào" (mem0 behaviors)
  SHARED (MongoDB): dùng chung nhiều agent (associative)
        │
        ▼
  MANAGER: policy ghi/nâng cấp · TTL + retention (NNNN) · xóa (155)
```

```
mya: V + R + M + OOOOOO SẸN — thiếu: phân cấp + nâng cấp episodic→semantic
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ V episodic memory — trải nghiệm (tầng 2)
// ✅ R semantic — knowledge base (tầng 3)
// ✅ M memory — ghi/đọc (lớp dưới)
// ✅ WWWWWW intent — working context (tầng 1)
// ✅ OOOOOO long-term persistence — lưu trữ (nền)
// ✅ NNNN retention + 155 forget — TTL/xóa

// ❌ THIẾU: phân cấp rõ ràng (policy tầng nào ghi gì)
// ❌ THIẾU: episodic → semantic distillation pipeline
// ❌ THIẾU: procedural memory (kỹ năng học được)
// ❌ THIẾU: shared memory (dùng chung agent)
```

## Implementation

```typescript
// packages/memory/src/hierarchy.ts (NEW)
export class MemoryHierarchy {
  async store(exp: Experience): Promise<void> {
    episodic.save(exp);                            // V — "what happened when" (IBM)
    if (distill(exp)) semantic.merge(facts(exp));  // ctoi — patterns → R
    if (repeat(exp.type, 3)) procedural.upsert(howTo(exp)); // mem0 behaviors
  }
  async recall(q: Query, scope: MemoryScope): Promise<Ctx> {
    return fuse(working(scope), episodic.topK(q), semantic.search(q));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhớ đúng tầng đúng mục đích — context + kinh nghiệm + kỹ năng | ❌ 4-5 tầng nhớ — phức tạp thiết kế |
| ✅ Semantic giúp tránh lặp lỗi (R distills patterns) | ❐ Distillation tốn chi phí (chạy mỗi phiên) |
| ✅ Procedural — agent "biết cách làm" dần (mem0) | ❌ Trùng lặp dữ liệu giữa các tầng |
| ✅ Xây trên V + R + M + OOOOOO | ❌ Shared memory — tranh chấp + private |

## Khác các hướng gần

| | V Episodic | R Facts | JJJJJJJ: Hierarchy |
|---|---|---|---|
| Phạm vi | Trải nghiệm | Sự thật | **Toàn hệ thống nhớ (4 tầng)** |
| Cơ chế | Replay | Truy vấn | **Phân cấp + nâng cấp tự động** |
| Quan hệ | 1 tầng | 1 tầng | **Khung + policy cho cả 2** |

## Khi nào chọn

- Agent làm việc dài hạn — nhớ kinh nghiệm + học kỹ năng
- Nhiều loại thông tin (context, sự kiện, kiến thức) cần tách tầng
- Đã có V + R + M + OOOOOO — thêm policy + distillation
- Muốn agent "già lên" — càng làm càng giỏi (procedural)