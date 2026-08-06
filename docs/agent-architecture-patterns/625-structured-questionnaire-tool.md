# Hướng XA: Structured Questionnaire Tool — model hỏi người dùng bằng dialog có cấu trúc (multi-select, preview markdown, per-option notes, Other fallback)

> **Nguồn gốc:** rpiv-mono (structured dialog tool); "multi-select", "preview markdown", "per-option notes", "Other fallback" | **Coupling:** 🟡 — thêm structured-question tool (UI-dependent, kết hợp WZ strip headless) | **Agent-agnostic:** ⚠️ (cần interactive UI / approval surface) | **Code sẵn:** ⚠️ (approval tool sẵn — chưa có structured dialog + multi-select + Other fallback) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** cho model **hỏi người dùng** không qua free-text mà qua **dialog có cấu trúc**: model gọi tool trả payload `{ question, options[], multiSelect, preview, notes }`. UI render dialog: **multi-select** (chọn nhiều), **preview markdown** (render nội dung trước xác nhận — vd diff code), **per-option notes** (mỗi lựa chọn kèm giải thích "chọn cái này vì..."), và **Other fallback** (nếu không option nào hợp → user gõ tự do). Model nhận **structured answer** (mảng lựa chọn + note) thay vì parse free-text. Nguyên tắc: **hỏi có cấu trúc → trả có cấu trúc** — giảm ambiguity, cho phép preview trước commit.

## Mô tả

mya structured questionnaire tool: tool `ask_structured` nhận payload (question, options, multiSelect, preview, notes), render dialog interactive, trả structured answer (selected[] + otherText?). Tool UI-only (strip khi headless — kết hợp WZ). mya có approval tool — XA thêm **multi-select dialog** + **markdown preview** + **per-option notes** + **Other fallback**.

## Kiến trúc

```
  ┌─── model gọi ask_structured(payload) ─────────────────┐
  │  payload = {                                            │
  │    question: "Chọn phương án refactor nào?",            │
  │    options: [                                           │
  │      { id:"a", label:"Extract module", note:"tách file" },│  ← per-option note
  │      { id:"b", label:"Inline", note:"gộp vào" }         │
  │    ],                                                   │
  │    multiSelect: false,                                  │
  │    preview: "```diff\n- old\n+ new\n```",               │  ← markdown preview
  │  }                                                      │
  └───────────────────────┬───────────────────────────────┘
                          ▼
  ┌─── DIALOG UI (interactive render) ────────────────────┐
  │  [preview markdown render]                              │
  │  ○ a — Extract module (tách file)                       │
  │  ○ b — Inline (gộp vào)                                 │
  │  ○ Other: [______________]  ← fallback (gõ tự do)       │
  └───────────────────────┬───────────────────────────────┘
                          ▼
  ┌─── structured answer ─────────────────────────────────┐
  │  { selected: ["a"], otherText: null }   (chọn option)   │
  │  { selected: [], otherText: "viết lại từ đầu" } (Other)  │  ← fallback
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools approval.ts — approval tool (nền — XA dialog analog)
// ✅ packages/core session.ts — session (nền — XA answer carry)
// ✅ 624 WZ tool-capability-reconciliation — strip khi headless (relate)

// ❌ THIẾU: structured dialog payload (options, multiSelect, preview, notes)
// ❌ THIẾU: multi-select render + per-option notes
// ❌ THIẾU: markdown preview + Other fallback
```

## Implementation

```typescript
// packages/tools/src/ask-structured.ts (MỚI)
interface Option { id: string; label: string; note?: string }
interface QuestionPayload {
  question: string;
  options: Option[];
  multiSelect?: boolean;
  preview?: string;     // markdown diff/preview
}
interface Answer { selected: string[]; otherText: string | null }

type RenderDialog = (payload: QuestionPayload) => Promise<Answer>; // UI binding

function makeAskStructured(render: RenderDialog) {
  return {
    meta: { name: "ask_structured", requiresUI: true }, // strip headless (WZ)
    async run(payload: QuestionPayload): Promise<{ ok: boolean; output: Answer }> {
      // validate
      if (!payload.options.length && !payload.preview) throw new Error("empty question");
      const answer = await render(payload); // dialog interactive
      // reject rỗng (không chọn + không Other) → model phải hỏi lại
      if (!answer.selected.length && !answer.otherText) {
        return { ok: false, output: { selected: [], otherText: null } };
      }
      return { ok: true, output: answer };
    },
  };
}

// Usage:
// const tool = makeAskStructured(renderDialog);
// const { output } = await tool.run({ question:"Refactor?", options:[{id:"a",label:"Extract"}], preview:diffMd });
// → output.selected = ["a"]  hoặc  output.otherText = "user gõ tự do"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Structured answer (selected[], không parse free-text) | ❌ UI-dependent (strip khi headless — cần WZ) |
| ✅ Preview trước commit (markdown diff render) | ❌ Render complexity (multi-select + notes + preview) |
| ✅ Per-option notes (giải thích chọn lựa) | ❌ Option-exhaustion (model quên option hợp → Other spam) |
| ✅ Other fallback (user thoát khi không option hợp) | ❌ Block latency (chờ user answer block agent loop) |

## Khác các hướng gần

| | Free-text prompt | Yes/No approval | XA: Structured-Dialog |
|---|---|---|---|
| Lựa chọn | parse free-text | binary | **✅ multi-select options** |
| Preview | ❌ | ❌ | **✅ markdown diff** |
| Fallback | implicit | ❌ | **✅ Other text** |

## Khi nào chọn

- Model cần hỏi user với lựa chọn rời rạc + preview trước khi hành động
- Muốn structured answer (không parse free-text) + Other fallback thoát
- Nối packages/tools approval.ts + packages/core session.ts + 624 WZ tool-capability-reconciliation (strip headless); guard option-coverage (model nên liệt kê option hợp, Other là safety net không mặc định), preview-safety (preview read-only, không execute), và timeout-answer (default answer sau N giây nếu user không phản hồi); XA = structured questionnaire tool, kết hợp 624 WZ (strip khi no-UI) + 626 XB side-conversation-clone (hỏi side thay vì block loop chính)
