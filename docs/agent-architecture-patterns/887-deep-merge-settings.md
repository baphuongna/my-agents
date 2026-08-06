# Hướng AHC: Deep Merge Settings — deep merge recursive chỉ override key có giá trị, skip undefined, giữ plain object merge — tránh ghi đè cấu hình lồng nhau của user

> **Nguồn gốc:** pi-memory-md | **Coupling:** 🟢 — util merge thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (mya dùng spread shallow merge, KHÔNG có deepMerge recursive skip-undefined) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-memory-md** merge settings **recursive deep**: chỉ **override key có giá trị** (đã defined), **skip `undefined`** (không ghi undefined đè giá trị thật), **giữ plain object merge** (object lồng nhau merge tiếp, không thay reference). Mục tiêu: tránh ghi đè cấu hình **lồng nhau** của user khi merge default + user config. Spread shallow (`{...a, ...b}`) chỉ merge top-level — object lồng nhau bị thay hoàn toàn, mất config user ở tầng sâu.

Nguyên tắc: **recursive** (merge từng tầng object lồng); **skip undefined** (không đè giá trị thật bằng undefined); **plain object merge** (chỉ merge plain object, không đè class instance); **user config thắng default** ở mọi tầng sâu.

## Mô tả

Với mya, packages dùng **spread shallow merge** (`{...global, ...project}` trong nhiều chỗ, vd settings layer) — top-level only. mya **chưa có** `deepMerge` recursive skip-undefined rõ ràng. Pattern này quan trọng khi config lồng sâu (vd `powerbar.segments.color.threshold`): spread shallow mất config user ở tầng giữa khi default override.

## Kiến trúc (ASCII)

```
  default: { a: { x: 1, y: 2 }, b: 3 }
  user:    { a: { y: 99 }, b: undefined }

  SHALLOW merge {...default, ...user}:
    → { a: { y: 99 }, b: undefined }     ❌ mất a.x, b bị undefined đè

  DEEP merge (skip undefined):
    → { a: { x: 1, y: 99 }, b: 3 }       ✅ giữ a.x (default), a.y thắng (user), b giữ (skip undefined)
```

## mya ĐÃ CÓ

```typescript
// ⚠️ packages/print/cli.ts, intercom/config.ts — spread shallow merge ({...a, ...b})
// ❌ KHÔNG có deepMerge recursive (merge từng tầng object lồng)
// ❌ KHÔNG có skip-undefined (tránh undefined đè giá trị thật)
// ❌ KHÔNG có plain-object guard (chỉ merge plain object, không đè instance)
```

## Implementation

```typescript
// packages/core/src/deep-merge.ts (NEW)

/** True nếu plain object (không phải array/class instance/null). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;   // plain, không phải instance
}

/** Deep merge: recursive, skip undefined, giữ plain object. user thắng default. */
export function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (override === undefined) return base;                // skip undefined toàn object
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;  // primitive: override (skip undefined)
  }
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const ov = (override as Record<string, unknown>)[key];
    if (ov === undefined) continue;                       // skip undefined key
    const bv = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(bv) && isPlainObject(ov) ? deepMerge(bv, ov) : ov;
  }
  return out as T;
}

// Dùng: const cfg = deepMerge(DEFAULT_CONFIG, userConfig);
// userConfig.a.y thắng, userConfig.b undefined bị skip, giữ DEFAULT a.x.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Merge lồng sâu không mất config user | ❌ Recursive deep với object lớn (perf) |
| ✅ Skip undefined (không đè giá trị thật) | ❌ Phân biệt plain object vs instance (guard) |
| ✅ user thắng default ở mọi tầng | ❌ Array merge semantics mơ hồ (replace vs concat) |

## Khác các hướng gần

| | AHC Deep-Merge | AGN Write-Target | AGT Env-Precedence |
|---|---|---|---|
| Trọng tâm | Merge lồng an toàn | Chọn nơi ghi | Thứ tự ưu tiên đọc |
| Cơ chế | Recursive skip undefined | Key-sống-ở-đâu | theme < file < env |
| Quan hệ | Nối merge semantics | Nối persistence | Nối precedence |

## Khi nào chọn

- Config lồng sâu — spread shallow mất config user ở tầng giữa
- Muốn skip undefined (override partial không đè giá trị thật)
- Merge default + user ở mọi tầng sâu
- Guard: recursive, skip undefined, plain-object guard (không đè instance), array policy rõ
