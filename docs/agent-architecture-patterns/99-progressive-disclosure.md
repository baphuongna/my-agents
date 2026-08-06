# Hướng VVVV: Progressive Disclosure — lộ context dần theo nhu cầu thực

> **Nguồn gốc:** "Effective Context Engineering" (Anthropic engineering); "Is Progressive Disclosure All You Need" (arXiv 2607.17598, 2026); mindstudio 2026
> **Coupling:** 🟢 — tầng context, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (skills/YYYY sẵn; thiếu context loader dần)
> **Effort:** 1-2 tuần

## Nguồn gốc

Progressive disclosure: **không nhét toàn bộ context vào window một lúc** — lộ dần theo nhu cầu: đầu tiên chỉ metadata/tóm tắt, agent mở rộng khi thực sự cần. Anthropic engineering (2025-2026): agent skills được thiết kế "progressively disclosed — agent reads skill header → SKILL.md body → extra files only if needed" (reddit r/Anthropic 2026); mindstudio 2026: "context window changes shape across the life of a task, content entering and exiting based on actual need"; arXiv 2607.17598: câu hỏi dài tài liệu — "choice between loading whole document vs bolting on separate retrieval" — progressive disclosure là đường giữa. **Thay vì 50 tools + 10.000 dòng instructions trong context** (Cole Medin 2026): agent thấy **chỉ mục** → mở phần cần. Cực quan trọng cho token: context tiết kiệm (MMMM cache không bị hỏng bởi content ít đổi), tập trung (ít nhiễu → quyết định tốt hơn), mya: skills (YY) + MCP tools (OO 80+) đang *tải toàn bộ* — chính là target.

## Mô tả

mya context loader: (1) **chỉ mục** — mỗi skill/tool chỉ có metadata nhỏ (name, 1-dòng mô tả, điều kiện dùng) trong context; (2) **mở rộng theo yêu cầu** — agent thấy chỉ mục, quyết định mở body skill/file/tool spec chi tiết (tool call `open_context(ref)`); (3) **thu hồi** — content không còn cần → đóng (context "exits based on actual need"); (4) **ngưỡng** — tài liệu dài (repo docs, hướng dẫn) → summary trước, mở section sau (nối WWWW compression khi cần giữ lại). Skills mya (YY) đã có cấu trúc header/body — tận dụng: loader nạp header, mở body khi triage chọn skill. MCP tools: registry trả metadata, mở spec khi chọn gọi (nối XXXX subset).

## Kiến trúc

```
  CONTEXT WINDOW (thu nhỏ — chỉ mục)
    skill: [name | 1-line | khi nào dùng]      ← header (YY có sẵn)
    tool:  [name | 1-line | điều kiện]         ← metadata (OO)
    docs:  [summary]                           ← summary (không phải full)
        │  agent chọn "cần cái này"
        ▼
  open_context(ref) ──► mở body/spec/section (nạp phần cần)
        │  xong việc
        ▼
  close_context(ref) ──► thu hồi (context "exits" — mindstudio)
        │
  tài liệu dài: summary → mở section → giữ = WWWW compress
  phối MMMM: prefix ổn định (chỉ mục) — cache bền
```

```
mya: skills (YY) + tool registry (OO) SẴN — nhưng NẠP TOÀN BỘ vào context
     thiếu: loader progressive (metadata → open/close) 
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills (YY) — skill header/body (cấu trúc disclosure sẵn)
// ✅ packages/tools OO — registry (metadata tách spec được)
// ✅ packages/prompts — context builder (nơi sửa loader)
// ✅ WWWW compression — khi cần giữ content dài
// ✅ MMMM prompt cache — prefix ổn định (chỉ mục) hit tốt hơn

// ❌ THIẾU: loader chỉ nạp metadata + open_context tool
// ❌ THIẾU: thu hồi (close) khi không còn cần
// ❌ THIẾU: summary cho tài liệu dài (docs)
```

## Implementation

```typescript
// packages/prompts/src/disclosure.ts (NEW)
interface ContextIndex { refs: Array<{ ref; meta: string }>; }   // chỉ mục nhỏ

function buildIndex(skills: Skill[], tools: Tool[]): ContextIndex {
  return {
    refs: [
      ...skills.map((s) => ({ ref: s.ref, meta: s.header })),
      ...tools.map((t) => ({ ref: t.ref, meta: t.oneLine })),
    ],
  };  // context: CHỈ metadata — không body/spec
}

// tool: open_context(ref) → nạp body/spec vào context
//       close_context(ref) → thu hồi (content exits — mindstudio)
// Anthropic: header → body → extra files only if needed
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Token giảm lớn (không nhét 50 tools + 10k lines) | ❌ Agent phải biết mở đúng lúc (chỉ mục rõ) |
| ✅ Ít nhiễu → chọn tool/quyết định tốt hơn | ❐ open/close context thêm tool call + latency |
| ✅ MMMM cache ổn định hơn (prefix ít đổi) | ❌ Metadata kém → agent mở sai phần |
| ✅ Skills mya có header/body — tận dụng ngay | ❌ Cần luồng thu hồi kỷ luật (context phình) |
| ✅ Nguồn chuẩn: Anthropic + arXiv 2607.17598 | |

## Khác các hướng gần

| | YYYY Skills | WWWW Compression | VVVV: Disclosure |
|---|---|---|---|
| Cơ chế | Nạp theo skill | Nén token | **Nạp dần theo nhu cầu** |
| Vấn đề | Tổ chức tri thức | Context dài | **Context đầy không cần thiết** |
| Mối quan hệ | Cấu trúc để disclosure | Xử lý khi giữ | **Bố trí loader** |

## Khi nào chọn

- Nhiều skills + tools — context window đầy (mya hiện tại)
- Token cost cao (SS) hoặc model context hẹp
- Tri thức có cấu trúc header/body (skills — YY)
- Đã có registry + prompts — sửa loader là bước ngắn