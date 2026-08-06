# Hướng IIIIIIII: Property-Based Testing for Agents — test bằng tính chất thay vì ví dụ; fuzz + shrink

> **Nguồn gốc:** Anthropic Research "Finding Bugs with Claude and Property-Based Testing" (PBT framework tự tìm counterexample bằng cách sinh input hợp lệ); arXiv 2506.18315 "Property-Generated Solver" (PBT validate high-level program properties); mayhem.security (property-based fuzzing — test định nghĩa loại input, không ví dụ); InfoQ "Fuzzy Unit Testing" (property tests viết cùng unit/integration — fuzz phần lớn)
> **Coupling:** 🟢 — lớp test, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (test suite + PP eval sẵn; thiếu PBT framework)
> **Effort:** 1-3 tuần

## Nguồn gốc

Property-based testing: **thay vì viết ví dụ cụ thể — định nghĩa TÍNH CHẤT bất biến, framework sinh vô số input và tìm counterexample (fuzz), rồi shrink về ví dụ nhỏ nhất** — Anthropic: "the property-based testing framework then automatically searches for a counterexample of this property by generating valid inputs as test cases"; arXiv 2506.18315: dùng PBT validate high-level program properties (code LLM sinh); mayhem: "a property-based test defines the types of inputs it needs — not manually created examples"; lobste.rs: "PBT is better at shrinking bugs to minimal counter-examples". Điểm khác **PP eval** (dataset có sẵn — ví dụ) và **XXXXXXX sandbox test** (môi trường CI) — IIIIIIII *cách viết test khác*: (1) property — bất biến: "output luôn valid JSON schema" (TTTTTTT), "kết quả luôn đúng định dạng date", "tool result round-trip"; (2) generator — sinh input ngẫu nhiên hợp lệ (loại input đúng miền); (3) search — chạy N trường hợp, tìm vi phạm (fuzz); (4) shrink — khi có lỗi: rút về counterexample tối thiểu (Anthropic/lobste.rs — dễ fix); (5) use for agent — test property của tool call/output/schema (arXiv — LLM code), không test "câu trả lời đúng" (không thể định nghĩa — thay bằng property về cấu trúc/ràng buộc); (6) integrate — chạy trong CI (XXXXXXX), cạnh unit test (InfoQ). Nối TTTTTTT (schema — property phổ biến), XXXXXXX (CI — chạy), PP (dataset — bổ sung cho property), 179 (test sandbox), WWWWWW (miền input hợp lệ theo intent).

## Kiến trúc

```
  PROPERTY (bất biến — Anthropic): "output luôn hợp schema" / "luôn đúng format"
        │
        ▼
  GENERATOR (mayhem): sinh INPUT ngẫu nhiên hợp lệ (theo loại/miền)
        │
        ▼
  SEARCH (fuzz): chạy N case → tìm COUNTEREXAMPLE (vi phạm property)
        │
        ▼
  SHRINK (lobste.rs): rút về ví dụ nhỏ nhất → dễ sửa
        │
        ▼
  INTEGRATE: cạnh unit test (InfoQ) · chạy trong CI sandbox (XXXXXXX)
```

```
mya: unit + PP SẴN — thiếu: PBT framework (generator + shrink)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ Unit test suite — nền chạy PBT (cùng runner)
// ✅ TTTTTTT schema validation — property phổ biến (output hợp lệ)
// ✅ PP eval — dataset (bổ trợ — không thay thế property)
// ✅ XXXXXXX CI/sandbox — nơi chạy PBT tự động
// ✅ Vitest — có plugin PBT (fast-check) dùng được
// ✅ WWWWWW intent — định miền input hợp lệ

// ❌ THIẾU: property definitions (bất biến cho agent output/tool)
// ❌ THIẾU: generator + shrink (fast-check integrate)
// ❌ THIẾU: fuzz cho tool call (input ngẫu nhiên vào tool)
```

## Implementation

```typescript
// packages/pbt/src/properties.ts (NEW)
export const agentProps = {
  outputValid: (schema: Schema) => (out: unknown) =>
    schema.safeParse(out).ok,               // TTTTTTT — luôn hợp schema
  roundTrip: (encode: Fn, decode: Fn) => (v: V) =>
    decode(encode(v)).eq(v),                // round-trip bất biến
};
// fast-check: fc.assert(fc.property(genToolInput(), agentProps.outputValid(s)))
// anthropic: framework tự tìm counterexample + shrink
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt lỗi mà ví dụ bỏ sót — sinh hàng nghìn case (Anthropic) | ❌ Định nghĩa property khó cho hành vi "mềm" |
| ✅ Shrink — bug nhỏ nhất, fix nhanh (lobste.rs) | ❐ Test chậm hơn (nhiều case + fuzz) |
| ✅ Lý tưởng cho LLM output — schema/format/round-trip (arXiv) | ❌ Chỉ bắt được vi phạm định nghĩa được |
| ✅ Xây trên Vitest/fast-check + TTTTTTT | ❌ "Đúng nội dung" không property được — cần PP |

## Khác các hướng gần

| | PP Eval | Unit Test | IIIIIIII: PBT |
|---|---|---|---|
| Input | Dataset cố định | Ví dụ tay | **Sinh ngẫu nhiên + shrink** |
| Mục đích | Đo chất lượng | Kiểm logic | **Tìm counterexample** |
| Quan hệ | Dataset | Điểm code | **Bổ sung — fuzz properties** |

## Khi nào chọn

- Output/tool call có cấu trúc rõ (schema, format, round-trip — LLM)
- Muốn bắt edge case không nghĩ ra bằng tay (Anthropic)
- CI đã có (XXXXXXX) — thêm lớp fuzz vào pipeline
- Có fast-check/Vitest — integrate nhanh, không cần hạ tầng mới