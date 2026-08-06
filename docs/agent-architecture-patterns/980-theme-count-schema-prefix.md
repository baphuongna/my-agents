# Hướng AKR: Theme Count & Schema Prefix — pack 14 theme (e-ink, gruvbox-light, monokai-pro, neapple, noctis-lux, onedark-pro, solarized-osaka, tokyo-dark…), mỗi file JSON bắt đầu bằng `$schema` trỏ về theme-schema.json, schema pin giúp theme validate và tự thích ứng khi Pi thêm token mới

> **Nguồn gốc:** pi-themes-worktree (themes/*.json) | **Coupling:** 🟢 — data schema, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có pkg themes kind; thiếu theme schema) | **Effort:** 1 tuần

## Nguồn gốc

**pi-themes-worktree** có **pack gồm 14 theme đầy đủ** — e-ink, gruvbox-light, monokai-pro, neapple, noctis-lux, onedark-pro, solarized-osaka, tokyo-dark...: (1) **mỗi file JSON bắt đầu bằng `$schema`** — trỏ về **theme-schema.json** của pi-mono (schema pin — mọi theme khai báo schema nó tuân theo); (2) **schema pin giúp theme validate được** — editor/loader đọc `$schema` → validate file theo schema — theme sai cấu trúc bị bắt ngay; (3) **tự thích ứng khi Pi thêm token mới** — schema là nguồn token list — theme khai báo theo schema → khi Pi thêm token, theme biết (schema update) và có thể thêm màu tương ứng.

Giá trị: (1) **validate được** — mọi theme kiểm tra theo schema chung; (2) **tự thích ứng** — token mới có nơi khai báo, theme theo schema dễ cập nhật; (3) **nhất quán** — 14 theme cùng cấu trúc, cùng semantic vars; (4) **máy đọc được** — `$schema` cho tooling biết cách parse.

## Mô tả

Với mya, pattern = **schema-pinned data packs**: (1) **theme schema** — `theme-schema.json`: JSON Schema định nghĩa token set (semantic vars: background, foreground, accent, border, syntax tokens…) + metadata (name, dark/light); (2) **theme files** — mỗi theme JSON bắt đầu `{ "$schema": "…/theme-schema.json", "name": "neapple", … }` — mya có `packages/pkg` PackageKind "themes" (manifest — nơi đăng ký theme pack); (3) **validator** — loader đọc `$schema` → validate (dùng JSON Schema validator — ajv hoặc tự viết check) → sai → reject với lý do; (4) **token evolution** — schema thêm token mới (Pi thêm token) → theme cũ vẫn validate (required tối thiểu) nhưng biết token mới tồn tại — thêm màu dần; (5) nơi gắn — `packages/pkg` (themes load + verify), `packages/print` (UI render dùng theme — semantic vars). Đây là pattern **schema-first data governance**: dữ liệu (theme) khai báo schema của nó, máy validate + tự thích ứng khi schema phát triển.

## Kiến trúc (ASCII)

```
  theme-schema.json (JSON Schema — nguồn token list + metadata)
    │  $schema pin — mọi theme khai báo schema nó tuân theo
    ▼
  themes/*.json (14 theme)
  ├─ neapple.json        { "$schema": …, "name": "neapple", "dark": true, … }
  ├─ onedark-pro.json    { "$schema": …, … }
  ├─ e-ink.json          { … }
  └─ … (14 file — cùng cấu trúc)
    │
    ▼ VALIDATOR (đọc $schema → validate — ajv/tự viết)
  ├─ hợp lệ ──► load được (editor/print render theo semantic vars)
  └─ sai cấu trúc ──► reject + lý do (theme không nạp âm thầm)
    │
    ▼ TOKEN EVOLUTION — schema thêm token (Pi thêm token mới)
  ├─ theme cũ: vẫn validate (required tối thiểu)
  └─ theme mới: thêm màu cho token mới — tự thích ứng
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg/src/index.ts — PackageKind "themes" + manifest verify (nơi đăng ký theme)
// ✅ packages/pkg/src/package-resolver.ts — package resolver (nền — load theme files)
// ✅ packages/print/src/mya-bridge.ts — UI bridge (nơi render theo theme)
// ✅ packages/core/src/canonical-json.ts — canonical JSON (nền — byte-faithful parse)
// ❌ THIẾU: theme-schema.json (JSON Schema — token list + metadata)
// ❌ THIẾU: $schema-aware loader (đọc $schema → validate → reject khi sai)
// ❌ THIẾU: token evolution flow (schema thêm token → theme biết + thêm màu)
```

## Implementation

```typescript
// packages/pkg/src/theme-schema.ts (NEW)
export interface ThemeSchema {
  $id: string;
  requiredTokens: string[];          // token tối thiểu — theme phải có
  optionalTokens: string[];          // token mới — theme nên thêm dần
  metadata: Array<"name" | "dark" | "author" | "version">;
}

/** Schema pin — mọi theme phải khai báo $schema trỏ về đây. */
export const THEME_SCHEMA_URL = "https://my-agent.dev/schemas/theme-schema.json";

/** Theme file — bắt đầu bằng $schema (schema pin). */
export interface ThemeFile {
  $schema: string;
  name: string;
  dark: boolean;
  author?: string;
  version?: string;
  colors: Record<string, string>;    // semantic vars: background, accent, syntax…
}

/** Validator — đọc $schema → check required tokens + metadata. */
export function validateTheme(theme: ThemeFile, schema: ThemeSchema): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (theme.$schema !== THEME_SCHEMA_URL) {
    reasons.push(`$schema phải là "${THEME_SCHEMA_URL}" — đang là "${theme.$schema}"`);
  }
  for (const tok of schema.requiredTokens) {
    if (!(tok in theme.colors)) reasons.push(`thiếu required token "${tok}"`);
  }
  for (const m of schema.metadata) {
    if (m !== "author" && m !== "version" && theme[m] === undefined) reasons.push(`thiếu metadata "${m}"`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Loader $schema-aware — validate trước khi nạp; sai → reject, không nạp âm thầm. */
export function loadTheme(raw: string, schema: ThemeSchema, validate: (t: ThemeFile) => { ok: boolean; reasons: string[] } = (t) => validateTheme(t, schema)): { ok: true; theme: ThemeFile } | { ok: false; reasons: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reasons: [`JSON parse fail: ${String(e)}`] };
  }
  const theme = parsed as ThemeFile;
  const result = validate(theme);
  return result.ok ? { ok: true, theme } : { ok: false, reasons: result.reasons };
}

/** Token evolution — schema thêm token → theme cũ vẫn ok, liệt kê token mới nên thêm. */
export function tokenEvolution(schema: ThemeSchema, theme: ThemeFile): string[] {
  return schema.optionalTokens.filter((t) => !(t in theme.colors));
}
// Nối pkg: loadTheme trong theme package verify (cùng apiVersion flow)
// Nối print: render chỉ dùng theme đã validate — semantic vars nhất quán
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Validate được — mọi theme kiểm theo schema chung | ❌ Schema thêm required token → theme cũ fail (cần optional trước) |
| ✅ Tự thích ứng — token mới có nơi khai báo | ❌ JSON Schema validator phụ thuộc thư viện (ajv) |
| ✅ Nhất quán — 14 theme cùng cấu trúc/semantic vars | ❌ $schema URL phải ổn định — đổi URL vỡ theme cũ |
| ✅ Máy đọc được — tooling biết cách parse | ❌ Theme thiếu optional token — render thiếu màu (không fail) |

## Khác các hướng gần

| | AKR Theme Schema | 416 Ontology Packs | 729 Typed Output |
|---|---|---|---|
| Trọng tâm | Schema-pinned data packs | Packs type/verbs cho KG | Output contract có schema |
| Cơ chế | $schema + validator | Packs không đụng parser | canonicalJson + $schema |
| Quan hệ | Data pack chuẩn hóa | Semantic data | Output máy đọc được |

## Khi nào chọn

- Nhiều theme/config file cùng loại — muốn validate + nhất quán
- Schema phát triển (token mới) — theme cần tự thích ứng không vỡ
- Phân phối theme pack rộng — $schema cho editor/loader biết cách xử lý
- Guard: $schema pin, required tối thiểu, reject khi sai (không nạp âm thầm), optional token cho evolution