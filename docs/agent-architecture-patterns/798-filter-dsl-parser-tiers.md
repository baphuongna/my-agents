# Hướng ADR: Filter DSL Parser Tiers — hai tầng reducer với parser 3 tier, degrade visible

> **Nguồn gốc:** Hypa | **Coupling:** 🟡 — parser giữa output thô và context | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn tools filter; thiếu DSL parser tiers) | **Effort:** 1-2 tuần

## Nguồn gốc

**Hypa** có **ADRs/0006-filter-dsl-and-parser-tiers.md**: hai loại reducer — **compiled reducers** (C#) cho tool phức tạp (hiểu sâu format output, xử lý có logic) và **declarative TOML filter DSL** cho line-oriented filters: **ANSI strip** (bỏ màu), **regex** (lọc dòng khớp), **truncation** (cắt độ dài). DSL khai báo ngắn gọn, không cần code.

Parser có **3 tier**: (1) **full parse** — DSL hợp lệ, áp dụng đúng; (2) **degraded parse** — DSL có vấn đề nhỏ, parse được phần an toàn, kèm **warning**; (3) **passthrough với marker** — DSL không parse được, không áp dụng, đánh dấu rõ. Nguyên tắc: **degrade visible chứ không silently produce bad output** — nếu không hiểu filter thì đừng áp dụng bừa, hãy nói rõ.

## Mô tả

Với mya, DSL parser đặt trong `packages/tools` (cạnh RewriteRegistry — nối ADQ): filters khai báo bằng TOML, parser 3 tier giống hệt, marker trên output khi passthrough. `packages/prompts` drift.ts có thể verify filter không làm đổi ý nghĩa (replay golden trace). Cần chú ý ANSI handling — terminal output có màu, strip sai sẽ vỡ layout; `packages/print` render có thể dùng chung parser. Rule "degrade visible" nối `packages/core` DegradedResult — đã có sẵn khái niệm degraded.

## Kiến trúc (ASCII)

```
  COMMAND OUTPUT (thô, có ANSI, dài)
    │
    ▼ FILTER DSL PARSER (TOML)
    ├─ full parse    ──► áp dụng filters đúng (ANSI strip, regex, truncate)
    ├─ degraded parse ──► áp dụng phần an toàn + WARNING hiển thị
    └─ passthrough   ──► không áp dụng + MARKER "[unparsed filter]"
            │
            ▼
  OUTPUT VÀO CONTEXT
  ⚠️ degrade visible — không silently produce bad output
  (compiled reducers C#/TS cho tool phức tạp — nối ADQ registry)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools — dispatch + runToolBatch (nơi chèn parser)
// ✅ packages/core — DegradedResult + ToolResult (marker/degrade sẵn)
// ✅ packages/prompts — drift.ts (nền verify filter không đổi nghĩa)
// ✅ packages/print — render layer (dùng chung ANSI handling)
// ✅ packages/audit — AuditLog (ghi tier nào đã dùng)

// ❌ THIẾU: TOML filter DSL schema (ansi/regex/truncate)
// ❌ THIẾU: parser 3 tier với warning + marker
// ❌ THIẾU: compiled reducer registry cho tool phức tạp
```

## Implementation

```typescript
// packages/tools/src/filter-dsl.ts (NEW)
export interface Filter { op: "strip-ansi" | "regex" | "truncate"; args: string[]; }

export type ParseTier = "full" | "degraded" | "passthrough";

export function parseFilters(toml: string): { tier: ParseTier; filters: Filter[]; warning?: string } {
  const filters: Filter[] = [];
  const lines = toml.split("\n");
  for (const line of lines) {
    const m = /^(\w+)\s*=\s*"([^"]*)"$/.exec(line.trim());
    if (!m) continue;                                  // dòng không hiểu → bỏ qua
    const [op, arg] = [m[1] ?? "", m[2] ?? ""];
    if (op === "strip-ansi" || op === "truncate") {
      filters.push({ op, args: [arg] });
    } else if (op === "regex") {
      try { new RegExp(arg); filters.push({ op, args: [arg] }); }
      catch { return { tier: "degraded", filters, warning: `bad regex: ${arg}` }; }
    } else {
      return { tier: "degraded", filters, warning: `unknown op: ${op}` };
    }
  }
  // không parse được dòng nào mà DSL không rỗng → passthrough + marker
  if (lines.some((l) => l.trim() && !/^\w+\s*=/.test(l))) {
    return { tier: "passthrough", filters: [], warning: "unparsed DSL" };
  }
  return { tier: "full", filters };
}

export function applyFilters(out: string, f: Filter[]): string {
  return f.reduce((acc, flt) => {
    if (flt.op === "strip-ansi") return stripAnsi(acc);
    if (flt.op === "truncate") return acc.slice(0, Number(flt.args[0] ?? 8000));
    if (flt.op === "regex") return acc.split("\n").filter((l) => new RegExp(flt.args[0] ?? "").test(l)).join("\n");
    return acc;
  }, out);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Khai báo filter bằng TOML — không cần code | ❌ Parser tier phải giữ degrade visible |
| ✅ Degrade có warning — không output hỏng âm thầm | ❌ DSL giới hạn — tool phức tạp cần reducer code |
| ✅ Passthrough marker rõ ràng | ❌ ANSI strip sai vỡ layout terminal |
| ✅ Nối drift verify (không đổi nghĩa) | ❌ Regex lọc nhầm dòng quan trọng |

## Khác các hướng gần

| | ADR Filter DSL | ADQ Rewrite Registry | AEF Cascade Replace |
|---|---|---|---|
| Đơn vị | Dòng output | Output cả lệnh | Source code |
| Cách | TOML + parser 3 tier | Registry 3 đường | 5 chiến lược khớp |
| An toàn | Passthrough + marker | Passthrough khi unsafe | Reject nhiều candidate |

## Khi nào chọn

- Output command dài/toàn ANSI — cần lọc có khai báo
- Muốn filter dễ viết (TOML) cho line-oriented cases
- Đã có tools + core DegradedResult — thêm parser
- Chấp nhận degrade visible thay vì output hỏng âm thầm