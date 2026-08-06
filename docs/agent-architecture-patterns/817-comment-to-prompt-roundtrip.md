# Hướng AEK: Comment-to-Prompt Roundtrip — comment trên diff được biên dịch thành feedback prompt có file:line range

> **Nguồn gốc:** pi-diff-review | **Coupling:** 🟢 — biên dịch thuần, chỉ nối vào editor ở cuối | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn loop + history; thiếu comment model) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-diff-review** (src/prompt.ts): người dùng **draft comment trên original side / modified side / whole file** trong review window; lúc submit, comment được **biên dịch thành feedback prompt** có **file:line range "(old)/(new)"** rồi **chèn thẳng vào editor của pi** (agent). Tức: comment UI → **structured feedback** (vị trí + nội dung + side) → prompt cho agent sửa đúng chỗ. Không phải người dùng tự gõ "sửa dòng 42 file x.ts" — window sinh sẵn range từ vị trí comment.

Giá trị cốt lõi: (1) **precision** — range "(old)/(new)" phân biệt dòng bên original vs bên modified (quan trọng với diff — một dòng có 2 tọa độ); (2) **roundtrip khép kín** — comment sinh ở UI review, quay lại agent loop thành instruction, sửa xong diff lại hiện trong review — vòng feedback đóng; (3) **ngữ cảnh đầy đủ** — file path + side + line + comment text, agent khỏi đoán.

## Mô tả

Với mya, pattern = **comment model + compiler** trong transport: (1) **comment model** — `{ file, side: "old" | "new" | "whole", lineOld?, lineNew?, text }` (nối AEI review window thu thập); (2) **compiler** — biến model thành prompt block chuẩn: `File: path\nRange: (old:12-14)/(new:12-15)\nComment: text` — range tính từ vị trí comment, "old/new" theo side; (3) **inject** — chèn prompt vào lần turn kế tiếp (mya có `request-context.ts` rebuilder P1-P7 — thêm một rebuilder chèn review feedback vào volatile tier; `prompts/inject.ts` đã scan injection — comment từ user cũng nên qua scan). Roundtrip: sửa xong → diff mới → review window lại mở (AEI) — vòng đóng. Đây là pattern **structured feedback** — giống bài học SSRN: agent tự sửa tốt hơn khi feedback có vị trí cụ thể.

## Kiến trúc (ASCII)

```
  REVIEW WINDOW (AEI) — user comment trên
  ├─ original side ──► side:"old", lineOld:N
  ├─ modified side ──► side:"new", lineNew:N
  └─ whole file   ──► side:"whole"
          │
          ▼ COMPILER (prompt.ts)
  FeedbackPrompt {
    file, side, range: "(old:12-14)/(new:12-15)", text
  }
          │
          ▼ INJECT vào editor agent (request-context rebuilder)
  Agent sửa đúng chỗ → diff mới → review lại (vòng đóng)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts/src/request-context.ts — rebuilder hook
//   (P1-P7: chèn volatile tier — nơi feedback prompt vào)
// ✅ packages/core/src/loop.ts — vòng agent (nhận prompt mới mỗi turn)
// ✅ packages/prompts/src/inject.ts — scan injection (chạy trên context)
// ✅ packages/intercom — UI surface (comment có thể gom từ đây)
// ✅ packages/rpc — transport (review window ↔ agent)

// ❌ THIẾU: comment model (side + lineOld/lineNew + text)
// ❌ THIẾU: compiler → FeedbackPrompt có "(old)/(new)" range
// ❌ THIẾU: rebuilder inject feedback (nối request-context)
```

## Implementation

```typescript
// packages/print/src/comment-to-prompt.ts (NEW)
export type CommentSide = "old" | "new" | "whole";

export interface ReviewComment {
  file: string;
  side: CommentSide;
  lineOld?: number;   // dòng bên original (side:"old")
  lineNew?: number;   // dòng bên modified (side:"new")
  text: string;
}

/** Compiler: comment → feedback prompt có "(old)/(new)" range. */
export function compileComment(c: ReviewComment): string {
  const range = c.side === "old"
    ? `(old:${c.lineOld})`
    : c.side === "new"
      ? `(new:${c.lineNew})`
      : "(whole file)";
  return [
    `## Review feedback — ${c.file}`,
    `Range: ${range}`,
    `Comment: ${c.text}`,
  ].join("\n");
}

/** Inject qua request-context rebuilder (P4: shallow-copy, P5: request-only). */
export function reviewFeedbackRebuilder(comments: ReviewComment[]) {
  return (input: RequestContext) => {
    if (comments.length === 0) return null;   // P1: no-op giữ cache-stable
    const block = comments.map(compileComment).join("\n\n");
    return { context: input.context, volatile: `${input.volatile}\n\n${block}` };
  };
}
// Nối AEI: window submit comments → compile → rebuilder → turn kế tiếp
// Nối inject.ts: feedback chạy qua scan trước khi vào prompt
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Feedback chính xác vị trí — agent sửa đúng chỗ | ❌ Range sai khi diff đổi giữa comment và submit |
| ✅ Phân biệt old/new — đúng bản chất diff | ❌ Comment nhiều → prompt dài (cần gom/gộp) |
| ✅ Roundtrip đóng: review → sửa → review | ❌ Phải giữ comment model đồng bộ UI + compiler |
| ✅ Nối request-context rebuilder tự nhiên | ❌ Side "whole file" thiếu precision — cần dùng ít |

## Khác các hướng gần

| | AEK Comment→Prompt | AEI Review Window | ADQ Rewrite Registry |
|---|---|---|---|
| Trọng tâm | Feedback thành prompt | UI review | Quyết định rewrite |
| Cơ chế | Compiler + rebuilder | RPC + Monaco | 3 đường quyết định |
| Quan hệ | Đầu ra của AEI | Nguồn comment | Khác miền (output) |

## Khi nào chọn

- User hay review diff và muốn feedback vào đúng chỗ
- Đã có AEI review window + request-context rebuilder
- Muốn vòng sửa-lỗi khép kín (review → sửa → review lại)
- Cần structured feedback thay vì "sửa giúp tôi" chung chung