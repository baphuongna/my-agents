# Hướng ABG: Definition-First Hinting — phân loại dòng code giống định nghĩa ngay phía Rust, trả hint không tốn regex trong prompt

> **Nguồn gốc:** fff (README.md) | **Coupling:** 🟢 — thêm classifier vào search index + result | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có search-index + native parse — chưa có definition-first hint) | **Effort:** 1-2 tuần

## Nguồn gốc

**fff** khi tìm file/định nghĩa: phân loại **dòng code giống định nghĩa** (function, class, method...) **ngay phía Rust** — trong lúc scan/parse, không đợi prompt của agent. Kết quả trả về kèm **hint definition-first**: agent thấy ngay "đây là function definition" mà **không tốn regex overhead trong prompt** (không phải tự đoán dòng nào là definition, không phải chạy regex pattern dài trong prompt/context). Bản chất: **classification xảy ra ở tầng index (Rust, hot loop), hint là structured data, agent chỉ tiêu thụ** — zero regex chi phí ở phía agent. Nguyên tắc: **classify ở index layer, hint definition-first, agent không tự regex**.

## Mô tả

mya definition-first hinting: khi build/search index, mỗi file được **classify** ngay lúc parse: dòng nào là **definition** (function/class/method/const declaration...), dòng nào là call/usage. Lưu hint vào index; khi search trả kết quả, **definition match xếp trước** usage match + gắn tag `definition`. Agent đọc kết quả là biết ngay nên mở file nào để xem định nghĩa — không phải tự chạy regex trong prompt. mya có packages/tools search-index.ts (index + frecency) + symbol-extractor.ts (nativeParseTsSymbols phân loại symbol) — ABG thêm **definition hint vào index** + **definition-first ranking** + **tag trong result**.

## Kiến trúc

```
  SOURCE FILE (a.ts)
  │  function login(user) {        ← DEFINITION (classify khi parse)
  │  const r = login(u);           ← USAGE
  │  class Auth {                  ← DEFINITION
  ▼
  INDEX LAYER (Rust/native, hot loop — classify ở đây, không đợi agent)
  ┌───────────────────────────────────────────────┐
  │  "login"  → { kind: "function", definition: true, line: 3 }
  │  "Auth"   → { kind: "class",   definition: true, line: 8 }
  │  "login"  → { kind: "call",    definition: false, line: 5 }
  └───────────────────────┬───────────────────────┘
                          ▼
  SEARCH "login" → RESULT
    [1] a.ts:3  fn login  (definition)   ← xếp trước
    [2] a.ts:5  call login              ← usage
  → agent thấy hint definition-first, zero regex trong prompt
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools search-index.ts — SearchIndex + frecency + bigram (nền — ABG index layer)
// ✅ packages/tools symbol-extractor.ts — extractSymbols (nền — ABG definition classify)
// ✅ packages/natives nativeParseTsSymbols — parse symbol (nền — ABG Rust classify)
// ✅ packages/tools find.ts + builtin.ts — find/grep tools (nền — ABG result enrichment)

// ❌ THIẾU: definition hint trong index (kind + definition flag per entry)
// ❌ THIẾU: definition-first ranking (definition match xếp trước usage)
// ❌ THIẾU: tag definition trong result (agent thấy ngay, không tự regex)
```

## Implementation

```typescript
// packages/tools/src/definition-hint.ts (MỚI)
import { nativeParseTsSymbols, type AstSymbol } from "@my-agent/natives";

export type EntryKind = "function" | "class" | "method" | "variable" | "type" | "call" | "usage";

export interface HintEntry {
  name: string;
  kind: EntryKind;
  definition: boolean;
  line: number;
  path: string;
}

/** Classify dòng: definition (function/class/method/const...) vs usage — dùng native parse. */
export function classifyDefinitions(src: string, path: string): HintEntry[] {
  const entries: HintEntry[] = [];
  for (const sym of nativeParseTsSymbols(src)) {
    entries.push({ name: sym.name, kind: mapKind(sym), definition: true, line: sym.line, path });
  }
  // usage heuristic: identifier xuất hiện sau definition mà không phải declaration
  const defined = new Set(entries.map(e => e.name));
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1]!;
    if (defined.has(name) && !entries.some(e => e.name === name && e.line === lineOf(src, m.index!))) {
      entries.push({ name, kind: "call", definition: false, line: lineOf(src, m.index!), path });
    }
  }
  return entries;
}

function mapKind(sym: AstSymbol): EntryKind {
  return (["function", "class", "method", "variable", "type"] as const).includes(sym.kind as EntryKind)
    ? (sym.kind as EntryKind)
    : "usage";
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/** Definition-first ranking: definition entries luôn xếp trước usage. */
export function definitionFirst(entries: HintEntry[], query: string): HintEntry[] {
  const q = query.toLowerCase();
  const match = entries.filter(e => e.name.toLowerCase().includes(q));
  return [...match.filter(e => e.definition), ...match.filter(e => !e.definition)];
}
// Usage:
// const hints = classifyDefinitions(source, "a.ts");
// const ranked = definitionFirst(hints, "login"); // definition trước, usage sau
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tiết kiệm token (không tự regex tìm definition trong prompt) | ❌ Classification sai (usage bị đánh nhầm definition — hiếm) |
| ✅ Kết quả chính xác (native parse, không heuristic mờ) | ❌ Native dependency (không có .node → fallback JS kém hơn) |
| ✅ Definition-first (agent mở đúng file định nghĩa ngay) | ❌ Index refresh (file sửa → hint cũ tới khi re-index) |
| ✅ Zero regex overhead (hint structured, không phải pattern dài) | ❌ Chỉ TS/JS tốt (Rust/Python classify kém hơn) |

## Khác các hướng gần

| | Regex trong prompt | Full symbol search | ABG: Definition-First Hint |
|---|---|---|---|
| Classify | agent tự làm (tốn token) | index symbol | **index + hint sẵn** |
| Ranking | không | symbol/usage lẫn lộn | **definition trước usage** |
| Chi phí agent | cao (regex dài) | thấp | **thấp nhất (hint sẵn)** |

## Khi nào chọn

- Agent thường xuyên tìm định nghĩa (function/class) trong codebase lớn
- Muốn giảm token cho prompt (không để agent tự regex tìm definition)
- Đã có native parse (packages/natives) + search-index (packages/tools)
- Nối packages/tools search-index.ts + symbol-extractor.ts + packages/natives nativeParseTsSymbols; guard kind-accuracy (chỉ đánh definition khi native parse xác nhận), index-freshness (re-classify khi file đổi), và fallback-parity (JS fallback vẫn trả hint, kém hơn nhưng đúng shape); ABG = definition-first hinting, kết hợp 639 XO (index incremental — hint cập nhật theo fingerprint) + 738 ABJ runtime-switchable-tool-modes (hint là một mode của tool search)
