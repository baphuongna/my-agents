# Hướng AFQ: Module-Report / Read-Symbol — `module_report` + `read_symbol` là read-substitute ~4x rẻ hơn read toàn file: module_report trả outline cấu trúc kèm recommendedReads top-3, read_symbol trả đúng body symbol và ghi nhận coverage cho read-guard

> **Nguồn gốc:** pi-lens (docs/features.md) | **Coupling:** 🟢 — tool thuần, không phụ thuộc agent loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có symbol-extractor + lsp-cascade, thiếu module_report/read_symbol tool) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-lens** cung cấp **read-substitute rẻ hơn read toàn file ~4x**: `module_report` phân tích file trả về **outline cấu trúc** (danh sách symbol + vị trí) kèm **recommendedReads top-3** (gợi ý symbol nên đọc), giúp agent quyết định đọc gì thay vì đọc cả file. `read_symbol` trả về **đúng body của một symbol** (function/class) và **ghi nhận coverage** cho read-guard (hệ thống biết agent đã đọc phần nào). Nguyên tắc: **đọc theo cấu trúc, không đọc mù toàn file** — tiết kiệm token và thỏa read-guard.

## Mô tả

mya module-report/read-symbol: (1) **symbol extraction đã sẵn** — `packages/tools` symbol-extractor.ts (TS/JS via nativeParseTsSymbols, Rust/Python/Go regex), lsp-cascade.ts (symbols land Tier 3); (2) **module_report tool** — chạy extractSymbols → outline + recommendedReads top-3 (theo size/relevance); (3) **read_symbol tool** — return body của symbol theo name/range; (4) **coverage tracking** — ghi nhận symbol đã đọc cho read-guard (hashline-edit cần đọc trước edit); (5) **graph/relation** — reference-graph.ts + codegraph.ts cho recommendedReads. Nối AFR (opportunistic read-expansion).

## Kiến trúc (ASCII)

```
  AGENT muốn hiểu file lớn
   │
   ├─ module_report(file) ◀── THAY read toàn file (~4x rẻ)
   │      ▼
   │   OUTLINE: [{name, kind, range, size}]
   │   + recommendedReads top-3 (symbol nên đọc)
   │
   ├─ agent quyết định ──▶ read_symbol(file, "parseConfig")
   │      ▼
   │   BODY đúng symbol parseConfig (không cả file)
   │   + ghi nhận COVERAGE cho read-guard ✓
   │
   └─ khi edit ──▶ read-guard kiểm tra: đã đọc symbol chứa edit chưa?
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools symbol-extractor.ts — nativeParseTsSymbols + regex extractors (outline)
// ✅ packages/tools symbol-extractor.ts — extractSymbols(file) → Symbol[] (name, range)
// ✅ packages/tools lsp-cascade.ts — symbols land Tier 3
// ✅ packages/tools reference-graph.ts + codegraph.ts — relation cho recommendedReads
// ✅ packages/tools hashline-edit.ts — read-guard (cần đọc trước edit)

// ❌ THIẾU: module_report tool (outline + recommendedReads top-3)
// ❌ THIẾU: read_symbol tool (return body symbol + coverage tracking)
// ❌ THIẾU: coverage ledger cho read-guard (đã đọc symbol nào)
```

## Implementation

```typescript
// packages/tools/src/module-report.ts (MỚI)
import { extractSymbols, type Symbol } from "./symbol-extractor.js";
export interface ModuleReport {
  outline: { name: string; kind: string; range: [number, number]; size: number }[];
  recommendedReads: string[];   // top-3 symbol name
}
/** module_report: outline + recommendedReads — rẻ hơn read toàn file. */
export function moduleReport(source: string): ModuleReport {
  const symbols = extractSymbols(source, { root: "", src: "" });
  const outline = symbols.map((s) => ({ name: s.name, kind: s.kind, range: s.range, size: s.range[1] - s.range[0] }));
  const recommendedReads = [...outline].sort((a, b) => b.size - a.size).slice(0, 3).map((s) => s.name);
  return { outline, recommendedReads };
}
/** read_symbol: trả body đúng symbol + ghi coverage. */
export function readSymbol(source: string, name: string, markRead: (sym: string) => void): string {
  const symbols = extractSymbols(source, { root: "", src: "" });
  const sym = symbols.find((s) => s.name === name);
  if (!sym) return "";                  // không tìm thấy
  const [start, end] = sym.range;
  markRead(name);                        // ghi nhận coverage cho read-guard
  return source.split("\n").slice(start - 1, end).join("\n");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ ~4x rẻ hơn read toàn file (tiết kiệm token) | ❌ Cần symbol extraction chính xác (ngôn ngữ lạ → regex kém) |
| ✅ recommendedReads hướng dẫn agent đọc đúng chỗ | ❌ Outline không đủ ngữ cảnh runtime |
| ✅ read_symbol thỏa read-guard (đã đọc trước edit) | ❌ Coverage ledger phải sync (đọc symbol nhưng edit khác symbol) |

## Khác các hướng gần

| | AFQ Module-Report/Read-Symbol | AFR Read-Expansion | lsp-cascade |
|---|---|---|---|
| Cơ chế | Agent chủ động report+read symbol | Tự mở rộng slice→symbol | LSP symbols Tier 3 |
| Trigger | Agent gọi tool | Khi agent đọc slice ≤60 dòng | Lazy populate |
| Coverage | Ghi nhận cho read-guard | Tự ghi trong budget | Không |

## Khi nào chọn

- File lớn, agent cần hiểu cấu trúc trước khi đọc chi tiết
- Muốn tiết kiệm token (~4x rẻ hơn read toàn file)
- Cần thỏa read-guard trước khi edit (đọc đúng symbol chứa edit)
- Guard: symbol extraction fallback đa ngôn ngữ, coverage ledger nhất quán, recommendedReads theo size+relevance
