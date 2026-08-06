# Hướng AHE: Threshold Color Progress — segment progress bar đổi màu theo ngưỡng: >80% error, >60% warning, còn lại muted; context usage tính pct = tokens/contextWindow rồi emit mỗi turn_start/turn_end

> **Nguồn gốc:** pi-powerbar | **Coupling:** 🟡 — bind vào turn lifecycle + token tracking | **Agent-agnostic:** ⚠️ (cần token/context data) | **Code sẵn:** ⚠️ (mya có budget.ts + cost.ts token tracking, nhưng KHÔNG có threshold-color progress segment) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-powerbar** render segment progress bar **đổi màu theo ngưỡng**: `>80%` → **error** (đỏ), `>60%` → **warning** (vàng), còn lại → **muted** (xám). Context usage tính `pct = tokens / contextWindow` rồi **emit mỗi `turn_start`/`turn_end`** — cập nhật progress real-time theo turn. Mục tiêu: cảnh báo trực quan khi context sắp đầy (approaching limit) — user thấy màu đổi就知道 cần compact.

Nguyên tắc: **threshold color** (đỏ/vàng/xám theo pct); **pct = tokens/contextWindow** (tỷ lệ context dùng); **emit mỗi turn boundary** (turn_start/turn_end); **cảnh báo trước** (màu chuyển trước khi đầy).

## Mô tả

Với mya, packages/core `budget.ts` (budget tracking) + `cost.ts` (token cost) **đã có token tracking**, nhưng **chưa có** layer **threshold-color progress segment**: (1) pct calc + threshold color map, (2) emit mỗi turn boundary, (3) segment render. Pattern này cho cảnh báo trực quan context đầy — quan trọng tránh hit context limit đột ngột.

## Kiến trúc (ASCII)

```
  turn_start / turn_end event
        │  tokens (từ cost tracking)
        ▼
  pct = tokens / contextWindow
        │
        ▼
  threshold color:
    pct > 80% → error (đỏ)      ⚠️ sắp đầy, cần compact
    pct > 60% → warning (vàng)
    else      → muted (xám)
        │
        ▼
  emit powerbar:update { segment, pct, color } mỗi turn
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/budget.ts — budget tracking (normalize pattern)
// ✅ packages/core/src/cost.ts — token cost (Cost type)
// ✅ packages/core/src/loop.ts — turn lifecycle (turn_start/turn_end events)
// ⚠️ KHÔNG có threshold-color progress segment (pct + color map)
// ❌ KHÔNG có emit powerbar:update mỗi turn boundary
```

## Implementation

```typescript
// packages/core/src/threshold-progress.ts (NEW)
export type ProgressColor = "muted" | "warning" | "error";

export interface ProgressThreshold { warningAt: number; errorAt: number; }  // pct 0-100

const DEFAULT_THRESH: ProgressThreshold = { warningAt: 60, errorAt: 80 };

/** Tính pct + chọn màu theo ngưỡng. */
export function contextUsageColor(
  tokens: number,
  contextWindow: number,
  thresh: ProgressThreshold = DEFAULT_THRESH,
): { pct: number; color: ProgressColor } {
  const pct = contextWindow > 0 ? Math.min(100, Math.round((tokens / contextWindow) * 100)) : 0;
  const color: ProgressColor = pct > thresh.errorAt ? "error" : pct > thresh.warningAt ? "warning" : "muted";
  return { pct, color };
}

/** Emit mỗi turn boundary (turn_start/turn_end). */
export function emitContextProgress(
  emit: (e: { kind: string; segment: string; pct: number; color: ProgressColor }) => void,
  tokens: number,
  contextWindow: number,
): void {
  const { pct, color } = contextUsageColor(tokens, contextWindow);
  emit({ kind: "powerbar:update", segment: "context", pct, color });
}

// Hook loop.ts turn_start/turn_end: emitContextProgress(emit, tokens, ctxWindow);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cảnh báo trực quan context đầy | ❌ Cần token/contextWindow chính xác (sai → màu nhầm) |
| ✅ Emit mỗi turn (real-time) | ❌ Emit thừa khi pct không đổi (xem AHG dedup) |
| ✅ Threshold tune được (60/80) | ❌ Context window ước lượng (provider khác nhau) |

## Khác các hướng gần

| | AHE Threshold-Color | AHF Unicode-Block | AHG Segment-Dedup |
|---|---|---|---|
| Trọng tâm | Màu progress theo ngưỡng | Vẽ progress unicode block | Bỏ emit khi data không đổi |
| Cơ chế | pct → color map | █▏▎▍ partial blocks | segmentEquals + coalesce |
| Quan hệ | Nối progress visual | Nối progress visual | Nối emit pipeline |

## Khi nào chọn

- Cảnh báo context đầy trực quan (màu đổi trước khi đầy)
- Track token/contextWindow real-time mỗi turn
- Muốn threshold tune được (60/80 hoặc khác)
- Guard: pct clamp 0-100, emit mỗi turn, kết hợp AHG dedup tránh emit thừa
