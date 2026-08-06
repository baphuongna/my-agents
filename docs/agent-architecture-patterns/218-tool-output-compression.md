# Hướng HJ: Tool Result Compression — nén kết quả tool/conversation trước khi vào context của LLM

> **Nguồn gốc:** factory.ai "Compressing Context" (nén conversation on-the-fly bằng summarization model — giữ max tokens); Morph "Context Compaction" (giảm context window bằng cách xóa low-signal tokens thay vì viết lại — verbatim compaction vs rewrite); OneUptime "How to Build Context Compression" (nén trước khi gửi — giảm token 50-80% mà giữ thông tin); arXiv 2507.20198 "Multimodal Long-Context Token Compression" (survey); kargarisaac "Context Compaction" (compaction — nén không mất essence, mở rộng window hiệu quả tới triệu token)
> **Coupling:** 🟡 — chạm mọi chỗ nhồi context (tool results, history)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (có truncation max tokens — chưa nén thông minh)
> **Effort:** 2-4 tuần

## Nguồn gốc

Compression: **trước khi đặt tool output / lịch sử vào context — nén/khử nhiễu thay vì cắt cứng, giữ ý chính mà giảm token 50-80%** — factory.ai: summarization model nén conversation on-the-fly; Morph: phân loại compaction — *verbatim compaction* (xóa token low-signal giữa nguyên văn) và *semantic compaction* (viết lại tóm tắt); OneUpTime: 50-80% giảm token mà vẫn đủ thông tin; instantaneous − window dài nhưng chất. Khác **121 long-context-management** (tối ưu bố trí context dài), **100 prompt-compression** (nén input/instructions), **191 kv-semantic-cache** (cache kết quả truy xuất) — KKKKK *nén kết quả tool/vòng lặp* — chỗ sinh context nhiều nhất. Khác **memory-consolidation** — đó là lưu bền lâu cho sau này; KKK chỉ cho lần chạy hiện tại. Kết nối: mya giờ cắt cứng khi vượt giới hạn — cần nén theo chiến lược.

## Kiến trúc

```
  TOOL OUTPUT (đọc file lớn, crawl nhiều url, query lớn)
        │
        ▼
  POLICY (đủ nhỏ → giữ nguyên; quá lớn → compress; quá lớn → nén 2 cấp)
        │
  ┌──────► TRUNCATE (verbatim — giữ đầu/cuối + chỉ mục)
  │       ► COMPACT (semantic — LLM tóm/chỉ giữ ý đứng đắn)
  │       ► SUMMARIZE (thêm bước LLM — mất chi tiết, giữ đúng câu hỏi)
        ▼
  CONTEXT IN (token ~50-80% ít hơn — vẫn đủ cho câu hỏi)
        │
  LOAD SNIPPET gốc khi cần chi tiết (Singapore n/a — lazy fetch)
```

```
mya: truncate cứng + cap token — chưa nén thông minh, chưa reload chi tiết
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ giới hạn max output per tool (truncate cứng — giữ đầu/cuối)
// ✅ 121 long-context-management — quản lý context dài (nền)
// ✅ 209/191 retrieval — cache kết quả (nền)

// ❌ THIẾU: phát hiện "output quá lớn → nén"
// ❌ THIẾU: compact theo loại (verbatim vs semantic vs summary)
// ❌ THIẾU: lazy fetch khi cần chi tiết (retrieve lại chỗ bị cắt)
```

## Implementation

```typescript
// packages/compress/src/compress.ts (NEW)
export function compressResult(out: ToolOutput, q: Query): Token {
  if (out.tokens < LIMIT) return out;                       // nhỏ — giữ nguyên
  if (out.tokens < LIMIT * 3) return verbatimTrim(out);      // Morph: xóa low-signal tokens giữ nguyên (Morph)
  return llmSummarize(out, q);                               // semantic — tóm theo câu hỏi
}
// khi agent cần chi tiết hơn → lazy fetch phần cắt (không phải nén lại)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Token -50-80% — rẻ + chất hơn (OneUp) | ❌ Nén sai → mất chi tiết cần cho câu hỏi |
| ✅ Giữ thông tin thay vì cắt cứng mất hết | ❌ Semantic compaction tốn thêm 1 LLM call |
| ✅ Kéo dài context hiệu quả — nhiều tool call cùng turn | ❌ Context và sink: phần nén không có source của trước |
| ✅ Xây trên 121/191 | ❌ Không phù hợp khi cần toàn bộ chi tiết |

## Khác các hướng gần

| | 121 Context | 165 Memory | KKKKKKKK: Compress |
|---|---|---|---|
| Mục | Quản lý dài |/Lưu lâu | **Nén output tức thời** |
| Vị trí | Session level | Bền | **Trong turn — trước khi inject** |
| Quan hệ | Vỏ | Bộ nhớ dài | **Nền cho mọi tool output** |

## Khi nào chọn

- Tool trả kết quả lớn (file, crawl, query) thường vượt limit
- Đang cắt cứng làm mất câu trả lời — muốn giữ ý
- Chi phí token cao — nén không mất hiệu quả
- Luôn kèm: lazy fetch chi tiết khi cần + chỉ nén đúng đoạn dư so với câu hỏi