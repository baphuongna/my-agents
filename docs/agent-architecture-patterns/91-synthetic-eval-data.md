# Hướng NNNN: Synthetic Eval Data — sinh test case giả cho đánh giá

> **Nguồn gốc:** evidentlyai LLM test dataset guide; decodingai (Iusztin) 2026; futureagi "Synthetic Test Data" 2026
> **Coupling:** 🟢 — data pipeline, tách khỏi runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/eval sẵn; thiếu generator + contamination check)
> **Effort:** 1-2 tuần

## Nguồn gốc

Synthetic data generation cho LLM eval: **sinh test cases từ spec/prompts thay vì thu thập real**. decodingai (2026): "not blindly asking an LLM to create test cases — structure your inputs as dimensions, anchoring"; futureagi 2026: "contexts, evolutions, personas, contamination checks". Các use case (digitalapplied 2026): eval sets, edge-case augmentation, privacy substitution. Rất hợp agent: **test agent capabilities trước khi có user thật** — PP eval-naive cần test cases; GGGG judge cần rubric+data; sinh từ **agent spec (HHHH)** + skills/prompts (P) → diverse: personas (user cách nhau nói ra sao), evolutions (biến thể câu hỏi), contexts (RAG contexts). **Contamination check**: đảm bảo data sinh không lậu vào training corpus cũng không "học lộ" giữa eval (dedup).

## Mô tả

mya pipeline (nối PP/G) sinh test case từ cấu trúc: (1) **dimensions** — agent có capability gì (HHHH spec: tools, skills); (2) **anchor** — mỗi dimension có vài case mẫu thủ công (đúng chuẩn); (3) **evolve** — LLM sinh biến thể xung quanh anchor (đổi persona, khó/ dễ, cạnh), điểm maximize coverage; (4) **validate + contamination check** — dedup gần nhau (embedding), check không trùng case real, đảm bảo cân bằng độ khó. Output: dataset đưa vào packages/eval (chạy agent → compare → GGGG judge hoặc expected). Data real ít → synth lấp chỗ trống; **không tự sinh câu trả lời làm expected cho câu hỏi đã có real answer** (rủi ro lệch).

## Kiến trúc

```
  HHHH agent spec (tools/skills) ──► DIMENSIONS
        ▼
  ANCHOR: case mẫu thủ công per capability (chuẩn đúng)
        ▼
  EVOLVE (LLM): personas · difficulties · contexts · edge cases
        ▼
  VALIDATE: dedup (embedding) + contamination check + balance
        ▼
  DATASET ──► packages/eval (PP) + GGGG judge/expected ──► report (53)
```

```
mya: packages/eval (PP) + report SẴN — thiếu nguồn data
     NNNN: sinh test case chủ động thay vì chờ real
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — runner (PP) — nơi chạy case
// ✅ HHHH spec — khai báo capability → dimensions
// ✅ GGGG LLM-as-Judge — chấm case mở (expected không cần cứng)
// ✅ report runner (53) — trả kết quả
// ✅ packages/memory — kho case real (nuôi anchor + contamination check)

// ❌ THIẾU: dimension + anchor schema
// ❌ THIẾU: evolve pipeline (LLM sinh biến thể)
// ❌ THIẾU: contamination check + dedup
```

## Implementation

```typescript
// packages/eval/src/synthetic.ts (NEW)
interface Dimension { capability: string; anchor: TestCase[]; }   // anchor thủ công

function evolve(dim: Dimension, model: Router): TestCase[] {
  // LLM sinh biến thể: personas · difficulty · context swaps
  // anchoring: bám anchor không bay xa (decodingai 2026)
  return circularEvolve(dim.anchor, mutateRules(dim.capability));
}

function validate(cases: TestCase[], real: TestCase[]): TestCase[] {
  const dedup = nearDedup(cases);              // embedding similarity
  const clean = contaminationCheck(dedup, real); // không trùng real corpus
  return balance(clean);                        // cân bằng độ khó
}

// rules gốc: (1) data thật là thật — synth chỉ lấp chỗ trống
//            (2) không sinh expected lấn real answer chưa có
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Test sớm trước khi có user (capability coverage) | ❌ Sinh "expected" thiên LLM bias (GGGG bù) |
| ✅ Diverse: personas/evolutions/edge (futureagi 2026) | ❌ Contamination check phải làm (nhiễm eval) |
| ✅ Privacy: thay công ty thật bằng giả (digitalapplied) | ❌ Anchor cần công tay vẫn dò được |
| ✅ Lấp real data hiếm | ❌ Dữ liệu giả khác thị trường thật |
| ✅ Nối PP + GGGG + HHHH thành vòng hoàn chỉnh | |

## Khác các hướng gần

| | PP Eval | GGGG LLM-as-Judge | NNNN: Synthetic Data |
|---|---|---|---|
| Làm gì | Chạy so sánh | Chấm điểm | **Sinh test case** |
| Cần gì | Dataset | Rubric | **Dimensions + anchor** |
| Vai trò | Consumer | Consumer | **Producer cho cả 2** |
| Mối quan hệ | Chạy case | Chấm case | **Nuôi đủ dataset** |

## Khi nào chọn

- Ít user data, nhiều capability cần test (agent mới)
- Muốn eval hồi quy chủ động (khi đổi prompt/tool)
- Đã có eval + judge — thêm generator là bước ngắn
- Sẵn sàng contamination check + balance kỷ luật