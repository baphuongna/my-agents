# Hướng MMMMMMMM: RAG Evaluation & Grounding Metrics — đo chất lượng RAG: faithfulness, relevancy, retrieval

> **Nguồn gốc:** DeepEval (faithfulness — LLM-as-a-judge: actual_output có align với context không); arXiv 2405.07437 "Evaluation of RAG: A Survey" (retrieval + generation — relevance, accuracy, faithfulness); Confident AI "RAG Evaluation Metrics" (answer relevancy, faithfulness, contextual relevancy); kinde "RAG Evaluation in Practice" (faithfulness = grounded trong context); Braintrust (4 core metrics: answer relevancy, faithfulness/groundedness)
> **Coupling:** 🟢 — lớp đo, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (PP eval + RAG sẵn; thiếu RAG-specific metrics)
> **Effort:** 1-2 tuần

## Nguồn gốc

RAG evaluation: **không chỉ "trả lời đúng" — đo 3 lớp: retrieval (lấy đúng không), answer relevancy (trả lời trúng hỏi không), faithfulness (có bịa ngoài context không)** — DeepEval: "faithfulness metric uses LLM-as-a-judge — evaluating whether the actual_output factually aligns with retrieved context"; arXiv 2405.07437: survey — metrics của Retrieval (relevance) + Generation (accuracy, faithfulness); Confident: context relevancy — retrieval mức nào; kinde: "faithful if the answer is supported entirely by the provided context"; Braintrust: answer relevancy + groundedness là 4 core. Điểm khác **PP eval** (chất lượng output tổng thể — dataset) và **FFFFFFF agentic RAG** (vòng lặp retrieval) — MMMMMMMM *đo 3 tầng RAG*: (1) retrieval metrics — precision/recall top-k, context relevancy (lấy trúng đoạn không — arXiv); (2) answer relevancy — trả lời có đúng câu hỏi (Confident); (3) faithfulness/groundedness — mọi claim có nằm trong context (DeepEval — chống ảo giác); (4) judge — LLM-as-a-judge (DeepEval) hay human spot-check (Meilisearch); (5) regression — đổi chunk/retriever/prompt → chạy suite, không tụt (giống RRRRRRR A/B — RAG version); (6) per-step — agentic RAG: đo mỗi retrieve span (futureAGI FAGI — trace) + citation đúng (ground truth map). Nối PP (nền eval runner), RRRRRRR (A/B — so prompt/retriever), FFFFFFFF (agentic RAG — trace per span), JJJJJJJJ (cache — đừng cache kết quả eval cũ), WWWWWW (query hiểu — relevancy), TTTT (cite nguồn — faithfulness có thể check).

## Kiến trúc

```
  RAG OUTPUT ──► ĐO 3 TẦNG (arXiv 2405.07437 survey)
        │
        ├── RETRIEVAL (Confident): context relevancy · precision/recall top-k
        ├── ANSWER RELEVANCY (Confident): có trúng câu hỏi không
        └── FAITHFULNESS (DeepEval — LLM-as-judge): claim có trong context không
        │
        ▼
  JUDGE: LLM-as-judge (DeepEval) + human spot-check (Meilisearch)
        │
        ▼
  REGRESSION (RRRRRRR): đổi retriever/chunk/prompt → chạy suite không tụt
   · agentic RAG (FFFFFFFF): đo mỗi retrieve span (FAGI trace)
```

```
mya: PP + RAG SẴN — thiếu: faithfulness/relevancy metrics
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PP eval — runner dataset (nền chạy RAG suite)
// ✅ R RAG + FFFFFFFF agentic RAG — hệ thống đo
// ✅ TTTT explain + cite — nguồn có (faithfulness dễ check)
// ✅ RRRRRRR A/B — so prompt/retriever (nền regression)
// ✅ QQQQ trace — log retrieve span (FAGI nền)
// ✅ YYY metric — dashboard (nơi hiển thị)

// ❌ THIẾU: faithfulness metric (LLM-as-judge — DeepEval)
// ❌ THIẾU: answer relevancy + context relevancy
// ❌ THIẾU: retrieval precision/recall top-k
```

## Implementation

```typescript
// packages/rageval/src/metrics.ts (NEW)
export class RAGEval {
  async run(rag: RagResult): Promise<RagScores> {
    return {
      retrieval: nDCG(rag.ctx, rag.goldHits),        // arXiv — precision/recall
      relevancy: judge.answerRelevancy(rag.q, rag.out), // Confident
      faithfulness: judge.faithfulness(rag.out, rag.ctx), // DeepEval grounded
    };
  }
  async regression(suite, newRag) {   // RRRRRRR — đổi retriever không tụt
    return compare(suite, evalAll(newRag));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt ảo giác — faithfulness: claim ngoài context bị phát hiện (DeepEval) | ❌ LLM-as-judge tốn token + thiên vị |
| ✅ Biết lỗi ở đâu — retrieval vs generation tách rõ (arXiv) | ❐ Cần ground truth/gold hits — xây tốn công |
| ✅ Regression — đổi retriever/chunk không tụt (Braintrust) | ❌ Metric điểm, không nói "sửa gì" |
| ✅ Xây trên PP + RAG + TTTT | ❌ Chỉ đo được khi có ground truth đủ |

## Khác các hướng gần

| | PP Eval | FFFFFFFF Agentic RAG | MMMMMMMM: RAG Eval |
|---|---|---|---|
| Đo gì | Output tổng | Luồng retrieval | **3 lớp RAG (retrieve/rel/groun)** |
| Chuẩn | Dataset | Trace | **Faithfulness + relevancy** |
| Quan hệ | Runner | Hệ đo | **Metric chuyên RAG** |

## Khi nào chọn

- Hệ RAG quan trọng — ảo giác là vấn đề (groundedness bắt buộc)
- Tinh chỉnh retriever/chunk/prompt — cần đo regression
- Đã có PP + RAG + TTTT — thêm faithfulness + relevancy
- Chấp nhận LLM-as-judge cost (task hiếm/đánh giá định kỳ)