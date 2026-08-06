# Hướng HHHHH: Tool Description Engineering — viết mô tả tool để agent chọn đúng

> **Nguồn gốc:** "Writing Effective Tools for AI Agents" (Anthropic engineering); Paragon "Optimize Tool Calling" 2026
> **Coupling:** 🟢 — metadata thay đổi, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (OO registry sẵn; thiếu mô tả chuẩn + self-optimize)
> **Effort:** 1 tuần

## Nguồn gốc

"LLMs decide when to call a tool based off the **tool name, tool description, input names, and input descriptions**" (Paragon 2026); Anthropic engineering: **"Writing effective tools for agents"** — hướng dẫn chuẩn: (1) mô tả khả năng + use case + *khi nào không dùng*; (2) param description rõ ràng (đơn vị, định dạng, giới hạn); (3) kích thước mô tả cân bằng (mô tả dài tốn token — nối VVVV/XXXX, ngắn thì chọn sai); (4) **dùng Claude để tối ưu tool cho nó** — auto-generate description từ implementation + eval. TTTT (schema drift) cảnh báo: "description changes are breaking changes — they alter model's probability of selecting and correctly invoking the tool". Mô tả tool là *chính là contract* — agent không đọc code, chỉ đọc mô tả.

## Mô tả

mya tool metadata chuẩn: (1) **cấu trúc** — name rõ, description gồm: làm gì / dùng khi nào / KHÔNG dùng khi nào / trả về gì (hình thành — 53/G các tool chọn sai lệch — XXXX selector cũng dùng metadata này); (2) **params** — mô tả từng field: đơn vị, ví dụ, ràng buộc (TTTT schema — validation giảm, RRRR ít repair); (3) **quality loop** — theo dõi tool "chọn đúng" (QQQQ trace: intent → tool) → tool chọn sai nhiều → **gợi ý rewrite description** (Anthropic self-optimize style: LLM rẻ PPPP sinh bản mới) → A/B qua golden (BBBBB staged gate) → áp dụng; (4) **đo** — tool selection accuracy metric (JJJJJ benchmark). Đây là 'cheap win': thay mô tả không đụng code nhưng cải thiện chọn tool đáng kể.

## Kiến trúc

```
  TOOL METADATA (OO)
    name · description { làm gì · khi nào · khi nào KHÔNG · trả về gì }
    params { field → đơn vị · ví dụ · ràng buộc (TTTT) }
        │
        ▼
  AGENT (chuỗi: XXXX chọn tool dựa trên metadata · LLM đọc description)
        │
        ▼
  METRIC: tool selection accuracy (QQQQ trace → intent vs tool)
        ├─ thấp? ──► REWRITE: LLM rẻ (PPPP) sinh description mới
        │          └─ A/B qua golden/SSSS (BBBBB staged) → áp dụng
        └─ theo dõi: kích thước mô tả (VVVV token) cân bằng
```

```
mya: OO registry SẴN — mô tả tool còn tùy tiện (chưa chuẩn + chưa tự tối ưu)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools OO — registry (nơi standardize metadata)
// ✅ XXXX tool selector — dùng metadata (cải thiện cùng lúc)
// ✅ TTTT schema — validation params (mô tả params tốt = ít lỗi)
// ✅ QQQQ trace — đo tool chọn đúng
// ✅ PPPP local + BBBBB gate — sinh self-optimize + A/B
// ✅ SS budget — mô tả dài = token (cân bằng VVVV)

// ❌ THIẾU: template metadata chuẩn (khi nào KHÔNG dùng, trả về gì)
// ❌ THIẾU: selection accuracy metric
// ❌ THIẾU: auto-rewrite loop (Anthropic style) qua gate
```

## Implementation

```typescript
// packages/tools/src/metadata.ts (NEW)
interface ToolDescription {
  does: string;           // làm gì
  when: string;           // khi nào dùng
  whenNot: string;        // khi nào KHÔNG dùng (chống chọn sai)
  returns: string;        // trả về gì (53/hướng dùng)
}

function selectionAccuracy(trace: Trace[], intent: Intent[]): number {
  // QQQQ: mỗi step — tool gọi vs tool đúng theo intent — tỷ lệ
  return correctTool/total;
}

function suggestRewrite(tool: ToolSpec, failures: FailSample[]): string {
  // Anthropic: LLM rẻ (PPPP) sinh description mới từ implementation + lỗi
  // A/B qua golden (SSSS) — BBBBB staged gate → apply
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cheap win: đổi mô tả, không đụng code — chọn tool tốt hơn | ❌ Mô tả dài tốn token (VVVV/XXXX cân bằng) |
| ✅ "Khi nào KHÔNG dùng" chống chọn sai tool na ná | ❐ Metadata chuẩn phải rà lại toàn bộ tool |
| ✅ Self-optimize (Anthropic) + A/B an toàn (BBBBB) | ❌ PPL tuyệt — nhưng cần metric rõ (QQQQ) |
| ✅ Nguồn chuẩn Anthropic 2025 + Paragon 2026 | |

## Khác các hướng gần

| | XXXX Select | TTTT Drift | HHHHH: Descriptions |
|---|---|---|---|
| Vấn đề | Chọn subset | Schema đổi | **Chất lượng mô tả** |
| Cơ chế | Embed+top-k | Diff | **Template + rewrite + gate** |
| Mối quan hệ | Nuôi XXXX | Chống vỡ | **Nâng chọn-tool đúng** |

## Khi nào chọn

- Agent thường chọn sai tool na ná (JJJ/QQQQ đo được)
- Nhiều tool mô tả viết vội (mya 80+)
- Muốn tối ưu không đụng code
- Đã có trace + gate + model rẻ — thêm loop rewrite