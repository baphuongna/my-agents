# Hướng AHG: Segment Equals Dedup — skip emit powerbar:update khi segment data không đổi, kết hợp 200ms coalescing giảm render tối thiểu — pattern được pi-crew copy

> **Nguồn gốc:** pi-powerbar | **Coupling:** 🟢 — emit/dedup layer thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có telemetry emit, nhưng KHÔNG có segmentEquals dedup + coalescing cho powerbar) | **Effort:** 0.3 tuần

## Nguồn gốc

**pi-powerbar** dùng `segmentEquals` **dedup**: **skip emit `powerbar:update`** khi segment data **không đổi** (so sánh sâu trước emit). Kết hợp **200ms coalescing** (gom nhiều emit liên tiếp thành 1). Kết quả: render tối thiểu — chỉ vẽ khi thực sự thay đổi. Pattern này **được pi-crew copy** vào `powerbar-publisher.ts` (pi-crew CHANGELOG) — chứng minh giá trị tái dùng: emit pipeline tắc nhiễu (redundant emit) gây jank + waste CPU; dedup + coalesce giải quyết sạch.

Nguyên tắc: **deep-equal trước emit** (skip redundant); **coalesce window** (gom burst thành 1); **render tối thiểu** (chỉ khi thay đổi thật); **pattern tái dùng** (pi-crew copy → generic value).

## Mô tả

Với mya, packages/core `telemetry.ts` có emit logic, nhưng **chưa có** `segmentEquals` dedup + coalescing rõ ràng cho powerbar/update event. Pattern này giảm nhiễu emit — quan trọng khi nhiều nguồn (turn_start/turn_end, token, spinner) cùng emit, phần lớn không đổi.

## Kiến trúc (ASCII)

```
  N nguồn emit powerbar:update { segment, data }
        │
        ▼
  segmentEquals(prev, curr)? ── YES ──► skip emit (data không đổi)
        │ NO
        ▼
  coalesce 200ms (gom burst liên tiếp)
        │
        ▼
  emit 1 lần (render tối thiểu)
  ── chỉ vẽ khi thực sự thay đổi + gom burst
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/telemetry.ts — telemetry emit logic
// ✅ packages/core/src/canonical-json.ts — canonical JSON (deep compare foundation)
// ⚠️ KHÔNG có segmentEquals dedup (skip emit khi data không đổi)
// ❌ KHÔNG có 200ms coalescing cho powerbar/update burst
```

## Implementation

```typescript
// packages/core/src/segment-dedup.ts (NEW)
import { canonicalJSON } from "./canonical-json.js";

export interface Segment { id: string; data: unknown; }

/** Deep-equal segment qua canonical JSON (deterministic compare). */
export function segmentEquals(a: Segment, b: Segment): boolean {
  return a.id === b.id && canonicalJSON(a.data) === canonicalJSON(b.data);
}

/** Publisher: dedup + coalesce. Skip emit khi data không đổi; gom burst 200ms. */
export class SegmentPublisher {
  private last: Segment | undefined;
  private timer?: NodeJS.Timeout;
  private pending?: Segment;

  constructor(
    private readonly emit: (s: Segment) => void,
    private readonly coalesceMs = 200,
  ) {}

  update(seg: Segment): void {
    if (this.last && segmentEquals(this.last, seg)) return;   // dedup: không đổi → skip
    this.pending = seg;
    if (this.timer) return;                                    // đã có timer chờ → gộp
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.pending) { this.last = this.pending; this.emit(this.pending); this.pending = undefined; }
    }, this.coalesceMs);
  }
}

// Dùng: publisher.update({ id: "context", data: { pct, color } });
// burst 10 emit trong 50ms (đa số không đổi) → 0-1 emit thật.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Render tối thiểu (chỉ khi thay đổi thật) | ❌ Deep-equal cost mỗi emit (canonical JSON) |
| ✅ Coalesce gom burst → giảm jank | ❌ Độ trễ tối đa = coalesceMs (200ms) |
| ✅ Pattern tái dùng (pi-crew copy) | ❌ Cần reset last khi segment id đổi ngữ cảnh |

## Khác các hướng gần

| | AHG Segment-Dedup | AGL Render Coalesce | AHE Threshold-Color |
|---|---|---|---|
| Trọng tâm | Bỏ emit khi data không đổi | Gộp vẽ thành 1 frame | Màu progress theo ngưỡng |
| Cơ chế | segmentEquals + 200ms coalesce | 1 timer + editor-defer | pct → color map |
| Quan hệ | Nối emit pipeline | Nối render loop | Nối progress visual |

## Khi nào chọn

- Emit pipeline tắc nhiễu (redundant emit, đa số không đổi)
- Muốn render tối thiểu (chỉ khi thay đổi thật)
- Burst emit từ nhiều nguồn cần gom
- Guard: deep-equal canonical JSON, coalesce window, reset last khi cần
