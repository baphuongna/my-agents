# Hướng AFR: Opportunistic Read-Expansion — khi agent đọc slice ≤60 dòng, pi-lens dùng tree-sitter AST mở rộng read tới toàn bộ enclosing symbol trong budget 200ms, giúp edit trong symbol pass guard mà không cần đọc từng dòng

> **Nguồn gốc:** pi-lens (clients/read-expansion.ts) | **Coupling:** 🟢 — intercept read, dùng AST sẵn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có symbol-extractor tree-sitter + hashline read-guard, thiếu auto-expand) | **Effort:** 1 tuần

## Nguồn gốc

**pi-lens** `read-expansion` opportunistically mở rộng read: khi agent chỉ đọc **slice ≤60 dòng** (đoạn nhỏ), pi-lens dùng **tree-sitter AST** phát hiện slice nằm trong symbol nào, rồi **mở rộng read tới toàn bộ enclosing symbol** (cả function/class chứa slice). Budget giới hạn **200ms** để không chậm. Mục đích: agent đọc ít dòng nhưng vẫn có đủ ngữ cảnh symbol → khi edit trong symbol đó, **pass read-guard** (đã đọc cả symbol) mà không phải đọc từng dòng thủ công. Nguyên tắc: **mở rộng thông minh theo AST**, không ép agent đọc thủ công.

## Mô tả

mya opportunistic-read-expansion: (1) **tree-sitter symbol extraction đã sẵn** — `packages/tools` symbol-extractor.ts (nativeParseTsSymbols, Rust tree-sitter); (2) **read intercept** — khi read tool trả slice ≤60 dòng, hook mở rộng; (3) **enclosing symbol detect** — tìm symbol có range chứa slice; (4) **expand to symbol** — mở rộng read tới range symbol; (5) **budget 200ms** — guard nếu parse chậm thì bỏ (graceful degrade); (6) **read-guard** — hashline-edit.ts cần đã đọc trước edit. Nối AFQ (read-symbol coverage).

## Kiến trúc (ASCII)

```
  AGENT read file (slice dòng 100-140, ≤60 dòng)
   │
   ▼  read-expansion hook
  tree-sitter AST parse (budget 200ms)
   │
   ├─ parse xong trong budget? 
   │   ├─ CÓ → tìm ENCLOSING SYMBOL (range chứa slice 100-140)
   │   │      ví dụ function parseConfig (dòng 80-170)
   │   │      ▼ MỞ RỘNG read tới 80-170 (toàn bộ symbol)
   │   │      agent nhận đủ ngữ cảnh symbol → EDIT pass read-guard ✓
   │   │
   │   └─ KHÔNG (parse chậm) → graceful degrade, trả slice gốc
   │
   └─ slice >60 dòng? → không mở rộng (đã đủ lớn)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools symbol-extractor.ts — nativeParseTsSymbols (tree-sitter) + Symbol.range
// ✅ packages/tools symbol-extractor.ts — extractSymbols → Symbol[] có range [start,end]
// ✅ packages/tools hashline-edit.ts — read-guard (cần đọc trước edit)
// ✅ packages/tools lsp-cascade.ts — AST/symbol nền

// ❌ THIẾU: read-expansion hook (slice ≤60 → enclosing symbol)
// ❌ THIẾU: budget 200ms guard (parse chậm → degrade)
```

## Implementation

```typescript
// packages/tools/src/read-expansion.ts (MỚI)
import { extractSymbols, type Symbol } from "./symbol-extractor.js";
const SLICE_THRESHOLD = 60;
const BUDGET_MS = 200;
/** Mở rộng slice ≤60 dòng tới enclosing symbol (budget 200ms). */
export function opportunisticExpand(
  source: string,
  sliceStart: number,
  sliceEnd: number,
  markRead: (range: [number, number]) => void,
): { start: number; end: number; expanded: boolean } {
  const sliceLines = sliceEnd - sliceStart;
  if (sliceLines > SLICE_THRESHOLD) return { start: sliceStart, end: sliceEnd, expanded: false };
  const t0 = Date.now();
  let symbols: Symbol[];
  try {
    symbols = extractSymbols(source, { root: "", src: "" });
  } catch {
    return { start: sliceStart, end: sliceEnd, expanded: false };  // degrade
  }
  if (Date.now() - t0 > BUDGET_MS) return { start: sliceStart, end: sliceEnd, expanded: false };
  // Tìm enclosing symbol: range chứa slice.
  const enclosing = symbols.find((s) => s.range[0] <= sliceStart && sliceEnd <= s.range[1]);
  if (!enclosing) return { start: sliceStart, end: sliceEnd, expanded: false };
  const [start, end] = enclosing.range;
  markRead([start, end]);   // ghi coverage cho read-guard
  return { start, end, expanded: true };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent đọc ít dòng nhưng đủ ngữ cảnh symbol | ❌ Budget 200ms có thể truncate file cực lớn |
| ✅ Edit trong symbol pass read-guard tự động | ❌ tree-sitter parse overhead (dù có budget) |
| ✅ Graceful degrade khi parse chậm/lỗi | ❌ Ngôn ngữ không có tree-sitter → không mở rộng |

## Khác các hướng gần

| | AFR Read-Expansion | AFQ Module-Report | read toàn file |
|---|---|---|---|
| Trigger | Agent đọc slice ≤60 | Agent gọi tool | Agent gọi read |
| AST | tree-sitter tự mở rộng | extractSymbols outline | không |
| Token | Vừa đủ symbol | Rẻ nhất (outline) | Đắt nhất |

## Khi nào chọn

- Agent hay đọc slice nhỏ nhưng cần edit trong symbol (pass read-guard)
- Muốn tự động có ngữ cảnh symbol mà không ép agent đọc thủ công
- File có tree-sitter support (TS/JS/Rust...)
- Guard: budget 200ms, graceful degrade, chỉ mở rộng khi slice ≤60, markRead cho guard
