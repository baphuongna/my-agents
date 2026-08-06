# Hướng BF: Agentic RAG — retrieval do agent điều khiển

> **Nguồn gốc:** 2024-2025 (Agentic RAG; Neo4j/LangChain phổ biến hóa); kế thừa RAG (Lewis 2020)
> **Coupling:** 🟢 — agent ↔ index qua tool call
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (cần index mới; memory/skills chỉ là 1 phần nhỏ)
> **Effort:** 2-3 tuần

## Nguồn gốc

RAG cổ điển (Lewis et al. 2020): retrieve 1 lượt → generate. Kém khi: query mơ hồ, cần nhiều bước truy, cần chọn nguồn. **Agentic RAG**: agent **điều khiển toàn bộ vòng retrieval** — tự quyết *có cần search không*, *tinh chỉnh query thế nào*, *chạy nhiều retrieval song song*, *đánh giá kết quả đã đủ chưa*, *dừng khi đủ*. Là pattern nền của GraphRAG (Microsoft 2024) khi thêm traversal đồ thị. Khác NN Cache Layer (lặp lại 1 query) và MM Memory (lịch sử agent) — Agentic RAG là *lấy tri thức ngoài một cách chủ động*.

## Mô tả

mya gặp câu hỏi cần tri thức ngoài (docs về pattern, source code cũ) → **retriever tool** (search skills/index) được gọi **nhiều lần theo quyết định của agent**, không phải 1 lần trước prompt: agent đánh giá "kết quả này đã trả lời chưa", đổi query, thử nguồn khác, gộp nhiều retrieval. Mỗi lần retrieve là 1 tool call như mọi tool khác (mya đã có MCP search/skills). Kết hợp YY Knowledge Compilation: tri thức truy hồi tốt nhất được compile thành skill để lần sau không cần search lại.

## Kiến trúc

```
  question ──► AGENT (điều khiển retrieval)
                  │ "cần tri thức?" ── không ──► trả lời bằng context
                  ▼ có
             TOOL search(q1) ──► đánh giá: đủ chưa?
                  │ chưa ──► tinh chỉnh q2 ──► TOOL search(q2) (song song được)
                  │ đủ
                  ▼
             gộp kết quả ──► TOOL search cho phần còn thiếu
                  ▼
             trả lời + cite nguồn (provenance)
                  │ tri thức lặp lại ──► YY: compile thành skill
```

```
mya: MCP search (firecrawl/jina) + skills sẵn = retrieval surface hiện có
     ❌ chưa có index nội bộ cho source code/docs của chính mya
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ MCP search tools (firecrawl) — retrieval bên ngoài
// ✅ packages/skills — nơi compile tri thức sau khi truy hồi (YY)
// ✅ packages/memory — lưu Q&A đã tổng hợp (MM)
// ✅ packages/tools — tool call loop (provider/constraints) — vòng retrieval là tool loop

// ❌ THIẾU: index nội bộ (vector/BM25) cho docs + source code của mya
// ❌ THIẾU: retriever-tool chuẩn (trả provenance, tự đánh giá đủ/chưa)
// ❌ THIẾU: vòng lặp query-refine gắn vào tool loop hiện có
```

## Implementation

```typescript
// packages/tools/src/retriever.ts (NEW)
interface RetrievalState {
  question: string;
  queries: string[];
  sources: Array<{ text: string; url: string; score: number }>;
}

async function retrieveUntilSatisfied(question: string): Promise<RetrievalState> {
  const state = { question, queries: [question], sources: [] };
  for (let i = 0; i < 5; i++) {
    const hits = await search(state.queries[i]);          // MCP/firecrawl/index nội bộ
    state.sources.push(...hits);
    const verdict = await judgeCoverage(question, state.sources, state.queries[i]);
    if (verdict.done) break;                               // đủ → dừng
    state.queries.push(refineQuery(verdict.gap));          // còn thiếu → query khác
  }
  await probeProvenance(state);                            // examine, đánh giá
  return state;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Trả lời đúng chỗ tri thức ngoài, cite nguồn | ❌ Nhiều tool call → chi phí, latency |
| ✅ Tự quyết không cần search (tiết kiệm) | ❌ Query-refine sai → search sai hướng |
| ✅ Graph view: đủ → dừng sớm (so với RAG vật lý) | ❌ Cần index tốt — xây index là công sức |
| ✅ Mở rộng GraphRAG sau (traversal đồ thị) | ❌ Provenance kém → học nhầm |
| ✅ MCP search sẵn — làm retriever tool là chính | |

## Khác các hướng gần

| | NN Cache Layer | MM Memory Mgmt | GGG: Agentic RAG |
|---|---|---|---|
| Lấy gì | Kết quả đã tính | Lịch sử agent | Tri thức ngoài / docs |
| Khi nào | Query lặp lại | Context quá dài | Cần info ngoài context |
| Ai điều khiển | Cache key | Policy | **Agent** (query-refine) |
| Mối quan hệ | Bổ trợ (cache hit) | Bổ trợ | YY: tri thức → compile skill |

## Khi nào chọn

- Câu hỏi phụ thuộc tri thức ngoài context (docs, source, spec)
- Đã có MCP search làm retrieval surface
- Muốn provenance (trích nguồn) đáng tin cậy
- Sẵn sàng xây index nội bộ cho source/docs của mya