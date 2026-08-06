# Hướng GE: Agentic RAG — retrieval là chuỗi quyết định: lập kế hoạch truy vấn, gọi công cụ, đối chiếu

> **Nguồn gốc:** arXiv 2501.09136 "Agentic Retrieval-Augmented Generation" (Singh 2025 — 561 cites: RAG → real-time retrieval context); AgenticRAG Survey (cardinality, control structure, autonomy, knowledge); TuringPost "20 Advanced RAG Types" (agentic RAG — retrieval là multi-step decision process — LLM plan, orchestrate); futureAGI "Agentic RAG 2026" (tool-using agents over vector DBs — query rewriting, multi-hop retrieval)
> **Coupling:** 🟡 — RAG phải qua pipeline agent (không phải 1 retrieve)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (RAG + retrieval sẵn; thiếu agentic loop)
> **Effort:** 2-4 tuần

## Nguồn gốc

Agentic RAG: **không "1 query → 1 retrieve → generate" — agent quyết: rewrite query, gọi tool/DB nào, nhiều-hop, đối chiếu, quyết định đủ không** — arXiv 2501.09136 (561 cites): "RAG ... enhancing LLMs by integrating real-time data retrieval to provide contextually grounded answers"; TuringPost: "Agentic RAG treats retrieval as a multi-step decision process rather than a single retrieve-then-generate pipeline — an LLM can plan, orchestrate"; futureAGI: "tool-using agents over vector DBs, query rewriting, multi-hop retrieval, trace and evaluate every retrieve span"; Survey 2026: categories — agent cardinality, control structure, autonomy, knowledge. Điểm khác **R RAG cơ bản** (1-shot retrieve-then-generate) và **KKKKKK retrieval** (nâng cấp query/rerank) — FFFFFFFF *vòng lặp agent*: (1) plan retrieval — agent quyết: cần nguồn gì, vài bước truy vấn (multi-hop); (2) rewrite/expand — query ban đầu viết lại (futureAGI query rewriting — ngắn gọn/khai thác); (3) tool calls — gọi vector DB + search + API (tool use — ZZZZZZZ tool graph nền); (4) verify — kết quả trả lời đủ chưa? thiếu → vòng truy vấn mới (reflection); (5) ground — trả lời bám nguồn (citations — TTTT explainable); (6) trace — mọi retrieve span log + đo (futureAGI — FAGI observability + PP eval mỗi bước). Nối R (nền RAG), ZZZZZZZ (tool graph — orchestrate retrieval), WWWWWW (intent — plan retrieval), TTTT (giải thích nguồn), QQQQQQ? (trace), PP (eval retrieval per step), 185 (tree search — exploration truy vấn).

## Kiến trúc

```
  CÂU HỎI → PLAN RETRIEVAL (LLM — multi-step decision — TuringPost)
        │
        ├── REWRITE query (futureAGI — query rewriting)
        ├── TOOL CALLS: vector DB · search · API (ZZZZZZZ — tool graph)
        ├── MULTI-HOP: kết quả hop 1 → hop 2 (Survey — knowledge)
        └── VERIFY (reflection): đủ trả lời chưa? → vòng mới / TRẢ LỜI
        │
        ▼
  GROUND + CITE (TTTT — nguồn rõ) · TRACE mọi retrieve (FAGI observability)
```

```
mya: RAG + retrieval SẴN — thiếu: agentic loop (plan/verify/multi-hop)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ R RAG — retrieve-then-generate (nền)
// ✅ KKKKKK retrieval — query rewrite/rerank (đã có 1 phần)
// ✅ ZZZZZZZ tool graph — orchestrate calls (nền tool)
// ✅ WWWWWW intent — hiểu câu hỏi (plan retrieval)
// ✅ TTTT explainable — cite nguồn (ground)
// ✅ PP eval — đo quality retrieval (per step)
// ✅ QQQQQ? trace — log (FAGI-style)

// ❌ THIẾU: plan retrieval loop (multi-step — TuringPost)
// ❌ THIẾU: verify/reflection (đủ chưa → truy vấn tiếp)
// ❌ THIẾU: multi-hop RAG (hop-to-hop truy vấn)
```

## Implementation

```typescript
// packages/rag/src/agentic.ts (NEW)
export class AgenticRAG {
  async answer(q: Question): Promise<Answer> {
    let ctx: Ctx[] = [];
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const plan = llm.plan(q, ctx);               // multi-step decision (TuringPost)
      const got = await callTools(plan);           // vector DB/search/API (ZZZZZZZ)
      ctx = merge(ctx, got);
      if (llm.sufficient(q, ctx)) break;           // verify/reflection — đủ thì thôi
    }
    return ground(q, ctx);                         // cite + TTTT
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Trả lời phức tạp — multi-hop + nhiều nguồn (561 cites) | ❌ Nhiều vòng truy vấn — cost/latency cao |
| ✅ Đúng nguồn — verify trước khi trả lời | ❐ Plan retrieval sai → vòng lặp vô ích |
| ✅ Query rewrite — hỏi đúng thứ cần (futureAGI) | ❌ Observability bắt buộc — khó debug không trace |
| ✅ Xây trên R + ZZZZZZZ + TTTT | ❌ Câu hỏi đơn giản — thừa (nên RAG thẳng) |

## Khác các hướng gần

| | R RAG | KKKKKK Retrieval | FFFFFFFF: Agentic RAG |
|---|---|---|---|
| Luồng | 1 retrieve | Improve query | **Multi-step loop (plan/verify)** |
| Quyết định | Không | 1 bước | **LLM plan + tool orchestrate** |
| Quan hệ | Nền | Nâng cấp | **Vòng lặp agent trên cả 2** |

## Khi nào chọn

- Câu hỏi phức tạp — cần nhiều nguồn/nhiều bước truy vấn
- Tri thức phân tán (docs + DB + API) — cần orchestrate
- Đã có R + ZZZZZZZ + TTTT — thêm loop plan/verify
- Chấp nhận cost/latency cho câu hỏi khó (hybrid: đơn giản → R thẳng)