# Hướng AEG: Word-Level Diff Emphasis — 3 lớp màu hiển thị đồng thời trên cùng cell

> **Nguồn gốc:** pi-diff | **Coupling:** 🟢 — render layer thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn print render; thiếu diff 3 lớp) | **Effort:** 1 tuần

## Nguồn gốc

**pi-diff** renderer (src/index.ts) vẽ diff theo **word-level**: trước tiên **syntax highlight** bằng **Shiki foreground** (màu token theo ngôn ngữ), rồi **chồng diff background** (nền đỏ/xanh cho dòng thêm/xóa), và **background sáng hơn ở các ký tự thay đổi** trong dòng — **3 lớp màu hiển thị đồng thời trên cùng cell**: (1) foreground = syntax; (2) background = diff; (3) background sáng hơn = word-level thay đổi.

Giá trị: đọc diff nhanh hơn — thấy ngay **ký tự nào thay đổi** trong dòng (không phải soi cả dòng), mà vẫn giữ syntax highlight để đọc code. Đây là pattern **visual hierarchy**: 3 lớp thông tin trên cùng pixel, mỗi lớp một vai trò.

## Mô tả

Với mya, `packages/print` có render (skill-search, agents-panel). Pattern thêm **diff renderer 3 lớp**: (1) Shiki (hoặc tương đương) cho foreground syntax; (2) diff background cho dòng added/removed; (3) **emphasis background sáng hơn** tại các ký tự khác nhau (word-level — nối AEF diff engine để biết ký tự nào đổi). Render thành ANSI 24-bit (truecolor) — cell có foreground + background riêng. Dùng cho: diff review trong agent loop (nối AEB ship review diff), APPLY-LOG preview. Gap: print chưa có diff renderer + word-level engine.

## Kiến trúc (ASCII)

```
  DIFF SOURCE (oldText, newText)
    │
    ▼ WORD-LEVEL ENGINE (nối AEF — biết ký tự nào đổi)
    ├─ dòng thêm/xóa
    └─ ký tự thay đổi trong dòng (word-level)
            │
            ▼ RENDERER (3 LỚP TRÊN CÙNG CELL)
    L1. foreground ── Shiki syntax highlight (màu token)
    L2. background ── diff: đỏ (xóa) / xanh (thêm)
    L3. background SÁNG HƠN ── ký tự thay đổi (word-level)
            │
            ▼
  ANSI 24-bit output → terminal
  đọc nhanh: thấy ngay ký tự đổi mà vẫn đọc được code
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/print — render layer (skill-search, agents-panel — nền)
// ✅ packages/tools — hashline-edit (nguồn diff cho preview)
// ✅ packages/tools/src/cascade-replace.ts (nếu có — nối AEF word-level)
// ✅ packages/core — ToolResult (trả diff qua tool)
// ✅ packages/eval — diff review test

// ❌ THIẾU: Shiki (hoặc tương đương) syntax highlight foreground
// ❌ THIẾU: word-level diff engine (ký tự nào đổi trong dòng)
// ❌ THIẾU: 3 lớp render — foreground + background + emphasis background
```

## Implementation

```typescript
// packages/print/src/diff-render.ts (NEW)
export interface DiffCell {
  char: string;
  foreground: string;   // Shiki token màu (syntax)
  background: string;   // diff: đỏ/xanh (dòng)
  emphasis: boolean;    // word-level: ký tự thay đổi → sáng hơn
}

export function renderDiffLine(oldLine: string, newLine: string, lang: string): string {
  const cells = wordLevelCells(oldLine, newLine);   // nối AEF engine
  const syntax = shikiHighlight(newLine, lang);      // L1: foreground

  let out = "";
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] ?? { char: " ", foreground: "default", background: "default", emphasis: false };
    const fg = c.emphasis ? "white" : syntax.tokenColor(i) ?? c.foreground;
    const bg = c.emphasis ? brighten(c.background)      // L3: sáng hơn
             : c.background;                             // L2: diff background
    out += ansi24(fg, bg, c.char);                       // cell: fg + bg cùng lúc
  }
  return out;
}

function wordLevelCells(oldL: string, newL: string): DiffCell[] {
  // chạy word-level diff (nối AEF cascade/levenshtein) — đánh dấu ký tự đổi
  const ops = diffWords(oldL, newL);
  return ops.map((op) => ({
    char: op.text, foreground: "default",
    background: op.kind === "add" ? "green" : op.kind === "del" ? "red" : "default",
    emphasis: op.kind !== "equal",                      // ký tự thay đổi
  }));
}

export function renderDiffBlock(oldText: string, newText: string, lang: string): string {
  return splitLines(oldText, newText)
    .map(({ kind, line }) => renderDiffLine(oldLineOf(kind, line), line, lang))
    .join("\n");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thấy ngay ký tự nào đổi — đọc diff nhanh | ❌ 3 lớp màu đòi hỏi terminal truecolor |
| ✅ Giữ syntax highlight khi đọc code | ❌ Shiki heavy — cần cache token |
| ✅ Dòng thêm/xóa rõ ràng + emphasis chi tiết | ❌ Word-level engine thêm chi phí render |
| ✅ Nối AEF (biết ký tự đổi) | ❌ ANSI phức tạp — test render khó |

## Khác các hướng gần

| | AEG Word-Level Diff | AEF Cascade Replace | AEC Apply Log |
|---|---|---|---|
| Trọng tâm | Hiển thị diff | Sửa code an toàn | Audit thay đổi |
| Cơ chế | 3 lớp màu (fg + bg + emphasis) | 4 tầng khớp + Levenshtein | Bảng # + Verified |
| Dùng cho | Review diff | Edit tool | Migration audit |

## Khi nào chọn

- Review diff thường xuyên — cần thấy ký tự đổi nhanh
- Terminal hỗ trợ truecolor (24-bit ANSI)
- Đã có print render + AEF diff engine — thêm renderer 3 lớp
- Muốn vừa syntax highlight vừa diff emphasis trên cùng cell