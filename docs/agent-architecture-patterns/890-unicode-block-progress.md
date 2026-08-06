# Hướng AHF: Unicode Block Progress — progress bar render bằng unicode blocks: █ filled, ▏▎▍▌▋▊▉ partial cho continuous, ▁▂▃▄▅▆▇█ cho discrete levels — visual feedback không cần đồ họa

> **Nguồn gốc:** pi-powerbar | **Coupling:** 🟢 — render util thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (mya dùng spinner/ink, KHÔNG có unicode block progress bar util) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-powerbar** render progress bar **bằng unicode blocks** (không cần đồ họa/TUI nặng): `█` filled, **partial blocks** `▏▎▍▌▋▊▉` cho **continuous** (mượt, sub-character precision), và `▁▂▃▄▅▆▇█` cho **discrete levels** (8 bước). Visual feedback phong phú ngay trong terminal text-mode. Partial blocks cho continuous precision (vd 73% = ████▋ không phải làm tròn ████▌/█████).

Nguyên tắc: **unicode blocks** (không đồ họa, text-mode friendly); **partial cho continuous** (sub-character precision); **discrete levels** (8 bước ▁▂▃...); **visual feedback** trong terminal thuần.

## Mô tả

Với mya, packages/print dùng **spinner** + ink renderer, nhưng **chưa có** **unicode block progress bar** util: (1) continuous partial blocks, (2) discrete levels. Pattern này nhỏ — thêm visual feedback phong phú cho progress (token usage, task %, context fill) trong terminal text-mode mà không cần thư viện TUI nặng.

## Kiến trúc (ASCII)

```
  pct (0-100)
        │
        ├─ CONTINUOUS (partial blocks, sub-character precision):
        │   73% → [█████████▋          ]   █ filled, ▋ partial (9.5 chars)
        │   blocks: ▏▎▍▌▋▊▉█ (1/8 → 8/8)
        │
        └─ DISCRETE (8 levels):
            73% → [▇▇▇▇▇▇▇▇░░]   ▁▂▃▄▅▆▇█ (8 bước)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/runtimes/*.ts — spinner / ink renderer
// ✅ packages/core/src/budget.ts — numeric progress data
// ❌ KHÔNG có unicode block progress bar util (continuous partial + discrete levels)
```

## Implementation

```typescript
// packages/core/src/unicode-progress.ts (NEW)

const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"] as const;   // 1/8 → 8/8
const DISCRETE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;       // 8 levels

/** Continuous progress bar — partial blocks cho sub-character precision. */
export function progressBar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const total = (clamped / 100) * width;        // tổng "char" (có thể lẻ)
  const full = Math.floor(total);
  const remainder = total - full;
  const partialIdx = Math.round(remainder * (PARTIAL.length - 1));
  const partial = partialIdx > 0 ? PARTIAL[partialIdx] : "";
  const empty = " ".repeat(Math.max(0, width - full - (partial ? 1 : 0)));
  return `[${"█".repeat(full)}${partial}${empty}]`;
}

/** Discrete level (8 bước) — ▁▂▃▄▅▆▇█. */
export function discreteLevel(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const idx = Math.min(DISCRETE.length - 1, Math.floor((clamped / 100) * DISCRETE.length));
  return DISCRETE[idx]!;
}

// Dùng: `${progressBar(73)} 73%` → [█████████▋          ] 73%
//       discreteLevel(73) → ▇
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Visual feedback phong phú không cần đồ họa | ❌ Một số terminal/font thiếu glyph block |
| ✅ Partial blocks → sub-character precision | ❌ Width lớn → chiếm nhiều cột |
| ✅ Text-mode friendly (không TUI nặng) | ❌ Discrete chỉ 8 bước (thô hơn continuous) |

## Khác các hướng gần

| | AHF Unicode-Block | AHE Threshold-Color | AGW Native OSC |
|---|---|---|---|
| Trọng tâm | Vẽ progress unicode block | Màu progress theo ngưỡng | Terminal native progress |
| Cơ chế | █▏▎▍ partial / ▁▂▃ discrete | pct → color map | OSC 9;4 /dev/tty |
| Quan hệ | Nối progress visual | Nối progress visual | Nối terminal protocol |

## Khi nào chọn

- Muốn progress bar text-mode phong phú (không TUI nặng)
- Cần sub-character precision (partial blocks)
- Discrete levels (8 bước) cho compact indicator
- Guard: clamp pct 0-100, partial idx round đúng, fallback khi font thiếu glyph
