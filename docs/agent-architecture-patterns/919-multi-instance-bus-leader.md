# Hướng AII: Multi-Instance-Bus-Leader — Threaded Mode cho một bot token nhiều Pi instance: leader duy nhất poll `getUpdates`, follower đăng ký qua heartbeat và route Bot API calls qua leader; nếu leader exit, follower elect leader mới — không bao giờ hai process cùng poll một token

> **Nguồn gốc:** pi-telegram | **Coupling:** 🟡 — distributed coordination | **Agent-agnostic:** ⚠️ (bot API model) | **Code sẵn:** ⚠️ (có cross-process-lock + sync HLC; chưa có leader/follower + heartbeat) | **Effort:** 2 tuần

## Nguồn gốc

**pi-telegram** Threaded Mode cho **một bot token nhiều Pi instance**: **leader duy nhất poll `getUpdates`**, follower đăng ký qua **heartbeat** và route Bot API calls qua leader; nếu leader exit, follower **elect leader mới** — không bao giờ hai process cùng poll một token. Nguyên tắc: **single-poller** — Bot API getUpdates không thể chia (offset shared), chỉ 1 poll; **leader-follower** — leader poll + route, follower delegate; **heartbeat liveness** — follower detect leader chết; **failover election** — leader exit → follower elect mới; **invariant: never double-poll**.

## Mô tả

Với mya, pattern = **leader-follower bus coordination**: (1) mya đã có **cross-process-lock** (cron) + **sync** (HLC convergence) — nền coordination; (2) mya có **channels** adapters; (3) AII thêm **leader election** — acquire lock = become leader (poll); (4) **follower** — emit heartbeat cho leader, route API calls qua leader channel; (5) **leader death detection** — heartbeat timeout → follower try acquire (elect); (6) **single-poller invariant** — lock đảm bảo chỉ 1 poll getUpdates tại mọi thời điểm.

## Kiến trúc (ASCII)

```
  BOT TOKEN (shared — getUpdates không chia được)
    │
    ▼ LEADER ELECTION (lock acquire)
    ┌─────────────────────────────────────┐
    │ LEADER (instance 1) — poll getUpdates│ ← duy nhất poll
    │   ├─ receive update                  │
    │   └─ route → đúng follower           │
    └──────────┬──────────────────────────┘
               │ heartbeat channel
    ┌──────────┴──────────┬────────────────┐
    │ FOLLOWER 2          │ FOLLOWER 3     │
    │  emit heartbeat ───►│  route API     │
    │  route API via leader│  calls via leader│
    └─────────────────────┴────────────────┘
         │
         ▼ LEADER EXIT (heartbeat timeout):
         FOLLOWER detect → try acquire lock → ELECT new leader
         (invariant: KHÔNG BAO GIỜ 2 process poll cùng token)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron cross-process-lock.ts — PID liveness + TTL (leader lock nền)
// ✅ packages/sync index.ts — HLC convergence (coordination nền)
// ✅ packages/channels — adapters (Bot API call surface)
// ✅ packages/collab relay.ts — event bus (heartbeat channel nền)
// ✅ packages/core time.ts — nowWallclock (heartbeat timeout)

// ❌ THIẾU: leader election (lock = leader)
// ❌ THIẾU: follower heartbeat + API routing via leader
// ❌ THIẾU: failover election (leader death → follower elect)
```

## Implementation

```typescript
// packages/channels/src/bus-leader.ts (NEW)
import { nowWallclock } from "@my-agent/core";
import { acquireCronLock } from "@my-agent/cron"; // reuse cross-process lock

const HEARTBEAT_TIMEOUT_MS = 30_000;

export class BusLeader {
  private isLeader = false;
  private leaderAliveAt = nowWallclock();
  constructor(private readonly identity: string, private readonly poll: () => Promise<void>, private readonly route: (msg: unknown) => void) {}

  /** Try become leader — single poller. */
  async tryLead(): Promise<boolean> {
    const release = acquireCronLock(`bus-leader:${this.identity}`);
    if (release) { this.isLeader = true; void this.pollLoop(release); return true; }
    return false; // follower
  }
  private async pollLoop(release: () => void): Promise<void> {
    while (this.isLeader) {
      try { const updates = await this.poll(); for (const u of updates as unknown[]) this.route(u); }
      catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    release();
  }
  /** Follower heartbeat — leader death → elect. */
  onHeartbeat(alive: boolean, now: number): void {
    if (alive) this.leaderAliveAt = now;
    else if (now - this.leaderAliveAt > HEARTBEAT_TIMEOUT_MS) void this.tryLead(); // ELECT
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Single-poller invariant — không double-poll | ❌ Leader = SPOF khi failover gap |
| ✅ Failover election — leader exit recover | ❌ Heartbeat timeout = brief no-poll window |
| ✅ Follower route API qua leader (consistent) | ❌ Routing hop thêm latency |
| ✅ Nối cross-process-lock + collab bus | ❌ Election race khi nhiều follower cùng try |

## Khác các hướng gần

| | AII Multi-Instance-Bus-Leader | AIH Singleton-Lock-Registry | AIL Demand-Driven-Thread-Reconciler |
|---|---|---|---|
| Trọng tâm | Leader poll multi-instance | Singleton extension lock | Thread lifecycle state machine |
| Cơ chế | Leader/follower + heartbeat + election | Shared registry + identity | State machine + proof-before-delete |
| Quan hệ | Distributed coordination | Distributed lock | Distributed reconcile |

## Khi nào chọn

- Một bot token nhiều instance → cần single-poller
- Muốn failover tự động (leader exit → elect)
- Bot API không chia được (getUpdates shared offset)
- Guard: single-poller invariant, heartbeat timeout, election race guard, no-poll window minimal
