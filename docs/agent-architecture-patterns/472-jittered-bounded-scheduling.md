# Hướng RD: Jittered Bounded Scheduling — Claude CronCreate deterministic jitter né :00/:30, idle-only

> **Nguồn gốc:** Leaks Claude Code (`CronCreate` tool); "deterministic jitter avoids :00/:30 herd"; "jobs fire only when REPL idle"; "recurring fires up to 10% period late (max 15 min)"; "one-shot on :00/:30 fires up to 90s early"; "off-minute is the bigger lever"; "auto-expire after 7 days"
> **Coupling:** 🟢 — thêm jitter + idle-gate + 7-day bound vào cron scheduler
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/cron cron-store sẵn — chưa có deterministic jitter + idle-gate + herd-avoidance)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Claude Code** (`CronCreate`) mô tả scheduler với 3 đặc tính: (1) **Herd avoidance via off-minute**: tránh `:00`/`:30` (mọi user "9am" → `0 9` → API spike cùng lúc toàn cầu); chọn phút lệch ("every morning around 9" → `57 8` hoặc `3 9`). (2) **Deterministic jitter**: recurring fire chậm tới 10% period (max 15 min), one-shot trên `:00`/`:30` fire sớm tới 90s — **deterministic** (reproducible, không random thuần) nhưng trải đều tải. (3) **Idle-only**: job chỉ fire khi REPL **idle** (không mid-query) — không gián đoạn task đang chạy. (4) **Bounded**: recurring auto-expire sau 7 ngày, session-only (in-memory). Nguyên tắc: **schedule友好 cho backend** + **không gián đoạn user**. Khác **390 low-cost-triggers** (cheap schedule) — RD là **jitter+herd**; khác cron thuần — RD **deterministic jitter + idle-gate**.

## Mô tả

mya jittered bounded scheduling: (1) **Off-minute picker**: user "9am" → chọn `57 8` hoặc `3 9` (không `0 9`). (2) **Deterministic jitter**: cron fire = match-time + deterministic-offset (recurring ≤ 10% period, max 15min; one-shot `:00`/`:30` ≤ 90s early). (3) **Idle-gate**: check REPL idle (không mid-query) trước fire — nếu busy → defer tới idle. (4) **7-day bound**: recurring auto-expire sau 7 ngày (fire lần cuối rồi delete). (5) **Session-only**: in-memory, gone khi session exit. mya có `packages/cron` (cron-store, catchup, grace) — RD thêm **off-minute picker** + **deterministic jitter** + **idle-gate** + **7-day expiry**.

## Kiến trúc

```
  USER: "remind me every morning around 9am to check deploy"
        │
        ▼
  ┌─── OFF-MINUTE PICKER (né :00/:30 herd) ──────────────┐
  │  "around 9am" → NOT "0 9 * * *" (herd)                │
  │  → "57 8 * * *" hoặc "3 9 * * *" (off-minute)         │
  │  (chỉ :00/:30 khi user ghi rõ "at 9:00 sharp")        │
  └───────────────────────┬─────────────────────────────┘
                          │ (cron expression + jitter)
                          ▼
  ┌─── DETERMINISTIC JITTER ─────────────────────────────┐
  │  recurring "57 8": fire chậm tới 10% period (max 15m) │
  │  → actual fire: 8:57 + deterministicOffset(seed)      │
  │  (reproducible per job, trải đều tải toàn cầu)        │
  └───────────────────────┬─────────────────────────────┘
                          │ (match-time reached)
                          ▼
  ┌─── IDLE-GATE ────────────────────────────────────────┐
  │  REPL idle (not mid-query)?                           │
  │    YES → fire job (enqueue prompt)                    │
  │    NO  → defer (wait until idle, fire then)           │
  │  → không gián đoạn task đang chạy                     │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── 7-DAY BOUND ──────────────────────────────────────┐
  │  recurring auto-expire sau 7 ngày (fire cuối → delete)│
  │  session-only (in-memory, gone khi exit)              │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/cron cron-store — cron persistence (nền — RD jitter trên đây)
// ✅ packages/cron cron-catchup — missed-fire catchup (nền — RD idle-gate defer)
// ✅ packages/cron cron-grace — grace period (nền — RD 7-day bound)
// ✅ packages/cron cross-process-lock — single-fire (nền — RD session-only)

// ❌ THIẾU: off-minute picker (né :00/:30 herd)
// ❌ THIẾU: deterministic jitter (recurring ≤10% period max15m, one-shot ≤90s)
// ❌ THIẾU: idle-gate (fire only when REPL idle, defer if busy)
// ❌ THIẾU: 7-day auto-expire (recurring bounded)
```

