# Hướng AFA: Filtered Package Subset Loading — settings.json chọn subset extension từ một git package, monorepo tải theo yêu cầu

> **Nguồn gốc:** pi-extensions2 | **Coupling:** 🟢 — package loading layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn package-resolver; thiếu subset filter) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions2** (README.md): **settings.json** cho phép chọn **subset extension từ một git package** — ví dụ `"extensions": ["files-widget/index.ts"]` — tức: **monorepo phân phối chung** (một git package chứa nhiều extension) nhưng **tải theo yêu cầu** (chỉ load extension được liệt kê, không load cả package). Điều này tách hai khái niệm: **distribution unit** (package — thứ được clone/cài) khác **load unit** (extension — thứ được chạy).

Giá trị: (1) **khởi động nhanh** — package 50 extension, user dùng 3 → chỉ load 3 (tốn ít thời gian + RAM); (2) **ít xung đột** — extension không dùng không chiếm namespace/globals/command; (3) **một kho, nhiều combo** — publish một monorepo, mỗi user settings riêng tổ hợp của mình — không cần nhiều package riêng lẻ; (4) **lười + rõ ràng** — settings khai báo tường minh cái gì được load (nối tinh thần AEJ lazy loading).

## Mô tả

Với mya, pattern = **subset filter trên package resolution**: (1) mya đã có **`packages/pkg/package-resolver.ts`** — `readExtension("foo")` tìm `node_modules/foo`, đọc `agent-package.json` manifest, load entry — nền resolution; (2) pattern thêm **manifest liệt kê entry points** — `agent-package.json` có `exports: { "files-widget": "./src/files-widget/index.ts", … }` (tên → path); (3) **settings filter** — `"extensions": ["files-widget/index.ts"]` (hoặc tên export) — resolver chỉ load các entry được liệt kê, **không load default entry cả package**; (4) **validation** — tên không khớp export → cảnh báo lúc settings load (fail-loud sớm, không âm thầm bỏ); (5) **manifest không có exports** → fallback load cả package (tương thích ngược). Đây là pattern **declarative subset loading**: cài nhiều, chạy ít — cấu hình quyết định tải gì.

## Kiến trúc (ASCII)

```
  GIT PACKAGE (monorepo — phân phối chung)
  ├─ src/files-widget/index.ts
  ├─ src/status-bar/index.ts
  ├─ src/commands/index.ts
  └─ agent-package.json { exports: { "files-widget": … , "status-bar": …, "commands": … } }
    │
    ▼ SETTINGS (user — subset theo yêu cầu)
  "extensions": ["files-widget/index.ts", "status-bar/index.ts"]
    │
    ▼ RESOLVER (packages/pkg/package-resolver.ts + subset filter)
  ├─ đọc manifest → map tên → path
  ├─ chỉ LOAD entry được liệt kê (3/50 — khởi động nhanh)
  ├─ tên không khớp export → CẢNH BÁO fail-loud (không âm thầm bỏ)
  └─ manifest không exports → fallback load cả package (tương thích)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg/src/package-resolver.ts — readExtension: node_modules → manifest → entry
//   (resolution nền — pattern chỉ thêm subset filter)
// ✅ packages/pkg/src/index.ts — PackageManifest type (đích thêm exports)
// ✅ packages/intercom/src/broker — extension registry (runtime-claim, state)
//   (nơi extension đăng ký sau khi load)
// ✅ packages/intercom/src/extension-api.ts — extension register event
// ✅ packages/core — settings/config surface (nơi đọc "extensions" list)

// ❌ THIẾU: manifest exports map (tên → path entry)
// ❌ THIẾU: subset filter (chỉ load entry được liệt kê)
// ❌ THIẾU: validation fail-loud khi tên không khớp
```

## Implementation

```typescript
// packages/pkg/src/subset-loader.ts (NEW)
export interface SubsetSettings {
  extensions?: string[];     // ["files-widget/index.ts", "status-bar/index.ts"]
}

/** Đọc manifest exports — map tên entry → path. */
export function entryMap(manifest: { exports?: Record<string, string> } | null): Map<string, string> {
  return new Map(Object.entries(manifest?.exports ?? {}));
}

/**
 * Load subset: chỉ load entry được liệt kê trong settings —
 * monorepo phân phối chung, tải theo yêu cầu (không load cả package).
 */
export async function loadSubset(
  settings: SubsetSettings,
  manifest: { exports?: Record<string, string> } | null,
  importEntry: (path: string) => Promise<unknown>,
): Promise<{ loaded: string[]; missing: string[] }> {
  const entries = entryMap(manifest);
  const wanted = settings.extensions ?? [];
  const missing: string[] = [];

  // Không có exports → fallback: load cả package (tương thích ngược).
  if (entries.size === 0) {
    await importEntry(".");   // main entry như cũ
    return { loaded: wanted.length > 0 ? ["."] : [], missing };
  }

  const loaded: string[] = [];
  for (const name of wanted) {
    const path = entries.get(name) ?? entries.get(name.split("/")[0]);
    if (!path) { missing.push(name); continue; }   // fail-loud: cảnh báo, không âm thầm bỏ
    await importEntry(path);
    loaded.push(name);
  }
  return { loaded, missing };
}
// Settings: "extensions": ["files-widget/index.ts"] — chỉ 2 entry được import
// Registry: loaded extension đăng ký qua intercom extension-api (đã có)
// Tinh thần AEJ: metadata (manifest) eager, content (module) lazy theo yêu cầu
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Khởi động nhanh — chỉ load subset được dùng | ❌ Settings sai tên → extension im lặng không có (cần fail-loud) |
| ✅ Ít xung đột namespace/globals/commands | ❌ Exports map phải bảo trì đồng bộ với src tree |
| ✅ Một monorepo, nhiều tổ hợp user | ❌ User phải biết tên entry (cần discover UX) |
| ✅ Resolver đã có — thêm filter + validation | ❌ Extension dùng chéo nhau (A import B) — subset phải khai báo cả B |

## Khác các hướng gần

| | AFA Subset Loading | AEJ Lazy File Loading | ADQ Rewrite Registry |
|---|---|---|---|
| Trọng tâm | Tải extension theo yêu cầu | Tải file content on-demand | Quyết định rewrite |
| Cơ chế | Settings filter + exports map | request-file + cache | 3 đường quyết định |
| Quan hệ | Layer load (pkg) | Layer window (AEI) | Khác miền (output) |

## Khi nào chọn

- Một git package chứa nhiều extension — user dùng vài cái
- Cần khởi động nhanh + ít xung đột khi cài package to
- Đã có package-resolver + intercom registry — thêm subset filter
- Muốn publish một kho, user tự chọn tổ hợp qua settings