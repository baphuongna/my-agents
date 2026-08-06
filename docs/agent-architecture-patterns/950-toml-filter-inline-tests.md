# Hướng AJN: TOML Filter Inline Tests — mỗi filter là `.toml` với `[[tests]]` inline (input → expected) được concatenate vào binary; filter mới có test ngay tại định nghĩa

> **Nguồn gốc:** rtk | **Coupling:** 🟢 — filter definition + test co-located | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có TOML filter + inline tests) | **Effort:** 1 tuần

## Nguồn gốc

**rtk** mỗi filter là **`.toml` file** với **`[[tests]]` inline** (input → expected) được **concatenate bởi `build.rs`** thành blob nhúng trong binary. **`cargo test` validate** syntax TOML và chạy **inline tests** — filter mới có **test ngay tại định nghĩa** (co-located), không cần file test riêng rời.

Nguyên tắc: **filter + test cùng chỗ** — định nghĩa filter (`[filters.du]`) và test (`[[tests.du]]`) trong cùng `.toml`; **concatenate at build** — `build.rs` gộp tất cả `src/filters/*.toml` thành blob compile-time; **test inline là contract** — mỗi filter PHẢI có input→expected, `cargo test` chạy hết; **fail-fast** — filter mới thiếu test/sai syntax → build/test fail ngay.

## Mô tả

Với mya, pattern = **data-driven reducer definition + co-located test**: (1) **mya chưa có TOML filter** — AJL reducer hiện là code TS; (2) **AJN tách reducer thành data**: mỗi command reducer (du/df/npm/git) là `.toml` (`match_command`, `strip_lines_matching`, `truncate_lines_at`, `max_lines`, `replace`); (3) **inline tests** — `[[tests.<name>]]` với `input`/`expected` ngay trong cùng file; (4) **build embedding** — prebuild script gộp tất cả `.toml` thành `filters.generated.json` import vào bundle (TS tương đương `build.rs`); (5) **runtime registry** — load filters từ blob, match command → apply rules; (6) **validate** — `vitest` parse TOML + chạy inline tests; (7) **nối AJL** — AJN là định dạng data cho reducer pipeline; (8) **verify** — `--require-all` ép mọi filter phải có test. Tham chiếu: source/rtk src/core/toml_filter.rs + src/filters/*.toml + build.rs.

## Kiến trúc (ASCII)

```
  src/filters/du.toml ───┐
    [filters.du]         │
    match_command=^du\b  │   build.rs / prebuild (concatenate)
    strip_lines=[^\s*$]  ├──────────────────────────► filters.blob
    [[tests.du]]         │   (nhúng trong binary / import TS)
    input="4K\tsrc\n\n8K"│                                │
    expected="4K\tsrc\n8K"│                               ▼
  src/filters/npm.toml ──┘                    FILTER REGISTRY (runtime)
                                                        │
    cargo test / vitest ◄── validate syntax + run inline tests
    --require-all ◄──── mỗi filter PHẢI có test
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools dispatch.ts — tool dispatch (nền — nhưng reducer là code, không data)
// ✅ vitest runner — (nền test — chạy inline tests)
// ✅ source/rtk src/core/toml_filter.rs — TomlFilterRegistry, CompiledFilter,
//   TomlFilterTestDef, VerifyResults, run_filter_tests (Rust reference — port TS)
// ✅ source/rtk src/filters/*.toml — du.toml, biome.toml, df.toml... (ví dụ format)
// ✅ source/rtk build.rs — concatenate src/filters/*.toml → blob (reference prebuild)

// ❌ THIẘU: .toml filter data format cho reducer
// ❌ THIẾU: inline [[tests]] co-located + prebuild concatenate
// ❌ THIẾU: runtime registry load blob + validate (vitest)
```

## Implementation

```typescript
// packages/tools/src/filter-registry.ts (NEW) — port rtk toml_filter.rs
import { parse as parseToml } from "smol-toml";

export interface CompiledFilter {
  name: string;
  matchCommand: RegExp;
  stripLines: RegExp[];
  truncateAt: number;
  maxLines: number;
  replace: Array<{ find: RegExp; with: string }>;
}
export interface FilterTest { name: string; input: string; expected: string }

/** Load tất cả filter từ blob (prebuild-concatenated). */
export function loadFilters(blob: string): {
  filters: CompiledFilter[];
  tests: Map<string, FilterTest[]>;
} {
  const doc = parseToml(blob) as Record<string, unknown>;
  const filters: CompiledFilter[] = [];
  const tests = new Map<string, FilterTest[]>();
  for (const [name, raw] of Object.entries(doc.filters ?? {})) {
    const f = raw as Record<string, unknown>;
    filters.push({
      name, matchCommand: new RegExp(String(f.match_command)),
      stripLines: (f.strip_lines_matching as string[] ?? []).map((s) => new RegExp(s)),
      truncateAt: Number(f.truncate_lines_at ?? 0), maxLines: Number(f.max_lines ?? 0),
      replace: [],
    });
    const t = (doc.tests as Record<string, FilterTest[]>)?.[name] ?? [];
    tests.set(name, t.map((x) => ({ name: x.name, input: x.input, expected: x.expected })));
  }
  return { filters, tests };
}

/** Áp dụng filter — core của AJL reducer pipeline. */
export function applyFilter(f: CompiledFilter, input: string): string {
  let lines = input.split("\n").filter((l) => !f.stripLines.some((r) => r.test(l)));
  lines = f.maxLines ? lines.slice(-f.maxLines) : lines;
  return lines.map((l) => f.truncateAt ? l.slice(0, f.truncateAt) : l).join("\n");
}
// prebuild.mjs: concatenate src/filters/*.toml → filters.generated.txt (build.rs TS).
// vitest: cho mỗi filter, run loadFilters(...).tests → assert applyFilter(input)===expected.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Filter + test co-located — dễ thêm/sửa | ❌ TOML parse dependency (smol-toml) |
| ✅ Data-driven — reducer không cần code per-command | ❌ Regex trong TOML — escape khó |
| ✅ Fail-fast — filter mới thiếu test → fail | ❌ Build step thêm (prebuild concatenate) |
| ✅ Nối AJL (data format cho reducer) | ❌ Mọi rule phải có test inline — gánh maintain |

## Khác các hướng gần

| | AJN TOML Inline Tests | AJL Token CLI Proxy | NA Det. Reducers |
|---|---|---|---|
| Trọng tâm | Filter data format + co-located test | 4-strategy pipeline | Per-command structured reducer |
| Cơ chế | .toml + [[tests]] + build embed | filter/group/truncate/dedup | git/npm/docker parser code |
| Quan hệ | Định dạng data cho AJL/NA | Tiêu thụ filter | Filter là một dạng reducer |

## Khi nào chọn

- Muốn reducer data-driven (thêm command mà không code)
- Quan tâm co-located test — filter + test cùng file, fail-fast
- Đã có AJL reducer code — muốn tách thành data (.toml)
- Guard: mỗi filter phải có inline test (`--require-all`), prebuild concatenate, regex escape cẩn thận, vitest validate syntax + run tests
