# Hướng AIF: Mid-Run-Steering-Injection — agent đang chạy có thể được steer mid-run: message được inject thành user message và redirect sau tool hiện tại; nếu session chưa ready thì message vào `pendingSteers` queue — steering từ tool `steer_subagent` hoặc composer trong conversation viewer

> **Nguồn gốc:** pi-subagents3 | **Coupling:** 🟡 — runtime steering | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có subscribe + abort; chưa có mid-run inject + pendingSteers) | **Effort:** 1.5 tuần

## Nguồn gốc

**pi-subagents3** agent đang chạy có thể được **steer mid-run**: message được **inject thành user message** và **redirect sau tool hiện tại**; nếu session chưa ready thì message vào **`pendingSteers` queue** — steering từ tool **`steer_subagent`** hoặc **composer** trong conversation viewer. Nguyên tắc: **non-interruptive steer** — không abort, inject user message; **tool-boundary redirect** — chờ tool hiện tại xong rồi apply (không cắt giữa tool); **pending queue** — session chưa ready → queue, apply khi ready; **multiple sources** — tool hoặc UI composer.

## Mô tả

Với mya, pattern = **mid-run steering injection**: (1) mya đã có **subscribe** (pool AgentSession.subscribe) + **abort** (killSubagent); (2) AIF thêm **steer** — inject user message vào session đang chạy; (3) **tool-boundary**: chờ tool hiện tại done → redirect (apply steer giữa các tool, không cắt mid-tool); (4) **pendingSteers** — nếu session busy (tool đang chạy) → queue, apply sau tool done; (5) **2 source**: tool `steer_subagent` (agent gọi) + composer UI (nối AHZ).

## Kiến trúc (ASCII)

```
  AGENT đang chạy (turn active)
    │
    ├─ steer_subagent(id, "đổi hướng: focus X")  hoặc  COMPOSER (UI)
    │    │
    │    ▼ session ready? (tool hiện tại xong?)
    │    ├─ NO  → pendingSteers.push(msg)   (queue — apply sau tool done)
    │    └─ YES → inject as USER MESSAGE
    │              │
    │              ▼ REDIRECT (agent tiếp turn với context mới)
    │                 └─► apply pendingSteers trước khi tiếp tục
    │
    └─ (KHÔNG abort — steer non-interruptive, agent tiếp tục với hướng mới)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — AgentSession.subscribe(listener) (event feed)
// ✅ packages/agent — killSubagent (abort — AIF khác: non-interruptive)
// ✅ packages/agent — spawnSubagent handle (target steer)
// ✅ packages/core loop.ts — loop control (nền tool-boundary hook)

// ❌ THIẾU: steer (inject user message mid-run)
// ❌ THIẾU: pendingSteers queue (apply khi ready)
// ❌ THIẾU: tool-boundary redirect hook
```

## Implementation

```typescript
// packages/agent/src/mid-run-steering.ts (NEW)
export interface SteerableSession {
  isBusy(): boolean;                      // tool đang chạy?
  injectUserMessage(msg: string): void;   // inject vào turn
}

/** Steer mid-run — non-interruptive, tool-boundary redirect. */
export class SteerController {
  private readonly pendingSteers = new Map<string, string[]>();

  /** Steer — inject hoặc queue tùy busy. */
  steer(sessionId: string, session: SteerableSession, msg: string): void {
    if (session.isBusy()) {
      // tool đang chạy — queue, apply sau done
      const q = this.pendingSteers.get(sessionId) ?? [];
      q.push(msg);
      this.pendingSteers.set(sessionId, q);
    } else {
      session.injectUserMessage(msg);      // ready — inject ngay
    }
  }
  /** Hook sau tool done — apply pending steers. */
  onToolBoundary(sessionId: string, session: SteerableSession): void {
    const q = this.pendingSteers.get(sessionId);
    if (!q || q.length === 0) return;
    const msg = q.shift()!;
    if (q.length === 0) this.pendingSteers.delete(sessionId);
    session.injectUserMessage(msg);        // apply queued steer
  }
}
// loop.ts: sau mỗi tool done → onToolBoundary. Tool steer_subagent → steer().
// Composer UI (AHZ) → steer() non-interruptive.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Non-interruptive — không abort, đổi hướng mượt | ❌ Tool-boundary delay — steer chờ tool done |
| ✅ pendingSteers — không mất steer khi busy | ❌ Inject user message có thể confuse agent |
| ✅ 2 source (tool + UI composer) | ❌ Race: nhiều steer cùng lúc — thứ tự? |
| ✅ Nối subscribe + loop sẵn | ❌ Redirect có thể fail nếu agent ignore |

## Khác các hướng gần

| | AIF Mid-Run-Steering | AHX Graceful-Turn-Limit | AHZ Live-Widget-Fleetview |
|---|---|---|---|
| Trọng tâm | Đổi hướng mid-run | Wrap-up trước abort | Widget + composer |
| Cơ chế | Inject + tool-boundary + pending | Soft warning + status | Status bar + keyboard nav |
| Quan hệ | Action steer | Khi kết thúc | UI cho AIF (composer) |

## Khi nào chọn

- Cần đổi hướng agent đang chạy mà không abort/restart
- Tool-boundary safe (không cắt mid-tool)
- Steer từ nhiều source (tool + UI)
- Guard: non-interruptive, tool-boundary apply, pendingSteers FIFO, redirect idempotent, max steer rate
