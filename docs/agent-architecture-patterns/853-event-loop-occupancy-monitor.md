# Hướng AFU: Event-Loop Occupancy Monitor — dùng `perf_hooks.monitorEventLoopDelay()` đo max/p99/mean latency của TUI event loop để phát hiện synchronous block làm đứng keystroke; degrade an toàn khi runtime không hỗ trợ

> **Nguồn gốc:** pi-lens (clients/event-loop-monitor.ts) | **Coupling:** 🟢 — instrumentation thuần, không đổi logic | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có event-loop monitor) | **Effort:** 0.5-1 tuần

## Nguồn gốc

**pi-lens** `event-loop-monitor` dùng Node `perf_hooks.monitorEventLoopDelay()` đo **latency event loop** (max/p99/mean) — phát hiện **synchronous block** làm đứng keystroke trong TUI (một hàm sync nặng chặn event loop → input không phản hồi). Khi runtime **không hỗ trợ** `monitorEventLoopDelay` (browser/older Node), **degrade an toàn** (no-op, không crash). Nguyên tắc: **đo để phát hiện block**, không đo thì không biết TUI đang kẹt đâu.

## Mô tả

mya event-loop-occupancy: (1) **monitorEventLoopDelay** — Node perf hook đo delay giữa tick; (2) **aggregate stats** — max/p99/mean trong cửa sổ thời gian; (3) **alert** — khi latency vượt ngưỡng → cảnh báo sync block; (4) **degrade** — `typeof monitorEventLoopDelay` check, no-op nếu không có; (5) **TUI keystroke** — TUI trong `packages/intercom/ui` cần responsiveness. Nối AFV (LSP idle) — block thường do LSP/symbol extraction sync.

## Kiến trúc (ASCII)

```
  TUI EVENT LOOP (Node)
   │  keystroke handler phải chạy mỗi tick
   │
   ▼  monitorEventLoopDelay() đo delay giữa tick
  ┌──────────────────────────────┐
  │ EVENT-LOOP-MONITOR            │
  │  aggregate: max / p99 / mean  │ (cửa sổ N giây)
  │  nếu latency > ngưỡng → ALERT │ "sync block detected"
  └──────────────┬───────────────┘
                 │
   runtime hỗ trợ monitorEventLoopDelay?
   ├─ CÓ  ──▶ đo thật, alert khi block
   └─ KHÔNG ──▶ no-op, degrade an toàn (không crash)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom/ui compose.ts/inline-message.ts — TUI cần responsiveness
// ✅ packages/core telemetry.ts — telemetry pattern (nền metric reporting)

// ❌ THIẾU: event-loop-monitor (monitorEventLoopDelay wrapper)
// ❌ THIẾU: max/p99/mean aggregate + alert ngưỡng
// ❌ THIẾU: degrade khi runtime không hỗ trợ
```

## Implementation

```typescript
// packages/core/src/event-loop-monitor.ts (MỚI)
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
export interface LoopStats { max: number; p99: number; mean: number; samples: number; }
/** Monitor event loop latency; degrade an toàn khi runtime không hỗ trợ. */
export class EventLoopMonitor {
  private hist?: IntervalHistogram;
  private enabled: boolean;
  constructor() {
    this.enabled = typeof monitorEventLoopDelay === "function";
    if (this.enabled) {
      this.hist = monitorEventLoopDelay();
      this.hist.enable();
    }
  }
  /** Snapshot max/p99/mean (nanoseconds), reset sau khi đọc. */
  stats(): LoopStats | null {
    if (!this.hist) return null;   // degrade: runtime không hỗ trợ
    const s: LoopStats = {
      max: this.hist.max,
      p99: this.hist.percentile(99),
      mean: this.hist.mean,
      samples: this.hist.count,
    };
    this.hist.reset();
    return s;
  }
  /** Phát hiện sync block: p99 > ngưỡng (ms). */
  isBlocked(thresholdMs = 50): boolean {
    const s = this.stats();
    return s !== null && s.p99 > thresholdMs * 1e6;   // ms → ns
  }
  disable(): void { this.hist?.disable(); }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện sync block làm đứng TUI | ❌ monitorEventLoopDelay không có ở mọi runtime |
| ✅ max/p99/mean — metric chính xác | ❌ Overhead nhỏ nhưng có (histogram) |
| ✅ Degrade an toàn (no-op) | ❌ Chỉ phát hiện, không tự fix block |

## Khác các hướng gần

| | AFU Event-Loop Monitor | AGJ Phase-Heartbeat | telemetry |
|---|---|---|---|
| Đo | Latency event loop | Phase stall (5 phút) | Runtime metric |
| Mục đích | Phát hiện sync block | Phát hiện agent kẹt | Quan sát chung |
| Degrade | no-op | snapshot | sampling |

## Khi nào chọn

- TUI cần responsiveness, muốn phát hiện sync block
- Có code sync nặng (LSP/symbol/heavy parse) trong event loop
- Muốn metric latency chính xác (max/p99/mean)
- Guard: degrade no-op khi thiếu API, reset sau đọc, threshold tuning
