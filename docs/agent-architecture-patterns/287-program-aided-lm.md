# Hướng KA: Program-Aided Language Models (PAL) — LLM sinh code tính toán, chạy code ra đáp án chính xác

> **Nguồn gốc:** Gao et al. "PAL: Program-aided Language Models" (2023); "chain of thought with code"; Python code-interpreter for math reasoning; "LLM bad at arithmetic, good at code"; OpenAI Code Interpreter; Chen et al. "Program of Thoughts"
> **Coupling:** 🟡 — cần code-exec sandbox (EC/JN) + code-gen prompt
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (code-exec tool + sandbox sẵn — chưa có PAL orchestration)
> **Effort:** 1-2 tuần

## Nguồn gốc

Program-Aided Language Models (Gao et al. 2023): LLM **kém số học** (arithmetic, logic phức) nhưng **giỏi viết code** → thay vì bắt LLM tính trực tiếp, LLM *sinh code* (Python) giải bài → chạy code ra đáp án chính xác. PAL vượt CoT thuần trên math/reasoning benchmark. Lý do: LLM token-by-token không đáng tin cho tính toán đa bước; code interpreter deterministic. OpenAI Code Interpreter: LLM sinh + chạy code trong sandbox. Program of Thoughts (Chen): tương tự. Đối với agent: task tính toán (toán, thống kê, logic, data manipulation) → LLM sinh code → chạy trong sandbox (EC 133 / JN 274) → đáp án chính xác. Khác **DU (125) structured reasoning** (output text cấu trúc) — KA output là *code runnable*; khác **JY (285) step-back** (reasoning tự nhiên) — KA *delegate tính toán cho runtime*; khác **JZ (286) verification** (tự kiểm tra) — KA *tránh sai tính toán* bằng code; khác **JN (274) containerized** (sandbox) — KA *dùng* sandbox để chạy code.

## Mô tả

mya PAL: khi task cần tính toán chính xác, prompt LLM sinh code (Python) → chạy trong sandbox (EC/JN) → thu output làm đáp án. Tránh sai số học của LLM. mya có code-exec tool + sandbox (EC) — KA thêm PAL orchestration (detect task tính toán → code-gen → run → parse output).

## Kiến trúc

```
  TASK (toán / thống kê / logic / data)
        │
        ▼
  CODE GEN (LLM — "viết Python giải bài này")
   → sinh code (deterministic khi chạy)
        │
        ▼
  SANDBOX EXEC (EC 133 / JN 274 — cô lập, an toàn)
   → chạy code → output (chính xác — không phải LLM guess)
        │
        ▼
  PARSE OUTPUT → ANSWER
   (nếu code lỗi → feedback LLM sửa + retry — DO 119)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ code-exec tool + EC (133) sandbox — chạy code an toàn (sản nền)
// ✅ JN (274) containerized — isolation tinh hơn (sản)
// ✅ DO (119) bounded self-correction — sửa code lỗi (sản)
// ✅ DU (125) structured output — parse (bổ sung)

// ❌ THIẾU: PAL orchestration (detect task tính → codegen → run)
// ❌ THIẾU: code-gen prompt template (PAL)
// ❌ THIẾU: output-parse + retry-on-code-error
```

## Implementation

```typescript
// packages/pal/src/index.ts (NEW)
const PAL = `Write Python that solves this. Print only the final answer as JSON.\nProblem: {p}\nCode:`;
async function pal(problem: string, run: (code: string) => Promise<string>): Promise<unknown> {
  const code = await llm(PAL.replace("{p}", problem));           // sinh code (not guess)
  for (let i = 0; i < 3; i++) {
    try {
      const out = await run(code);                               // sandbox EC/JN — chính xác
      return JSON.parse(out);                                    // đáp án deterministic
    } catch (e) {                                                // code lỗi → sửa (DO 119)
      const fixed = await llm(`Fix this code: ${code}\nError: ${e}`);
    }
  }
  throw new Error("PAL failed");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tính toán chính xác — code không sai số học (PAL paper) | ❌ Cần sandbox an toàn (EC/JN) — code có thể độc |
| ✅ Vượt CoT thuần trên math/reasoning | ❌ LLM sinh code sai → retry cost |
| ✅ Deterministic — cùng code cùng đáp án | ❌ Overhead: codegen + sandbox run |
| ✅ Hợp data manipulation (pandas, stat) | ❌ Task không tính toán (text/creative) → không hợp |

## Khác các hướng gần

| | DU Structured Reasoning | JY Step-Back | JZ Verification | KA: PAL |
|---|---|---|---|---|
| Output | Text cấu trúc | Principle | Checked answer | **Code runnable** |
| Tính toán | LLM guess | LLM guess | Verify guess | **Runtime deterministic** |
| Khi nào | Reasoning tái dùng | Cần principle | Cần fact-check | **Cần tính chính xác** |

## Khi nào chọn

- Task tính toán/logic/thống kê/data — LLM guess số học không đáng tin
- Có sandbox an toàn (EC 133 / JN 274) để chạy code
- Cần deterministic — cùng bài cùng đáp án
- Không dùng task sáng tạo/text (không tính toán); luôn sandbox + retry-on-error (DO 119)
