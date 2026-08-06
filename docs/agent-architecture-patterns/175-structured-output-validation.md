# Hướng FS: Structured Output Validation Layer — ép LLM trả đúng schema, validate trước khi chạy

> **Nguồn gốc:** Michael Lanham "Stop Blaming the LLM: JSON Schema Is the Cheapest Fix" (enforce structured outputs validated against JSON Schema); understandingdata "Tool Call Validation (Zod)" (runtime schema validation — untrusted LLM output → typed validated data); arXiv 2606.09395 "LLGuidance" (grammar engine — enforce arbitrary CFG/JSON Schema/RegEx trên LLM output); agenta "Guide to Structured Outputs & Function Calling" (validate response against original model schema)
> **Coupling:** 🟢 — lớp ép schema, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (JSON tooling + schema sẵn; thiếu enforcement layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Structured output validation: **LLM trả gì → ép đúng schema + validate runtime trước khi code chạy** — Lanham: "stop treating tool inputs as best-effort JSON and start enforcing structured outputs validated against a JSON Schema — the cheapest fix for flaky AI agents"; understandingdata: "Runtime schema validation with libraries like Zod transforms untrusted LLM output into typed, validated data that your code can safely execute"; LLGuidance (arXiv 2606.09395): "low-level grammar engine capable of enforcing arbitrary CFG rules on LLM outputs — JSON Schema, regex"; agenta: "validate the response against your original model schema". Điểm khác **GGGG process reward** (điểm quá trình) và **PP eval** (đo chất lượng tổng) — TTTTTTT *kỹ thuật binding*: (1) schema định nghĩa — tool call/trả lời có JSON Schema (agenta — original model); (2) enforce — constrain decoding theo grammar thay "hy vọng" (LLGuidance — CFG/JSON Schema/RegEx — đảm bảo 100% hợp lệ); (3) runtime validation — Zod (understandingdata — untrusted LLM output → typed data an toàn), tool adapter chứa policy/allowlist (reddit: "allowlist and policy decisions live in your tool adapter layer"); (4) retry khi lệch — lỗi schema → cho LLM sửa (re-validate loop, tối đa N lần); (5) metric — tỷ lệ schema-fail (YYYY — theo dõi flaky), PP không đổi chất lượng; (6) tích hợp — mọi tool call/trả lời agent qua validation layer.

## Kiến trúc

```
  LLM OUTPUT (tool call / trả lời)
        │
        ▼
  SCHEMA (agenta — original model schema): JSON Schema / regex / CFG
        │
        ▼
  ENFORCE (LLGuidance arXiv 2606.09395): grammar ép cú pháp hợp lệ
   · decode constraint — không để LLM sinh JSON sai
        │
        ▼
  RUNTIME VALIDATE (Zod — understandingdata): untrusted → typed data
   · tool adapter: allowlist + policy (reddit r/LocalLLaMA)
        │
        ├── LỆCH → re-validate loop (cho LLM sửa, max N lần)
        └── QUA  → code chạy an toàn (typed)
        │
        ▼
  METRIC: schema-fail rate (YYYY) — "cheapest fix for flaky agents" (Lanham)
```

```
mya: JSON tooling + zod sẵn — thiếu: enforcement + validation layer chung
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ JSON schema — đã định nghĩa tool schemas (nền)
// ✅ Zod/validation — validate từng chỗ rời (mở rộng thành layer)
// ✅ RRR retry — thử lại khi lỗi (re-validate loop)
// ✅ GGGG process reward — đánh giá process (khác chiều)
// ✅ YYY observability — đo fail rate
// ✅ WW policy — policy trong adapter (reddit allowlist)

// ❌ THIẾU: enforcement (LLGuidance — ép grammar khi decode)
// ❌ THIẾU: validation layer chung tập trung (mọi output qua một cửa)
// ❌ THIẾU: schema-fail metric + re-validate loop chuẩn
```

## Implementation

```typescript
// packages/output/src/validate.ts (NEW)
export class OutputValidator<T> {
  async call(fn: () => Promise<unknown>, schema: Schema): Promise<T> {
    for (let i = 0; i < RETRIES; i++) {
      const raw = await enforce(fn(), schema); // LLGuidance — ép grammar
      const parsed = schema.safeParse(raw);    // Zod — typed data an toàn
      if (parsed.ok) return parsed.data;
    } // Lanham: cheapest fix — enforce structured output trước
    throw new ValidationError(schema.name);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Flaky giảm mạnh — output luôn hợp schema (Lanham cheapest fix) | ❌ Model không hỗ trợ constrained decoding thì ép chậm |
| ✅ An toàn — code chạy trên typed data, không JSON rác (Zod) | ❐ Retry lệch → thêm cost token |
| ✅ Schema sai do LLM "làm mưa gió" — gần như 0% (LLGuidance) | ❌ Schema quá chặt → LLM kẹt không trả nổi |
| ✅ Xây trên schema + RRR + YYY | ❌ Chỉ fix sai cú pháp — không fix sai nội dung |

## Khác các hướng gần

| | GGGG Process Reward | PP Eval | TTTTTTT: Output Validate |
|---|---|---|---|
| Loại | Điểm quá trình | Đo tổng | **Ép + check cú pháp/thứ liệu** |
| Lúc | Sau task | Ngoài vòng | **Mỗi lần trả/tool call** |
| Quan hệ | Đánh giá | Đo | **Bảo đảm input cho code** |

## Khi nào chọn

- Tool call/trả lời thường lệch schema — flaky (Lanham)
- Muốn code agent an toàn — JSON rác không được vào logic
- Model hỗ trợ structured output/JSON mode (LLGuidance grammar)
- Đã có schema + Zod + RRR — thêm enforcement + layer chung