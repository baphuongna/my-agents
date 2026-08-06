# Hướng DU: Structured Reasoning Output — thinking có cấu trúc, tái sử dụng được

> **Nguồn gốc:** Reasoning models 2025-2026 (thinking blocks); explainability techniques (testrigor 2026); GGGGG nền
> **Coupling:** 🟡 — output format thêm phần, consumer cần theo
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (trace sẵn; thiếu thinking schema)
> **Effort:** 1 tuần

## Nguồn gốc

Structured reasoning: **thay vì "thinking" ẩn (nội suy không kiểm soát), bắt agent trả reason theo schema có cấu trúc** — reasoning models (OpenAI o-series, DeepSeek-R1 2025-2026) sinh thinking blocks có cấu trúc — có thể lưu/kiểm/đo (khác chain-of-thought cũ: ẩn, không kiểm soát); testrigor 2026 explainability techniques: "showing reasoning steps, highlighting what mattered most, what-if scenarios"; token.security: transparent decision-making; token hiển thị kèm suy luận. Với mya: reasoning dạng **dữ liệu** — (1) lưu được (trace QQQQ), (2) đo được (GGGGG process score — đọc từng bước suy luận), (3) tái sử dụng (PPPPP — phát hiện lỗi reasoning sớm; BBBBB — sửa đúng bước), (4) giải thích (TTTTT — rationale có sẵn). Khác **TTTTT** (rationale *cho user/audit* — diễn giải) — VVVVV là *định dạng output* (thinking trả về máy đọc được — reason steps schema) — 2 cái phối: VVVVV là nguồn, TTTTT là trình bày.

## Mô tả

mya reasoning schema (mỗi bước quyết định/tool call — nối GGGGG): (1) **cấu trúc** — mỗi thinking block: `{goal, hypothesis, check (cách kiểm chứng), evidence (context refs), conclusion, confidence}` — agent trả kèm tool call; (2) **lưu** — thinking thành phần trace (QQQQ — không phải text mất); (3) **đo** — process score đọc trực tiếp từ schema (hypothesis → conclusion có khớp? check có chạy? — GGGGG); (4) **debug/eval** — lỗi suy luận (hypothesis sai mà conclusion vội) → chẩn đoán (OOOOO) + sửa prompt đúng bước (BBBBB); (5) **giải thích** — TTTTT `why` hiển thị từ chính thinking (không sinh lại — tiết kiệm). Chống: thinking "diễn cho xong" (YYY — schema rỗng) → validate bắt buộc trường + evidence refs thật.

## Kiến trúc

```
  QUYẾT ĐỊNH / TOOL CALL ──► REASONING BLOCK (schema)
    goal · hypothesis · check · evidence (refs) · conclusion · confidence
        │
  ┌─────┴──────────────────────────────────────┐
  LƯU (trace QQQQ — dữ liệu, không text)        ĐO (GGGGG đọc schema)
        │                                        ├─ hypothesis↔conclusion khớp?
        ▼                                        └─ check chạy thật? (YYYY)
  DEBUG/EVAL: lỗi suy luận → OOOOO chẩn đoán     │
  → BBBBB sửa đúng bước prompt                   ▼
  GIẢI THÍCH: TTTTT `why` = chính thinking       PPPPP: bắt reasoning sai sớm
  (không sinh lại — tiết kiệm)
```

```
mya: trace + GGGGG + TTTTT SẸN — thiếu: reasoning schema + validate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace — nơi lưu thinking (dạng dữ liệu)
// ✅ GGGGG process score — đọc schema (chuyển từ tự do sang cấu trúc)
// ✅ TTTTT rationale — hiển thị từ thinking (không sinh lại)
// ✅ OOOOO error analysis + BBBBB — dùng thinking chẩn đoán
// ✅ PPPPP bounded correction — phát hiện reasoning lệch sớm
// ✅ YYYY — validate thinking thật (không rỗng/giả)

// ❌ THIẾU: reasoning schema (goal/hypothesis/check/evidence/conclusion)
// ❌ THIẾU: validate bắt buộc (trường + evidence refs thật)
// ❌ THIẾU: format hint trong prompt (agent trả theo schema)
```

## Implementation

```typescript
// packages/ai/src/reasoning.ts (NEW)
interface ReasoningBlock {
  goal: string; hypothesis: string;
  check: string; evidence: TraceRef[];     // refs THẬT (YYYY — không bịa)
  conclusion: string; confidence: number;
}

const REASONING_SCHEMA_PROMPT = `
Với mỗi bước quyết định/tool call, trả reasoning theo schema:
goal, hypothesis, check, evidence (refs trace thật), conclusion, confidence.
`;

function validateReasoning(b: ReasoningBlock): boolean {
  return !!b.goal && !!b.hypothesis && b.evidence.length > 0 &&
    refsExist(b.evidence);          // evidence thật (YYYY)
}
// GGGGG: score từ schema (hypothesis↔conclusion khớp? check chạy?)
// TTTTT: `why` hiển thị chính block — không sinh lại (rẻ)
// PPPPP: confidence sụt / evidence thiếu → dừng sớm
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Reasoning là dữ liệu — đo/kiểm/tái dùng (GGGGG) | ❌ Format hint tốn token (MMMM/WWWW cân) |
| ✅ `why` từ thinking — không sinh lại (rẻ) | ❐ Agent có thể điền cho có (validate — YYYY) |
| ✅ Chẩn đoán lỗi suy luận (OOOOO/BBBBB) | ❌ Schema cứng — reasoning mở khó gò |
| ✅ Phù hợp xu hướng reasoning models (2025-2026) | ❌ Confidence agent tự đánh giá kém tin |

## Khác các hướng gần

| | TTTTT Explain | GGGGG Process | VVVVV: Reasoning Schema |
|---|---|---|---|
| Bản chất | Trình bày lý do | Chấm bước | **Định dạng thinking** |
| Đối tượng | User/audit | Supervisor | **Máy đọc (dữ liệu)** |
| Mối quan hệ | Hiển thị VVVVV | Đo VVVVV | **Nguồn cho cả 2** |

## Khi nào chọn

- Muốn đo/kiểm suy luận agent (không chỉ output)
- Debug lỗi "suy luận vội" thường xuyên
- Đã có trace + GGGGG + TTTTT — thêm schema + validate
- Agent model hỗ trợ structured reasoning (o-series/R1 style)