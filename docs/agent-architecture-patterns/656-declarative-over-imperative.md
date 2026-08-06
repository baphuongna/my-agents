# Hướng YF: Declarative over Imperative — ưu tiên mô tả declarative thay vì imperative để agent không tự bịa bước thực thi — một trong 4 quy tắc coding (gstack/README.md)

> **Nguồn gốc:** andrej-karpathy-skills (gstack/README.md) | **Coupling:** 🟢 — quy tắc viết prompt/skill, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill model + progressive disclosure — chưa có declarative lint) | **Effort:** 1 tuần

## Nguồn gốc

**andrej-karpathy-skills** (gstack) liệt kê **4 quy tắc coding** cho agent — một trong số đó: **declarative over imperative**. Khi yêu cầu agent làm việc gì, mô tả **kết quả mong muốn** (declarative: "đảm bảo tất cả file test chạy qua") thay vì **liệt kê lệnh thực thi** (imperative: "chạy lệnh A rồi lệnh B rồi đọc file C"). Lý do: prompt imperative khiến agent **bịa bước thực thi** khi một bước thiếu — declarative để agent tự chọn cách đạt mục tiêu, tự báo khi không chắc, ít bịa hơn.

## Mô tả

mya áp dụng declarative-over-imperative ở 3 tầng: (1) **skill body** — viết "khi xảy ra X, đảm bảo trạng thái Y" thay vì "chạy lệnh 1, 2, 3"; (2) **tool schema** — mô tả input/output theo intent, không theo lệnh; (3) **task prompt** — goal state + constraints + acceptance criteria. Kèm **lint kiểm tra**: skill/task chứa chuỗi imperative rõ rệt (bắt đầu bằng "chạy", "gõ", "nhấn") → cảnh báo, đề nghị chuyển declarative. mya có sẵn skills/skill.ts (frontmatter + body), prompts/assembler (ghép prompt), prompts/drift (đo drift khi nén) — YF thêm **declarative linter** + **goal-state schema**.

## Kiến trúc

```
  Imperative:   "chạy `npm test`, nếu fail mở file X, sửa dòng Y, chạy lại"
                     │
                     ▼  (agent thiếu bước 3 → tự bịa)
  Declarative:  "Mục tiêu: suite test xanh.
                 Constraints: không đổi API public.
                 Acceptance: `npm test` pass, coverage ≥ 80%."
                     │
                     ▼
  Linter: skill/task text → scan mệnh lệnh imperative
          ("chạy", "gõ", "nhấn", "sửa dòng") → warn + gợi ý goal-state
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SKILL.md frontmatter + body (nền — YF lint body)
// ✅ packages/prompts assembler.ts — ghép prompt từ phần (nền — YF áp lúc assemble)
// ✅ packages/prompts drift.ts — đo drift (nền — YF đo declarative có giữ ý không)
// ✅ packages/core session.ts — goal/plan lưu session (nền — YF goal state)

// ❌ THIẾU: declarative linter (scan imperative phrase)
// ❌ THIẾU: goal-state schema (mục tiêu + constraints + acceptance)
```

## Implementation (TS)

```typescript
// packages/skills/src/declarative-lint.ts (MỚI)
export interface LintIssue {
  line: number;
  kind: "imperative" | "ok";
  text: string;
}

const IMPERATIVE_HINTS = [
  /\b(chạy|lệnh|gõ|nhấn)\s+[`'"`]/i,   // "chạy `npm test`"
  /\b(sửa|đổi|thêm|xóa)\s+dòng\b/i,    // "sửa dòng 42"
  /^\s*[0-9]+[.)]\s*(chạy|gõ|mở|đọc)/m, // "1. chạy ..."
];

export function lintDeclarative(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (IMPERATIVE_HINTS.some((re) => re.test(line))) {
      issues.push({ line: i + 1, kind: "imperative", text: line.trim() });
    }
  }
  return issues;
}

/** Chuẩn hóa task: imperative → goal-state declarative. */
export function toGoalState(imperative: string): string {
  return [
    "Mục tiêu (goal state):",
    `  ${imperative.replace(/^(chạy|lệnh|gõ|nhấn)\s+/i, "").replace(/`/g, "")}`,
    "Constraints: không đổi API public, không phá test hiện có.",
    "Acceptance: tự chọn cách thực hiện; báo rõ nếu không đạt được goal.",
  ].join("\n");
}

// Usage:
// const issues = lintDeclarative(skill.body);
// if (issues.length) warn(`skill ${name} có imperative hint:`, issues);
// const goal = toGoalState("chạy `npm test` và sửa file test fail");
// → agent nhận goal state, tự chọn bước, không bịa lệnh thiếu
```

## Được

- ✅ Ít bịa bước — agent tự chọn cách đạt goal, không bịa lệnh thiếu
- ✅ Prompt bền — goal state ít nhạy với thay đổi môi trường hơn lệnh cứng
- ✅ Lint được — scan imperative phrase, enforce bằng máy
- ✅ Áp được nhiều tầng — skill body, tool schema, task prompt
- ✅ Kết hợp drift — đo declarative có được giữ qua nén không

## Mất

- ❌ Goal mơ hồ — declarative thiếu chi tiết → agent chọn cách sai
- ❌ Thiếu sequence — vài việc thực sự cần thứ tự (migrate DB trước deploy)
- ❌ Lint false positive — imperative phrase hợp lệ (skill dạy gõ lệnh cụ thể)

## Khác các hướng gần

| | Imperative prompt | ReAct (lý luận + hành động) | YF: Declarative Goal |
|---|---|---|---|
| Hướng dẫn | lệnh cụ thể | bước lý luận | **mô tả kết quả** |
| Bịa bước | dễ (thiếu lệnh) | trung bình | **thấp** |
| Kiểm máy | không | trace | **linter scan** |

## Khi nào chọn

- Skill/task hay bị agent "bịa bước" khi thiếu một lệnh
- Muốn enforce phong cách viết bằng linter (không chỉ khuyên)
- Có skills skill.ts + prompts assembler sẵn — YF thêm lint + goal-state
- Nối packages/skills skill.ts (lint body lúc load) + prompts/assembler.ts (áp lúc assemble) + prompts/drift.ts (đo giữ ý); guard false-positive (whitelist skill dạy lệnh cụ thể — ví dụ tmux skill), goal-ambiguity (goal thiếu acceptance → yêu cầu bổ sung), và sequence-preserve (việc có thứ tự bắt buộc → khai báo `order` field riêng); YF = declarative goal, kết hợp 657 YG minimal-complexity-gate (đừng thêm quy tắc thừa) + 646 XV assumption-gate (goal state kèm assumption rõ)
