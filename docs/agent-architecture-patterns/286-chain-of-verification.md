# Hướng JZ: Chain-of-Verification (CoVe) — LLM tự tạo verification plan, kiểm tra sửa sai câu trả lời

> **Nguồn gốc:** Dhuliawala et al. "Let's Verify Step by Step: Improving Factuality via Chain-of-Verification (CoVe)" (2023); OpenAI "Let's Verify Step by Step" (process reward); "self-verification"; "self-refine"; "self-check"; GW (205) self-consistency lineage
> **Coupling:** 🟢 — chỉ prompt orchestration, không chạm infra
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (chưa có CoVe loop)
> **Effort:** 0.5-1.5 tuần

## Nguồn gốc

Chain-of-Verification (CoVe, Dhuliawala et al. 2023): sau khi LLM trả câu, **tự sinh verification questions** cho từng claim → trả từng verification → nếu mâu thuẫn → sửa câu trả lời. Pipeline: (1) draft answer, (2) plan verification questions, (3) execute verification (LLM/tool), (4) revised answer nếu có mâu thuẫn. Kết quả: giảm hallucination fact đáng kể trên factual QA. OpenAI "Let's Verify Step by Step": reward theo step đúng. Self-refine/self-check: agent tự phê bình. Đối với agent: CoVe giảm sai fact — quan trọng khi trả thông tin cần chính xác. Khác **119 DO bounded self-correction** (sửa lỗi *code/tool* trong task) — JZ kiểm tra *fact* trong câu trả lời; khác **GW (205) self-consistency** (vote nhiều path) — JZ *verify từng claim* không vote; khác **JY (285) step-back** (rút principle trước) — JZ *kiểm tra sau*; khác **DO (119)** (sửa khi tool fail) — JZ sửa *hallucination*.

## Mô tả

mya chain-of-verification: sau khi agent draft câu trả lời, step LLM sinh verification-questions cho claim → trả từng câu (LLM hoặc tool/web search 223 grounding) → nếu claim bị bác → revise. Tăng factuality cho câu trả lời factual. Coupling thấp — prompt orchestration + grounding tool sẵn (223).

## Kiến trúc

```
  USER QUESTION
        │
        ▼
  DRAFT ANSWER (LLM)
        │
        ▼
  PLAN VERIFICATION QUESTIONS (LLM — "claim nào cần kiểm? câu hỏi gì?")
   · claim1 → "X có đúng ko?"   claim2 → "Y?"   claim3 → "Z?"
        │
        ▼
  EXECUTE VERIFICATION (LLM / web-search 223 / tool)
   · check each claim → ✓ confirmed / ✗ refuted
        │
        ▼
  REVISE: nếu claim ✗ refuted → sửa answer
        │
        ▼
  FINAL ANSWER (factuality cao hơn — CoVe)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 223 web search grounding — verify claim qua search (sản nền)
// ✅ 219 answer grounding/citations — cite source (sản)
// ✅ DO (119) bounded self-correction — sửa loop (sản)
// ✅ GW (205) self-consistency — vote (kết hợp)
// ✅ JY (285) step-back — principle (kết hợp)

// ❌ THIẾU: CoVe orchestration (draft → plan verify → execute → revise)
// ❌ THIẾU: verification-question generation prompt
// ❌ THIẾU: revision-on-refutation step
```

## Implementation

```typescript
// packages/cove/src/index.ts (NEW)
async function chainOfVerify(q: string, llm: LLM, ground: Ground): Promise<string> {
  const draft = await llm(`Answer: ${q}`);                       // (1) draft
  const vqs = await llm(`List verification questions for claims in: ${draft}`); // (2) plan
  const checks = await Promise.all(vqs.map(vq => ground.verify(vq)));           // (3) execute (223)
  const refuted = checks.filter(c => !c.ok);
  if (refuted.length === 0) return draft;                        // all confirmed
  return await llm(                                              // (4) revise
    `Revise this answer; these claims are wrong: ${refuted}.\nAnswer: ${draft}`,
  );
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm hallucination fact (CoVe paper) | ❌ Nhiều LLM call — cost/latency cao |
| ✅ Bắt sai claim cụ thể — sửa chính xác | ❌ Verification sai (LLM/tài liệu sai) → "confirm" sai |
| ✅ Coupling thấp — prompt + grounding (🟢) | ❌ Câu không claim rõ (sáng tạo) → verify khó |
| ✅ Kết hợp grounding 223 (fact có nguồn) | ❌ Over-verify — task đơn giản không cần |

## Khác các hướng gần

| | DO Self-Correction | GW Self-Consistency | JY Step-Back | JZ: Chain-of-Verification |
|---|---|---|---|---|
| Sửa gì | Lỗi code/tool trong task | Vote path | Rút principle | **Fact claim trong answer** |
| Khi nào | Khi tool fail | Trước answer | Trước answer | **Sau draft** |
| Cơ chế | Retry loop | Sample + vote | Abstraction | **Plan-verify-revise** |

## Khi nào chọn

- Câu trả lời cần factuality cao (QA, fact, knowledge) — CoVe giá trị
- Có grounding tool (223 web search) để verify thật
- Coupling thấp acceptable — cost multi-call đáng
- Không dùng task sáng tạo/không claim (verify khó); kết hợp JY (principle) hoặc GW (vote) nếu cần
