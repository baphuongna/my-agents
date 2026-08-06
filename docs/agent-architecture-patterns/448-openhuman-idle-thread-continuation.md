# Hướng QF: Idle Thread Continuation — heartbeat tự tạo lượt cho luồng có goal khi ngừng lâu

> **Nguồn gốc:** OpenHuman (idle thread continuation); "heartbeat-driven proactive turn"; "goal-driven idle resume"; "self-initiated continuation"; "background goal pursuit"
> **Coupling:** 🟡 — cần heartbeat scheduler + goal-store + proactive turn dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + scheduler sẵn — chưa có heartbeat + goal-driven auto-turn)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenHuman** giải quyết vấn đề **goal abandonment**: user đặt goal cho luồng (thread) rồi quên/đi vắng. Agent ngừng (chờ user message) → goal bị bỏ mặc. **Idle thread continuation**: **heartbeat** kiểm tra định kỳ — nếu luồng có **active goal** + **idle quá lâu** (không user message > threshold) → heartbeat **tự tạo lượt mới** (proactive turn) để agent tiếp tục pursuing goal. Giống **cron job** (scheduled trigger) nhưng **goal-driven** (chỉ khi có goal + idle). Nguyên tắc: **agent proactively continues**, không chỉ react. Khác **448** (QF itself) — khác **441 PY sleep** (consolidate khi idle) — QF là **continue work khi idle**; khác **447 QE goal-reflection** (review goals) — QF là **pursue goals**.

## Mô tả

mya idle thread continuation: **heartbeat scheduler** chạy định kỳ. Mỗi tick: check tất cả thread → (1) có active goal? (2) idle > threshold? Nếu cả hai → **inject synthetic turn** ("[system] continue pursuing goal X") → agent-loop dispatch → agent làm tiếp. Heartbeat tôn trọng **rate limit** (không spam turn). Goal done → heartbeat ngừng tự-tạo cho thread đó. Nối agent-loop + 447 goal-reflection + 441 sleep-phases.

## Kiến trúc

```
  HEARTBEAT SCHEDULER (every 60s):
  ┌──────────────────────────────────────────────────┐
  │                                                    │
  │  for each thread:                                  │
  │    ┌─ CHECK ─────────────────────────────────┐    │
  │    │  has active goal?       YES              │    │
  │    │  idle > 5 min?          YES              │    │
  │    │  last auto-turn > 10m?  YES (rate limit) │    │
  │    └─────────────┬───────────────────────────┘    │
  │                  │ (all conditions met)            │
  │                  ▼                                 │
  │    ┌─ INJECT SYNTHETIC TURN ─────────────────┐    │
  │    │  [system] Heartbeat: continue pursuing   │    │
  │    │  goal "deploy to staging". Last action:  │    │
  │    │  tests passed. Next: deploy.              │    │
  │    └─────────────┬───────────────────────────┘    │
  │                  │                                 │
  │                  ▼                                 │
  │    AGENT LOOP dispatches → agent continues work   │
  │                                                    │
  │  GOAL DONE → heartbeat stops auto-turn for thread │
  └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ agent-loop — turn dispatch (nền — QF adds proactive turn)
// ✅ scheduler — periodic tasks (nền — QF = heartbeat scheduler)
// ✅ 447 goal-reflection — goal store (nền — QF = goal-driven trigger)
// ✅ 441 sleep-phases — idle detection (relate — QF = idle → work, not sleep)

// ❌ THIẾU: heartbeat scheduler (periodic idle check)
// ❌ THIẾU: goal-driven auto-turn (inject synthetic turn when idle + has goal)
// ❌ THIẾU: rate limiting (don't spam auto-turns)
// ❌ THIẾU: goal-done detection (stop auto-turn when goal complete)
```

## Implementation

```typescript
// packages/agent/src/idle-continuation.ts (NEW)
interface ThreadState {
  threadId: string;
  lastUserMessageAt: number;
  lastAutoTurnAt: number;
  activeGoalId: string | null;
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min idle
const RATE_LIMIT_MS = 10 * 60 * 1000;       // max 1 auto-turn per 10 min

class IdleContinuationHeartbeat {
  private threads = new Map<string, ThreadState>();

  constructor(private dispatch: (threadId: string, content: string) => Promise<void>) {
    setInterval(() => void this.tick(), 60_000); // every 60s
  }

  registerThread(threadId: string, goalId: string | null): void {
    this.threads.set(threadId, {
      threadId, lastUserMessageAt: Date.now(), lastAutoTurnAt: 0, activeGoalId: goalId,
    });
  }

  onUserMessage(threadId: string): void {
    const t = this.threads.get(threadId);
    if (t) t.lastUserMessageAt = Date.now();
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const thread of this.threads.values()) {
      if (!thread.activeGoalId) continue;          // no goal → skip
      if (now - thread.lastUserMessageAt < IDLE_THRESHOLD_MS) continue;  // not idle long enough
      if (now - thread.lastAutoTurnAt < RATE_LIMIT_MS) continue;          // rate limited

      // Inject synthetic turn to continue goal
      thread.lastAutoTurnAt = now;
      await this.dispatch(thread.threadId,
        `[system] Heartbeat: thread idle for ${Math.round((now - thread.lastUserMessageAt) / 60000)}min. ` +
        `Continue pursuing goal "${thread.activeGoalId}".`);
    }
  }

  onGoalComplete(threadId: string): void {
    const t = this.threads.get(threadId);
    if (t) t.activeGoalId = null; // stop auto-turn
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Goal không bị bỏ (agent tự tiếp tục khi idle) | ❌ Unwanted compute (agent chạy khi user không cần) |
| ✅ Proactive agent (không chỉ react, chủ động pursue) | ❌ Rate limit complexity (spam control) |
| ✅ Long-running goal support (goal chạy nền, không quên) | ❌ Cost (auto-turn tốn token/API quota) |
| ✅ User flexibility (đi vắng, agent vẫn làm) | ❌ False trigger (goal stale → auto-turn vô ích) |

## Khác các hướng gần

| | 441 Sleep-Phases | 447 Goal-Reflection | 446 Subconscious | QF: Idle-Continuation |
|---|---|---|---|---|
| Trọng tâm | Consolidate khi idle | Review goals | Behavioral nudge | **Continue work khi idle** |
| Khi idle | Sleep (compress) | Review goals | Observe | **Pursue goals (work)** |
| Turn | ❌ | ❌ (meta) | ❌ (stealth) | **✅ (proactive turn)** |

## Khi nào chọn

- Agent có long-running goal (deploy, monitor, multi-step)
- User thường đi vắng (agent bị idle, goal bỏ mặc)
- Cần proactive agent (tự tiếp tục, không chờ user)
- Nối agent-loop + 447 goal-reflection + 441 sleep-phases
