# Hướng VI: Curated Meta-Package — extension gộp npm manifest nhiều module; settings.json package filter bật/tắt từng extension phụ

> **Nguồn gốc:** oh-my-pi (curated meta-package); "extension bundles multiple modules via npm manifest"; "settings.json package filter toggles sub-extensions"; "one install, granular enable/disable" | **Coupling:** 🟡 — thêm meta-package manifest + settings filter vào extension loader | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills/extensions registry sẵn — chưa có meta-package bundle + filter) | **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** cho rằng cài extension nên **một lần nhưng kiểm soát chi tiết**. Một **meta-package** là một npm package gộp **nhiều module/con extension** trong một manifest (vd `@pi/dev-pack` chứa lint + format + test-helper + refactor). `settings.json` có **package filter** cho phép **bật/tắt từng extension phụ** độc lập (vd bật lint, tắt format). Nguyên tắc: **cài gộp, bật lẻ** — install đơn giản (1 package), nhưng control chi tiết (enable per sub). Khác **install từng extension** (lặp lại, phiền) — VI **1 bundle**; khác all-or-nothing bundle — VI **granular filter**.

## Mô tả

mya curated meta-package: (1) **Manifest**: mỗi meta-package khai báo `subExtensions[]` (id, module path, default-enabled). (2) **Install**: cài 1 npm package → loader đọc manifest → register tất cả sub-extension. (3) **Settings filter**: `settings.json` chứa `extensions.filter` map (id → true/false) override default. (4) **Granular toggle**: user bật/tắt từng sub mà không uninstall package. mya có skills/extensions registry — VI thêm **meta-package manifest reader** + **settings filter merger** + **conditional register**.

## Kiến trúc

```
  META-PACKAGE: @mya/dev-pack (1 npm install)
    manifest.json:
      subExtensions:
        - id: lint        module: ./lint        default: true
        - id: format      module: ./format      default: true
        - id: test-helper module: ./test-helper default: true
        - id: refactor    module: ./refactor    default: false
        │
        ▼
  ┌─── SETTINGS FILTER (settings.json) ───────────────────┐
  │  extensions.filter:                                     │
  │    lint:        true   (keep default)                  │
  │    format:      false  ← TẮT (user chọn)               │
  │    test-helper: true                                   │
  │    refactor:    true   ← BẬT (override default)        │
  └───────────────────────┬─────────────────────────────┘
                          │ (merge default + filter)
                          ▼
  ┌─── CONDITIONAL REGISTER ──────────────────────────────┐
  │  lint        → REGISTER ✓                              │
  │  format      → SKIP ✗                                  │
  │  test-helper → REGISTER ✓                              │
  │  refactor    → REGISTER ✓                              │
  │  → 1 cài đặt, 3/4 bật — granular control               │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — skill/extension registry (nền — VI = meta-package)
// ✅ settings.json config (nền — VI = package filter)
// ✅ npm install — package (nền — VI = bundle carrier)

// ❌ THIẾU: meta-package manifest reader (subExtensions[])
// ❌ THIẾU: settings filter merger (default + override)
// ❌ THIẾU: conditional register (skip theo filter)
```

## Implementation

```typescript
// packages/agent/src/meta-package.ts (MỚI)
interface SubExtension { id: string; module: string; default: boolean }
interface MetaManifest { package: string; subExtensions: SubExtension[] }

class CuratedMetaPackage {
  constructor(
    private settingsFilter: Record<string, boolean>,
  ) {}

  // resolve: merge default + settings filter → enabled list
  resolve(manifest: MetaManifest): SubExtension[] {
    return manifest.subExtensions.filter(sub => {
      const fromSettings = this.settingsFilter[sub.id];
      return fromSettings ?? sub.default; // override default nếu settings có
    });
  }

  // conditional register (load + register enabled sub)
  async load(manifest: MetaManifest, register: (id: string, mod: unknown) => void): Promise<string[]> {
    const enabled = this.resolve(manifest);
    const registered: string[] = [];
    for (const sub of enabled) {
      const mod = await import(sub.module);
      register(sub.id, mod);
      registered.push(sub.id);
    }
    return registered;
  }
}

// Usage:
// const manifest = readManifest('@mya/dev-pack');     // subExtensions: lint/format/...
// const mp = new CuratedMetaPackage(settings.extensions.filter);
// const active = await mp.load(manifest, (id, mod) => registry.register(id, mod));
//   → ["lint","test-helper","refactor"]  (format tắt theo filter)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cài đơn giản (1 package, nhiều module) | ❌ Manifest upkeep (sub đổi → update manifest) |
| ✅ Granular control (bật/tắt từng sub) | ❌ Filter desync (settings cũ → sub unknown) |
| ✅ Default + override (linh hoạt) | ❌ Phân tán (lỗi 1 sub ảnh hưởng bundle) |
| ✅ Tái dùng bundle (team share preset) | ❌ Tree-shake khó (register động) |

## Khác các hướng gần

| | Install từng extension | All-or-nothing bundle | VI: Curated-Meta-Package |
|---|---|---|---|
| Cài | Lặp (n package) | 1 (toàn bộ) | **1 bundle** |
| Control | Toàn (mỗi cái riêng) | ❌ (hết hoặc không) | **✅ granular filter** |
| Default | ❌ | ❌ | **✅ default + override** |

## Khi nào chọn

- Extension nhóm theo vai trò (dev-pack, prod-pack) — cài 1 lần
- User muốn bật/tắt từng module mà không uninstall
- Team share preset (bundle cài đặt thống nhất)
- Nối packages/skills registry + settings.json + npm install; guard manifest schema (validate subExtensions), filter staleness (warn sub không tồn tại), và sub isolation (1 sub lỗi không crash cả bundle); VI = curated meta-package, kết hợp skills registry (register động) + settings config (filter), cho phép team curate preset + user fine-tune
