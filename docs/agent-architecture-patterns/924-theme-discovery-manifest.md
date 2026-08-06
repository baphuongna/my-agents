# Hướng AIN: Theme-Discovery-Manifest — theme pack khai báo `pi.themes: ["./themes"]` trong package.json để Pi discover package themes; user override bằng `themes` array trỏ trực tiếp vào dir — theme là dữ liệu thuần tách code, chọn qua `/settings`

> **Nguồn gốc:** pi-themes | **Coupling:** 🟢 — theme discovery | **Agent-agnostic:** ⚠️ (pi pkg model) | **Code sẵn:** ⚠️ (có pkg themes kind + manifest; chưa có pi.themes discovery field) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-themes** theme pack khai báo **`pi.themes: ["./themes"]`** trong package.json để Pi **discover package themes**; user override bằng **`themes` array** trỏ trực tiếp vào dir — theme là **dữ liệu thuần tách code**, chọn qua `/settings`. Nguyên tắc: **manifest discovery** — package declare theme dir, Pi scan tự động; **user override** — settings `themes` array trỏ dir tùy chỉnh (ưu tiên manifest); **data-code separation** — theme là JSON thuần, code không hardcode; **choose via settings** — `/settings` chọn active theme.

## Mô tả

Với mya, pattern = **theme discovery qua manifest**: (1) mya đã có **pkg** (packages/pkg) — themes là 1 trong 4 PackageKind, có `agent-package.json` manifest + package-resolver.ts; (2) AIN thêm **`pi.themes` field** trong manifest — declare theme dir (`["./themes"]`); (3) **discovery**: Pi scan `pi.themes` dirs → list theme JSON; (4) **user override** — settings `themes` array trỏ dir trực tiếp (ưu tiên); (5) **choose via `/settings`** — active theme select; (6) nối AIM (theme JSON thuần).

## Kiến trúc (ASCII)

```
  THEME PACK (package.json / agent-package.json)
    {
      "name": "pi-themes-tokyo",
      "pi": { "themes": ["./themes"] }     ← declare theme dir
    }
         │
         ▼ DISCOVERY (Pi scan pi.themes dirs)
    ./themes/
      ├─ tokyo-night.json    ← AIM semantic palette
      ├─ tokyo-storm.json
      └─ tokyo-day.json
         │
         ▼ USER OVERRIDE (settings — ưu tiên manifest):
    settings.themes = ["/custom/my-themes"]   ← trỏ dir trực tiếp
         │
         ▼ CHOOSE (/settings):
    active theme = tokyo-night ──► load JSON ──► render (AIM)
  (theme = data thuần, tách code, chọn qua /settings)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg index.ts — themes = PackageKind (1 trong 4)
// ✅ packages/pkg package-resolver.ts — read manifest + resolve (discovery nền)
// ✅ packages/pkg index.ts — PackageManifest (nền pi.themes field)
// ✅ packages/print pi-main.ts — themes load (nền)

// ❌ THIẾU: pi.themes discovery field (manifest declare theme dir)
// ❌ THIẾU: theme dir scanner (list JSON từ pi.themes)
// ❌ THIẾU: user override (settings themes array) + /settings choose
```

## Implementation

```typescript
// packages/pkg/src/theme-discovery.ts (NEW)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PackageManifest } from "./index.js";

export interface DiscoveredTheme { name: string; path: string }

/** Discover themes từ pi.themes manifest dirs + user override. */
export function discoverThemes(
  pkgDir: string, manifest: PackageManifest, userOverride?: string[],
): DiscoveredTheme[] {
  // user override ưu tiên
  const dirs = (userOverride ?? (manifest as { pi?: { themes?: string[] } }).pi?.themes ?? [])
    .map((d) => (isAbsoluteSafe(d) ? d : resolve(pkgDir, d)));
  const out: DiscoveredTheme[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json")) out.push({ name: f.replace(/\.json$/, ""), path: join(dir, f) });
    }
  }
  return out;
}
function isAbsoluteSafe(p: string): boolean { return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p); }
// /settings → discoverThemes(...) → list → user chọn → loadTheme (AIM) → render.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Auto-discovery — package declare, Pi scan | ❌ Manifest field phải document (pi.themes) |
| ✅ User override (settings themes array) | ❌ Override path phải safe (traversal guard) |
| ✅ Theme = data thuần tách code | ❌ Discovery scan I/O khi load |
| ✅ Nối pkg manifest sẵn | ❌ Conflict tên theme giữa package |

## Khác các hướng gần

| | AIN Theme-Discovery-Manifest | AIM Semantic-Color-Vars | AIO Worktree-Theme-Dev |
|---|---|---|---|
| Trọng tâm | Discover theme package | Biến ngữ nghĩa render | Phát triển theme worktree |
| Cơ chế | pi.themes manifest + override | Standard palette + JSON | Git worktree branch |
| Quan hệ | Discovery (tìm) | Render (dùng) | Dev (tạo) |

## Khi nào chọn

- Theme pack cần Pi auto-discover (declare dir, không hardcode)
- User muốn override theme dir (settings)
- Theme = data thuần, chọn qua /settings
- Guard: pi.themes field, path traversal guard (override), name conflict resolve, scan lazy