## Implementation

```typescript
// packages/cron/src/jittered-scheduler.ts (MỚI)
import { parseCron, nextFire } from './cron-store';

class JitteredScheduler {
  constructor(private now: () => number, private isIdle: () => boolean) {}

  // off-minute picker — né :00/:30 khi user không chỉ exact time
  pickOffMinute(hour: number, approximate: boolean): string {
    if (!approximate) return `0 ${hour} * * *`;       // "9:00 sharp" → :00
    const off = [57, 3, 7, 11, 13, 17, 23, 29, 31, 37, 41, 43, 47, 53]; // né 0,30
    const min = off[Math.floor(this.now() / 1000) % off.length]!;
    return `${min} ${hour} * * *`;
  }

  // deterministic jitter (reproducible per job-id)
  jitterOffset(jobId: string, periodMs: number, recurring: boolean): number {
    const seed = hash(jobId);  // deterministic, không random thuần
    if (recurring) return (seed % Math.floor(periodMs * 0.1)) % 15 * 60_000; // ≤10%, max15min
    return -(seed % 90_000);  // one-shot on :00/:30: up to 90s early
  }

  // idle-gate — fire only when idle
  async maybeFire(jobId: string, fireTime: number): Promise<{ fired: boolean; deferred?: boolean }> {
    const offset = this.jitterOffset(jobId, periodMs(jobId), true);
    const actualTime = fireTime + offset;
    if (this.now() < actualTime) return { fired: false };
    if (!this.isIdle()) return { fired: false, deferred: true }; // wait until idle
    return { fired: true }; // enqueue prompt
  }

  // 7-day bound
  isExpired(createdAt: number, recurring: boolean): boolean {
    return recurring && (this.now() - createdAt) > 7 * 86_400_000;
  }
}

// Usage:
// const cron = sched.pickOffMinute(9, true);   // "around 9" → "57 8 * * *" (né herd)
// const { fired, deferred } = await sched.maybeFire(jobId, nextFireTime);
// if (deferred) → wait idle then retry
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Herd avoidance (né :00/:30 → backend không spike) | ❌ Off-minute miss (user muốn exact :00 → sai ý) |
| ✅ Deterministic jitter (reproducible, trải tải) | ❌ Idle-defer (job trễ khi busy liên tục) |
| ✅ Idle-gate (không gián đoạn task đang chạy) | ❌ 7-day bound (long recurring không — phải re-create) |
| ✅ Bounded (auto-expire, session-only, không leak) | ❌ Session-only (restart → job mất) |

## Khác các hướng gần

| | 390 Low-Cost-Triggers | cron (thuần) | RD: Jittered-Bounded |
|---|---|---|---|
| Cái gì | Cheap schedule | Fixed cron | **Jitter + idle-gate + 7-day** |
| Herd | ❌ | ❌ (spike :00) | **✅ off-minute** |
| Idle | ❌ | ❌ (interrupt) | **✅ gate** |

## Khi nào chọn

- Agent có recurring schedule (remind, periodic check)
- Backend-friendly (né herd :00/:30, deterministic jitter trải tải)
- Không gián đoạn user (idle-gate, defer khi busy)
- Nối packages/cron cron-store + catchup + grace + cross-process-lock; guard off-minute intent detection ("sharp" → :00, "around" → off), idle-defer (busy lâu → job trễ nhiều), và 7-day re-create (user biết bound); RD = scheduling-friendly layer trên cron thuần
