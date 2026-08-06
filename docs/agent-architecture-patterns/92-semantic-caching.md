# Hướng OOOO: Semantic/Cache Response Caching — tái dùng kết quả query giống nhau

> **Nguồn gốc:** "GPT Semantic Cache" (arXiv 2411.05276); Redis LangCache 2026; GPTCache (zilliztech)
> **Coupling:** 🟡 — chèn giữa request/output, cần vô hiệu hóa đúng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (LLM client sẵn; thiếu layer cache)
> **Effort:** 1-2 tuần

## Nguồn gốc

Semantic caching: **cache response theo query** — embed request → vector similarity → trả response đã lưu khi vượt threshold (Redis LangCache 2026, GPTCache zilliztech); arXiv 2411.05276: **giảm tới 68.8% API calls**, hit rate 61-68%; spheron 2026: cut 30-70% inference cost. Hai tầng: **exact cache** (hash y hệt — giống MMMM) và **semantic cache** (embedding gần nhau → cùng response). Khác **MMMM Prompt Cache** (prefix caching transparent, không thay đổi output) — semantic cache **thay output bằng cached** (tồn rủi ro lệch => chỉ áp dụng query ổn định/deterministic). Với agent: ngoài LLM queries, áp dụng cho **tool result caching** (input khớp → result cũ, mya gọi git status lặp), và **routine sub-queries** (kiểm tra trạng thái, lookup). Cảnh báo: cache semantic cho câu hỏi cần JSON mới → sai tự phụ (cần threshold cao + TTL ngắn + vô hiệu hóa chủ động khi data đổi).

## Mô tả

mya thêm **cache layer** sau router (52/DD-48): (1) **tool result cache** — hash params + tool version → kết quả, TTL ngắn (git status, kanban poll); tương tự MCP fetch (QQ); (2) **semantic response cache** — embed query hàng routine (tra cứu doc, FAQ, state query) → threshold 0.93-0.95, TTL giới hạn → giảm LLM calls đáng kể; (3) **invalidation policy** — data thay đổi (kanban update, file write) → bust cache liên quan (nối VV audit biết thay đổi). Không cache ngầm câu hỏi động (đề xuất, lập kế hoạch — "eyeball" check). Đo hit rate + staleness (JJJ).

## Kiến trúc

```
            ┌──────────── CACHE LAYER ────────────┐
  LLM query ──► embed ──► [exact hash? ┬─ hit → cached output]
   │            │        [semantic ?   └─ miss]
  tool call ── ► params+ver hash ──► [tool result cache] (TTL ngắn)
                                            │
  miss ──► router (52) ──► LLM/tool ──► lưu cache ──► trả

  INVALIDATION (VV audit): data đổi → bust: mem.write→trace→ flush
  policy: deterministic/?ổn định? → cache; dynamic/đề xuất → skip
  metric: hit rate · staleness · cost giảm (JJJ)
```

```
mya: router/model-routing SẴN — thêm cache giữa request và execution
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai/src/model-routing.ts — tầng chèn cache tự nhiên
// ✅ gateway/mcp-reliability — fetch trùng (tool result cache tận dụng)
// ✅ packages/tools (kanban-sqlite) — poll ổn định (cache hiệu quả)
// ✅ VV audit — biết thay đổi (khóa invalidation)
// ✅ packages/memory — lưu bản để cache

// ❌ THIẾU: cache layer (exact + semantic + TTL)
// ❌ THIẾU: invalidate policy (data đổi → bust)
// ❌ THIẾU: metric staleness (JJJ)
```

## Implementation

```typescript
// packages/ai/src/semantic-cache.ts (NEW)
class SemanticCache {
  async lookup(query: string, threshold = 0.94): Promise<CachedEntry | null> {
    const vec = await embed(query);
    return nearest(vec)?.dist >= threshold ? entry : null;  // hit?
  }
  async store(query: string, output: string): Promise<void> {
    // exact (hash) + semantic (embedding) — aiechoes benchmark 2026
  }
  invalidate(trace: { data: string }): void {
    // VV: data thay đổi → bust cache liên quan (không đẻ sai kết quả)
    flushKeysByDataKey(trace.data);
  }
}
// policy rõ: query deterministic/lookup → cache;
//            đề xuất/plan → SKIP (cache sai tự phụ)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm tới 68.8% API calls (arXiv 2411.05276) | ❌ Semantic hit có thể lệch output (staleness) |
| ✅ Tool result cache — mya gọi git/kanban lặp | ❌ Embedding + vector store thêm hạ tầng |
| ✅ Query routine trả ngay, rẻ | ❐ Invalidation phải chính xác (VV audit) |
| ✅ Combo MMMM (prefix) + OOOO (response) | ❌ Câu động cache → sai tự phụ |

## Khác các hướng gần

| | MMMM Prompt Cache | AA Known-Answer | OOOO Semantic Cache |
|---|---|---|---|
| Cache loại | Prefix prompt | Answer đã biết | **Response query gần nhau** |
| Cơ chế | Provider prefix | Hardcode | **Embed + vector threshold** |
| Rủi ro | Hit phụ provider | Junk trap | **Staleness** |
| Cách dùng | Combo | AAPhobic | Combo với MMMM |

## Khi nào chọn

- Nhiều query routine trùng lặp (lookup, status, FAQ)
- Tool calls lặp lại (status/poll) — mya hay gọi
- Đã có router + memory — chèn layer ngắn
- Có invalidation tốt (VV audit) — chống kết quả cũ