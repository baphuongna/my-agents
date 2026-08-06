# Hướng JY: Step-Back Prompting — hỏi câu trừu tượng/tổng quát trước, rồi giải cụ thể

> **Nguồn gốc:** Zheng et al. "Take a Step Back: Evoking Reasoning via Abstraction in Large Language Models" (Google DeepMind, 2023); "step-back prompting" (ask general principle first); "abstraction then instantiation"; few-shot with principles; Anthropic "let's think step by step" lineage
> **Coupling:** 🟢 — chỉ thay prompt, không chạm infra
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (chưa có step-back prompt template)
> **Effort:** 0.5-1 tuần

## Nguồn gốc

Step-back prompting (Zheng et al., Google DeepMind 2023): thay vì trả câu cụ thể ngay, LLM **rút câu hỏi trừu tượng/tổng quát trước** ("nguyên lý chung là gì?") → lấy principle → rồi áp principle giải câu cụ thể. VD câu "nhiệt độ sôi của Saturn tăng hay giảm?" → step-back "nguyên lý nào quyết định nhiệt độ sôi?" → "độ lớn lực hấp dẫn" → áp giải cụ thể. Kết quả DeepMind: tăng chính xác đáng kể trên STEM/KB. Abstraction-then-instantiation: tổng quát hóa giảm overfit vào chi tiết rối. Khác **DU (125) structured reasoning** (output có cấu trúc) — JY *chiến thuật prompt* (rút trừu tượng trước); khác **GW (205) self-consistency** (sinh nhiều path vote) — JY *một path sâu hơn*; khác **JZ (286) chain-of-verification** (tự kiểm tra) — JY *chữa trước* bằng principle đúng; khác **KA (287) PAL** (dùng code tính) — JY dùng *reasoning tự nhiên*.

## Mô tả

mya step-back prompting: cho task cụ thể phức tạp → thêm step LLM rút "step-back question" (principle/general) → trả principle → ráp principle + câu cụ thể → giải. Tăng chính xác cho task cần domain knowledge (STEM, quy trình, định lý). mya chỉ cần prompt template + 2-step LLM call — coupling thấp.

## Kiến trúc

```
  SPECIFIC QUESTION ("nhiệt độ sôi Saturn tăng hay giảm?")
        │
        ▼
  STEP-BACK EXTRACTION (LLM)
   "What's the underlying principle?" → "độ lớn lực hấp dẫn quyết định nhiệt độ sôi"
        │
        ▼
  PRINCIPLE / FACT (trừu tượng, đáng tin hơn)
        │
        ▼
  RÁP: [specific question] + [principle] → FINAL ANSWER (LLM)
        │
        ▼
  ANSWER (chính xác hơn — dựa principle đúng, không đoán chi tiết rối)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ DU (125) structured reasoning — output có cấu trúc (sản — ráp được)
// ✅ provider layer — 2-step LLM call (sản)
// ✅ GW (205) self-consistency — có thể kết hợp (vote path)
// ✅ 100 CV compression — prompt tối ưu (bổ sung)

// ❌ THIẾU: step-back prompt template (rút câu trừu tượng)
// ❌ THIẾU: 2-step orchestration (extract principle → apply)
// ❌ THIẾU: heuristic chọn task nào đáng step-back
```

## Implementation

```typescript
// packages/stepback/src/index.ts (NEW)
const STEPBACK = `You are an expert. Given a question, infer the underlying general principle/fact
that helps answer it. Output only the principle.\nQuestion: {q}\nPrinciple:`;
async function stepBack(q: string, llm: LLM): Promise<string> {
  const principle = await llm(STEPBACK.replace("{q}", q));   // rút câu trừu tượng
  const final = await llm(                                   // ráp principle + câu cụ thể
    `Principle: ${principle}\nQuestion: ${q}\nAnswer using the principle:`,
  );
  return final;                                              // chính xác hơn (DeepMind)
}
// chỉ áp dụng task cần domain knowledge — task đơn giản không cần (waste)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tăng chính xác task cần domain knowledge (DeepMind) | ❌ 2 LLM call — cost/latency tăng |
| ✅ Principle đúng chữa sai chi tiết rối | ❌ Task đơn giản không cần → waste |
| ✅ Coupling thấp — chỉ prompt (🟢) | ❌ Step-back extraction sai → principle sai dẫn sai |
| ✅ Kết hợp GW (vote) / DU (cấu trúc) | ❌ Cần heuristic chọn task nào đáng |

## Khác các hướng gần

| | DU Structured Reasoning | GW Self-Consistency | JZ Chain-of-Verify | JY: Step-Back |
|---|---|---|---|---|
| Cái gì | Output cấu trúc | Vote nhiều path | Tự kiểm tra sửa | **Rút trừu tượng trước** |
| Cơ chế | Format | Sample + vote | Verify loop | **2-step abstraction** |
| Mục | Tái dùng được | Chọn đa số | Bắt lỗi | **Principle đúng trước** |

## Khi nào chọn

- Task cần domain knowledge/principle (STEM, quy trình, định lý) — step-back có giá trị
- LLM hay đoán sai chi tiết rối — principle giúp
- Coupling thấp acceptable (chỉ prompt) — cost 2 call đáng
- Không dùng task đơn giản/factual lookup (waste); kết hợp GW (vote path) hoặc JZ (verify) nếu cần chính xác hơn
