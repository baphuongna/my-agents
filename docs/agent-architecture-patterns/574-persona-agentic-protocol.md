# Hướng VB: Persona Agentic Protocol — pipeline 3 bước classify → tìm chứng cứ → trả lời theo bằng chứng (chống bịa)

> **Nguồn gốc:** nuwa-skill (persona skill pipeline); "classify question before answering"; "reference model retrieval for evidence"; "evidence-grounded answer"; "anti-hallucination three-stage pipeline" | **Coupling:** 🟡 — thêm 3-stage skill pipeline (classify → evidence-retrieve → grounded-answer) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills + tools + RAG sẵn — chưa có 3-stage classify/evidence/ground contract) | **Effort:** 3-4 tuần

## Nguồn gốc

**nuwa-skill** đặt ra rằng một Persona Skill không trả lời trực tiếp — mà chạy **pipeline 3 bước**: (1) **Classify** câu hỏi (loại query, ý định, phạm vi), (2) **Retrieve chứng cứ** theo **model tham chiếu** (kiểm tra cơ sở tri thức / source chính thống trước khi phát ngôn), (3) **Answer theo bằng chứng** (trích nguồn, không bịa). Mục đích: **chống bịa** — agent buộc có chứng cứ trước khi trả lời, mỗi claim phải có source. Nguyên tắc: **classify rồi mới tìm → tìm rồi mới trả lời** — không phát ngôn "từ đầu", không đoán mông lung. Khác **RAG thuần** (retrieve mọi câu) — VB **classify trước** để quyết định *có cần* retrieve không và retrieve *gì*; khác answer-first — VB **evidence-first**.

## Mô tả

mya persona agentic protocol: mỗi skill khai báo **3 stage** dưới dạng contract. **Stage 1 — Classify**: input query → phân loại `{ type, intent, needsEvidence }` (vd factual → cần evidence; chitchat → không). **Stage 2 — Evidence retrieve**: nếu `needsEvidence` → query retrieval/cơ sở tri thức theo model tham chiếu, thu thập nguồn, **reject nếu không đủ chứng cứ** (agent nói "tôi không biết" thay vì bịa). **Stage 3 — Grounded answer**: trả lời **chỉ** dựa trên chứng cứ thu được, kèm citation. mya có skills + tools + RAG — VB thêm **3-stage contract** + **evidence gate** (không đủ → refuse) + **citation enforcement**.

## Kiến trúc

```
  USER QUERY: "Photon có khối lượng không?"
        │
        ▼
  ┌─── STAGE 1: CLASSIFY ─────────────────────────────────┐
  │  type:    "factual-physics"                            │
  │  intent:  "fact-lookup"                                │
  │  needsEvidence: true  →  chuyển sang stage 2           │
  └───────────────────────┬─────────────────────────────┘
                          │ (needs evidence)
                          ▼
  ┌─── STAGE 2: EVIDENCE RETRIEVE (model tham chiếu) ─────┐
  │  query cơ sở tri thức → nguồn:                         │
  │    [PDG review: photon m = 0]; [textbook: massless]    │
  │  đủ chứng cứ? → YES                                    │
  │  (nếu NO → REFUSE: "không đủ nguồn để trả lời")        │
  └───────────────────────┬─────────────────────────────┘
                          │ (evidence collected)
                          ▼
  ┌─── STAGE 3: GROUNDED ANSWER (citation) ───────────────┐
  │  "Photon là hạt không khối lượng (m = 0)               │
  │   [src: PDG review; textbook ch.3]"                    │
  │  → mọi claim có source → CHỐNG BỊA                      │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — skill registry + run (nền — VB = 3-stage contract)
// ✅ packages/tools search + GE agentic-RAG — retrieval (nền — VB evidence stage)
// ✅ 394 safeguard-model-tiering — gating (relate — VB evidence gate)

// ❌ THIẾU: 3-stage skill contract (classify → evidence → grounded)
// ❌ THIẾU: classifier (query → { type, intent, needsEvidence })
// ❌ THIẾU: evidence gate (không đủ chứng cứ → refuse, không bịa)
// ❌ THIẾU: citation enforcement (mỗi claim → source)
```

## Implementation

```typescript
// packages/agent/src/persona-agentic.ts (MỚI)
type QueryType = 'factual' | 'opinion' | 'chitchat' | 'procedural';
interface Classification { type: QueryType; intent: string; needsEvidence: boolean }
interface Evidence { source: string; snippet: string }

class PersonaAgenticProtocol {
  constructor(
    private classify: (q: string) => Promise<Classification>,
    private retrieveEvidence: (q: string, c: Classification) => Promise<Evidence[]>,
    private minEvidence: number,
    private answerGrounded: (q: string, ev: Evidence[]) => Promise<string>,
  ) {}

  async run(query: string): Promise<string> {
    // Stage 1: classify
    const cls = await this.classify(query);
    if (!cls.needsEvidence) {
      // chitchat / opinion không cần evidence → trả lời trực tiếp
      return this.answerGrounded(query, []);
    }
    // Stage 2: evidence retrieve (+ gate)
    const evidence = await this.retrieveEvidence(query, cls);
    if (evidence.length < this.minEvidence) {
      // KHÔNG ĐỦ CHỨNG CỨ → refuse (chống bịa)
      return 'Tôi không có đủ nguồn đáng tin để trả lời câu hỏi này một cách chính xác.';
    }
    // Stage 3: grounded answer (citation)
    return this.answerGrounded(query, evidence);
  }
}

// Usage:
// skill.run = (q) => protocol.run(q);
// classify("Photon có khối lượng?") → { factual, needsEvidence:true }
// retrieveEvidence → [PDG, textbook]  → đủ → grounded answer + citation
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống bịa (evidence gate, refuse khi thiếu) | ❌ 3 LLM call (classify + retrieve + answer) |
| ✅ Citation (mỗi claim có source) | ❌ Classify sai → skip evidence nhầm |
| ✅ Classify tiết kiệm (chitchat không retrieve) | ❌ Refuse cảm giác "kém" (user muốn câu trả lời) |
| ✅ Traceable (biết trả lời từ nguồn nào) | ❌ Evidence stale (source cũ chưa verify) |

## Khác các hướng gần

| | RAG thuần | Answer-first | VB: Persona-Agentic |
|---|---|---|---|
| Trật tự | Retrieve mọi câu | Trả lời rồi mới find source | **Classify → evidence → grounded** |
| Chống bịa | ⚠️ | ❌ | **✅ evidence gate refuse** |
| Citation | ⚠️ | ❌ | **✅ enforce mỗi claim** |

## Khi nào chọn

- Persona/skill cần độ tin cậy cao (factual, không được bịa)
- Muốn mỗi claim có source (citation, audit được)
- Agent hay bịa khi thiếu kiến thức → cần evidence gate refuse
- Nối packages/skills + packages/tools search (GE agentic-RAG) + 394 safeguard-tiering; guard classify quality (classifier chính xác), evidence freshness (verify source chưa cũ), và refuse UX (giải thích rõ tại sao refuse, đề xuất tìm thêm); VB = persona agentic protocol, kết hợp 576 source-blacklist (lọc nguồn trước retrieve) + 575 honest-boundary (khai báo giớận — refuse là hành vi trung thực)
