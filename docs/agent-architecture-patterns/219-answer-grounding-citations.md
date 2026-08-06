# Hướng LLLLLLLL: Answer Grounding & Citation Verification — kiểm tra câu trả lời có bám đúng nguồn, chống hallucination

> **Nguồn gốc:** arXiv 2510.11394 "VeriCite: Towards Reliable Citations in RAG" (attributing RAG content qua in-line citations — "reduce hallucinations + facilitate human verification"); llmware "Automated Source Citation Verification for RAG" (tools verify sources/evidence — simple prompt methods); apxml "Reduce RAG Hallucinations" (strategies detect + mitigate hallucination — improve factual accuracy); Medium "Reducing Hallucinations & Advanced Citations" ("dùng citations link answer → source chunk — cho user verification; RAG + groundedness verification"); Stanford Legal RAG (evaluating hallucination trong legal RAG — 589 cites)
> **Coupling:** 🟡 — chạm lớp tạo output của mọi RAG
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (RAG có — chưa có groundedness check + citation link)
> **Effort:** 2-4 tuần

## Nguồn gốc

Grounding: **sau khi LLM trả lời từ context — verify từng claim khớp nguồn: nhìn lại chunk, check đối chiếu; nếu không khớp → đánh dấu/thu hồi — output kèm citation có thể kiểm** — VeriCite: inline citations "reduce hallucinations, facilitate human verification"; Stanford: framework đánh giá hallucination legal RAG (phải có citation); llmware: check evidence trước; apxml: mitigate bằng detect; Medium: "citations link answer back to source chunk, allowing user verification". Khác **194 rag-eval** (đo pipeline tổng thể — recall/faithfulness) — LLL *lúc runtime per-response* với khả năng chặn; **84 llm-as-judge** (đánh giá chất — khác) — 84 judge cho evaluation; **175 structured-output-validation** (schema — khác). Kết nối: **187 agentic-RAG** (retrieve nhiều vòng — nền), **84 llm-as-judge** đánh trích, **209 rewrite** (improve retrieval), **170 context** ghép câu hỏi.

## Kiến trúc

```
  LLM OUTPUT (câu trả lời + trích mục tiêu — source chunk ID)
        │
        ▼
  GROUNDEDNESS CHECK (từng claim đối chiếu source chunk — VeriCite-style)
        ├── KHỚP → giữ (cùng trích dẫn — user verify nguồn)
        └── KHÔNG khớp → huỷ/thay câu (giữ câu ghi nguồn)
        ▼
  CITATION (mỗi câu link về chunk gốc — user bấm kiểm tra)
        │
        ▼
  (tùy chọn) RECOVERY — self-heal (169) nếu còn budget: retrieval lại + trả đúng
```

```
mya: RAG gửi context nhưng không verify claim — thả hallucination đi ra user
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 187 agentic-RAG — retrieve + trả từng bước (nền)
// ✅ 84 llm-as-judge — sẵn đánh giá người trích (nền)
// ✅ 191 semantic cache — context quen thuộc (nền)
// ✅ 187 agentic-RAG / 209 rewrite — retrieval hiện tốt (nền)

// ❌ THIẾU: groundedness scorer (từng claim vs chunk — VeriCity style)
// ❌ THIẾU: citation format + mapping đến chunk gốc
// ❌ THIẾU: policy khi ungrounded (huỷ / rewrite / self-heal)
```

## Implementation

```typescript
// packages/grounding/src/check.ts (NEW)
export async function grounded(answer: Answer, chunks: Chunk[]): Promise<Verified> {
  const cs = await nliClaimSplit(answer);                    // tách claim~từng câu
  const ev = await Promise.all(cs.map(c => entailment(c, chunks))); // so chunk
  const bad = ev.filter(e => !e.supported);                // claim không khớp
  if (!bad.length) return { ok: true, citations: map(cs, ev) };
  return policy(bad);        // ISS: rewrite lại / thu lại câu / retry with marks
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Output đáng tin — user/business tự kiểm (Stanford tắc chịu trách) | ❌ NLI per claim: thêm latency + LLM call |
| ✅ Câu không nguồn bị chặn — giảm hallucination đáng kể | ❌ Verifier có thể từ chối câu đúng — cần tune threshold |
| ✅ Citation → accountability + hiệu chuẩn người | ❌ Code + vui: không phải mọi claim có source split |
| ✅ Xây trên 187/84/209 | ❌ Vẫn không chặn 100% — do bản chất LLM |

## Khác các hướng gần

| | 194 RAG-eval | 84 Judge | LLLLLLLL: Grounding |
|---|---|---|---|
| Mục | Đo pipeline tổng | Đánh giá chất | **Chặn/đánh dấu câu không nguồn** |
| Vị trí | Offline eval | Số lần ít | **Runtime — trước khi gửi user trực tiếp** |
| Quan hệ | Đo lường | So sánh | **Bảo vệ — nối 194 định kỳ** |

## Khi nào chọn

- Trả lời chuyên ngành luật/tài chính/y — người dùng cần nguồn đối chiếu
- Agent tự làm nhiệmvụ — không ai kiểm thật lời câu hỏi quan trọng
- Output nhập vào quy trình công việc (decision) — "bạn chịu trách" phải vững
- Không khi: output sáng tạo/không dựa nguồn — grounding là ngốn tiền vô ích