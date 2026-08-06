# Hướng AGJ: Phase-Heartbeat Stall-Detect — heartbeat tracker ghi last tool name/summary + assistant summary mỗi event; snapshot phân biệt started/quiet/stalled (5 phút không event) để UI hiện phase nào đang kẹt

> **Nguồn gốc:** piolium (extensions/piolium/heartbeat.ts) | **Coupling:** 🟡 — hook vào runtime event stream | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có RuntimeEvent + telemetry, thiếu heartbeat stall-detect) | **Effort:** 1 tuần

## Nguồn gốc

**piolium** heartbeat tracker ghi **mỗi runtime event**: **last tool name/summary** (tool vừa chạy gì) + **assistant summary** (agent vừa nói gì). Snapshot phân biệt 3 trạng thái: **started** (phase mới bắt đầu, có event gần), **quiet** (không event ngắn — bình thường), **stalled** (**5 phút không event** — đang kẹt). UI hiện **phase nào đang kẹt** để người dùng biết audit treo chỗ nào. Nguyên tắc: **heartbeat mỗi event + stall threshold → phát hiện kẹt nhanh**.

## Mô tả

mya phase-heartbeat-stall-detect: (1) **RuntimeEvent đã sẵn** — `packages/audit` index.ts (tool/approval/repair/channel event stream); (2) **telemetry đã sẵn** — `packages/core` telemetry.ts; (3) **heartbeat tracker** — ghi last event (tool/summary) mỗi RuntimeEvent; (4) **stall threshold 5 phút** — không event → stalled; (5) **phase snapshot** — started/quiet/stalled cho mỗi phase; (6) **UI** — `packages/intercom/ui` hiện phase kẹt. Nối AFU (event-loop monitor — cùng concept detect block).

## Kiến trúc (ASCII)

```
  RUNTIME EVENT STREAM (tool/approval/...)
       │  mỗi event
       ▼
  HEARTBEAT TRACKER (per phase)
   ghi: lastToolName + lastToolSummary + assistantSummary + ts
       │
       ▼  snapshot trạng thái (poll):
   now - lastEventTs:
   ├─ < 30s     ──▶ started (đang chạy, event gần)
   ├─ 30s-5min  ──▶ quiet (im lặng, có thể bình thường)
   └─ > 5min    ──▶ STALLED (kẹt! 5 phút không event)
       │
       ▼  UI hiện: "Phase P7 STALLED — last tool: read_file @ 5:23 ago"
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/audit index.ts — RuntimeEvent stream (tool/approval/repair/channel)
// ✅ packages/core telemetry.ts — telemetry/metric pattern
// ✅ packages/core time.ts — single time helper (nowWallclock) cho timestamp
// ✅ packages/intercom/ui — overlay UI (hiện phase status)

// ❌ THIẾU: heartbeat tracker (last tool/summary per phase)
// ❌ THIẾU: stall-detect threshold 5 phút (started/quiet/stalled)
// ❌ THIẾU: phase-stalled UI alert
```

## Implementation

```typescript
// packages/agent/src/phase-heartbeat.ts (MỚI)
import { nowWallclock } from "@my-agent/core";
const STALL_MS = 5 * 60_000;
const QUIET_MS = 30_000;
export type PhaseState = "started" | "quiet" | "stalled";
export interface HeartbeatSnapshot {
  readonly phaseId: string;
  readonly lastToolName?: string;
  readonly lastToolSummary?: string;
  readonly lastAssistantSummary?: string;
  readonly lastEventTs: number;
  readonly state: PhaseState;
  readonly stalledForMs: number;
}
/** Tracker per phase — ghi mỗi event, snapshot phát hiện stall. */
export class PhaseHeartbeat {
  private last?: Omit<HeartbeatSnapshot, "state" | "stalledForMs">;
  constructor(private readonly phaseId: string) {}
  /** Ghi event (tool/assistant) — gọi mỗi RuntimeEvent. */
  beat(tool?: { name: string; summary: string }, assistantSummary?: string): void {
    this.last = {
      phaseId: this.phaseId,
      lastToolName: tool?.name,
      lastToolSummary: tool?.summary,
      lastAssistantSummary: assistantSummary,
      lastEventTs: nowWallclock(),
    };
  }
  /** Snapshot trạng thái hiện tại. */
  snapshot(): HeartbeatSnapshot | null {
    if (!this.last) return null;
    const gap = nowWallclock() - this.last.lastEventTs;
    const state: PhaseState = gap > STALL_MS ? "stalled" : gap > QUIET_MS ? "quiet" : "started";
    return { ...this.last, state, stalledForMs: state === "stalled" ? gap : 0 };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện phase kẹt nhanh (5 phút) | ❌ Heartbeat mỗi event = overhead nhỏ |
| ✅ last tool/summary — debug context | ❌ 5 phút threshold có thể quá dài/ngắn tùy task |
| ✅ UI hiện phase nào treo | ❌ Quiet bình thường có thể bị nhầm stalled (long-running tool) |

## Khác các hướng gần

| | AGJ Phase-Heartbeat | AFU Event-Loop Monitor | telemetry |
|---|---|---|---|
| Đo | Phase stall (5 phút không event) | Latency event loop | Runtime metric |
| Phát hiện | Agent kẹt phase | Sync block TUI | Quan sát chung |
| Context | last tool/summary | max/p99/mean | event |

## Khi nào chọn

- Workflow dài nhiều phase, cần biết phase nào kẹt
- Muốn context debug (last tool/assistant khi stall)
- Cần UI alert khi phase stalled
- Guard: stall threshold tuning, phân biệt long-running tool vs stall, heartbeat lightweight
