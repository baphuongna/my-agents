# Hướng AHD: Memory Scan Range Normalize — memory scan range chuẩn hóa [startHours, maxHours] default [72,168], floor start và đảm bảo max ≥ start để config lệch vẫn an toàn

> **Nguồn gốc:** pi-memory-md | **Coupling:** 🟢 — util normalize thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (mya KHÔNG có scan-range normalize util) | **Effort:** 0.2 tuần

## Nguồn gốc

**pi-memory-md** memory scan range được **chuẩn hóa** trước khi dùng: `[startHours, maxHours]` **default `[72, 168]`** (start = quét memory 72h gần đây, max = mở rộng tới 168h nếu cần thêm). Khi config người dùng **lệch** (vd start=200, max=50 → vô lý), normalize: **floor start** (không âm), **đảm bảo `max ≥ start`** (swap hoặc clamp). Kết quả: config lệch/t rôle ngược vẫn **an toàn** — không crash, không scan range vô nghĩa.

Nguyên tắc: **default hợp lý** (`[72, 168]`); **floor** (không âm/zero); **đảm bảo max ≥ start** (clamp/swap); **config lệch vẫn an toàn** (fail-soft, không throw).

## Mô tả

Với mya, packages/memory có scan/query logic nhưng **chưa có** util **scan-range normalize** rõ ràng: (1) default `[72, 168]`, (2) floor start, (3) đảm bảo max ≥ start. Pattern này nhỏ nhưng quan trọng — config user có thể lệch, cần normalize fail-soft trước khi dùng trong query memory time-window.

## Kiến trúc (ASCII)

```
  user config: [startHours, maxHours]  (có thể lệch / role ngược)
        │
        ▼
  normalizeScanRange(startHours, maxHours):
    1. default [72, 168] nếu absent
    2. floor start (>= 1, không âm/zero)
    3. ensure max >= start (swap nếu role ngược)
        │
        ▼
  range an toàn [start, max] → dùng cho memory time-window query
  ── config lệch vẫn an toàn (fail-soft, không throw)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/manager.ts — MemoryManagerImpl (query logic)
// ✅ packages/core/src/budget.ts — budget normalize (pattern tương tự)
// ❌ KHÔNG có scan-range normalize util (default [72,168], floor, max>=start)
```

## Implementation

```typescript
// packages/memory/src/scan-range.ts (NEW)
export interface ScanRange { startHours: number; maxHours: number; }

const DEFAULT: ScanRange = { startHours: 72, maxHours: 168 };

/** Chuẩn hóa scan range: default, floor start, ensure max >= start. Fail-soft. */
export function normalizeScanRange(
  startHours?: number,
  maxHours?: number,
): ScanRange {
  let start = Number.isFinite(startHours) && startHours! > 0 ? Math.floor(startHours!) : DEFAULT.startHours;
  let max = Number.isFinite(maxHours) && maxHours! > 0 ? Math.floor(maxHours!) : DEFAULT.maxHours;

  if (start < 1) start = 1;                       // floor start (không âm/zero)
  if (max < 1) max = DEFAULT.maxHours;
  if (max < start) { const t = start; start = max; max = t; }   // ensure max >= start (swap)
  if (max < start) max = start;                   // clamp doublesafety

  return { startHours: start, maxHours: max };
}

// Dùng: const r = normalizeScanRange(cfg.startHours, cfg.maxHours);
// query memory WHERE ts >= now - r.startHours*h, mở rộng tới r.maxHours*h nếu thiếu.
// config lệch [200, 50] → swap → [50, 200] an toàn.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Config lệch vẫn an toàn (fail-soft) | ❌ Silent normalize — user không biết config bị sửa |
| ✅ Default hợp lý [72, 168] | ❌ Swap role ngược có thể không đúng ý user |
| ✅ max ≥ start luôn (không range vô nghĩa) | ❌ Floor mất độ chính xác sub-hour |

## Khác các hướng gần

| | AHD Scan-Range Normalize | AHC Deep-Merge | budget.ts |
|---|---|---|---|
| Trọng tâm | Chuẩn hóa time-range config | Merge lồng an toàn | Chuẩn hóa budget |
| Cơ chế | default + floor + max>=start | recursive skip undefined | clamp/normalize budget |
| Quan hệ | Nối memory query | Nối config merge | Nối resource budget |

## Khi nào chọn

- Memory scan theo time-window — config user có thể lệch
- Muốn fail-soft (config lệch không crash, normalize an toàn)
- Cần default hợp lý + đảm bảo max ≥ start
- Guard: default [72,168], floor start, swap/clamp khi role ngược, không throw
