# Hướng GV: Constrained Decoding — ép model sinh ra output đúng schema ngay từ token

> **Nguồn gốc:** arXiv 2501.10868 "Generating Structured Outputs from Language Models" ("Constrained decoding frameworks have standardized around JSON Schema… most uses guaranteeing constraint"); MLC "Achieving Efficient, Flexible, and Portable Structured Generation with XGrammar" (specify format + enforce during decoding); tianpan.co "Grammar-Constrained Generation" (constraints guarantee schema-valid at token level — "eliminating the validate-retry loop entirely"); zeroentropy "forcing LLM output to conform to a grammar/schema/regex by masking the next-token distribution"; NVIDIA NIM (guided_json)
> **Coupling:** 🟡 — chạm mọi tool-call/output của agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (JSON-schema + 175 validate — chưa ép token)
> **Effort:** 2-4 tuần

## Nguồn gốc

Constrained decoding: **chặn luôn token không hợp lệ khi sinh (masking + grammar) — output tự regex/JSON-schema hợp lệ, khỏi validate-retry** — arXiv 2501.10868: phổ chuẩn hóa quanh JSON Schema, đa số hệ thống guarantee output đúng cú pháp; XGrammar (MLC): biên dịch schema → context-free grammar → áp vào decoding; tianpan.co: "at the status of token — not post-hoc check" — "loại bỏ hoàn toàn vòng validate-retry"; Zero N: next-token filtering (cấm token ngoài grammar). So với **175 TTTTTTT structured-output-validation** (kiểm tra schema *sau* — ok nhưng phải retry khi sai) — WWWWWWW *sinh đúng luôn* (không có lần sinh sai). So với **190 property-based-testing** (test code) và **184 output schema — LLM-as-judge** (đánh giá hứng thụ). Kết hợp: 175 → WWWWW (retry ít); 198 audit → vẫn ghi; lỗi trong content (đúng cú pháp nhưng sai nghĩa) vẫn phải TTTTT/LLM-judge.

## Kiến trúc

```
  TOOL CALL (agent quyết gọi tool với tham số)
        │
        ▼
  SCHEMA → GRAMMAR (JSON Schema / regex → CFG — XGrammar/Outlines/Guidance)
        │
        ▼
  DECODE with MASK (mỗi bước loại token không trong grammar — Zero entropy)
        │
        ▼
  OUTPUT (hợp lệ 100% — khi retry-loop ~0, tian) ──► 175 validate hỗ trợ (content)
        │
        ▼
  AUDIT (198) · nếu LLM phun khác thì schema cũng không bịa — token phải đi trong đường
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 175 structured-output validate — rà sau khi sinh (base)
// ✅ tool-schema (JSON Schema) — có sẵn schema cho tool-call
// ✅ 198 audit trail — ghi kết quả
// ✅ 177 property-based — bao vây sau

// ❌ THIẾU: constrained decoding engine (nối LLM provider với XGrammar/LTrt engine)
// ❌ THIẾU: fallback riêng — provider không hỗ trợ mask thì retry (175)
// ❌ THIẾU: đo tỷ lệ retry → biết khi nào cần bật constraint
```

## Implementation

```typescript
// packages/constrain/src/decode.ts (NEW)
export class ConstrainedDecode {
  async call(tool: ToolDef, ctx: Ctx): Promise<Output> {
    const engine = compileGrammar(tool.schema);        // XGrammar — schema→CFG
    return provider.generate({
      ...ctx,
      logitsBias: engine.mask,                          // mask next-token
      // provider guide_json / regex — theo NIM-OpenAI nếu thiếu
      fallback: () => retryWithValidation(ctx, tool),   // 175 — provider ko mask
    });
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không bao giờ sinh JSON/dòng tool-call sai cú pháp | ❌ Cú pháp đúng ≠ nghĩa đúng — hallucination vẫn ở content |
| ✅ Bỏ validate-retry (nhiều domain ≈ mất ~1 request/tool) | ❌ Không mọi provider hỗ trợ — thêm engine + mask overhead |
| ✅ Tool-call đáng tin: branch-thành chính xác agent | ❌ ít giới hạn: schema nông (free-text) không nhựa được |
| ✅ Khi 175 retry nhiều — bật constraint giảm hẳn | ❌ Càng nhiều constraint ở token — đôi xuống chất lượng sinh tự do |

## Khác các hướng gần

| | 175 Validate | 177 Prop-test | WWWWWWWW: Constrain |
|---|---|---|---|
| Mục | Kiểm tra sau | Kiểm toán thuộc tính | **Ép đúng ngay khi sinh** |
| Thời điểm | Sau khi sinh | Ngoài vòng thật | **Trong mỗi bước token** |
| Quan hệ | Fallback | Đời vòng | **Lớp trước — tiết kiệm nhất** |

## Khi nào chọn

- Agent gọi tool nhiều — retry do random JSON sai tốn
- Hệ thống yêu cầu output phải đúng spec tuyệt đối (API/CI)
- Provider hỗ trợ (OpenAI structured / NVIDIA NIM / XGrammar) — dùng fallback 175 khi không