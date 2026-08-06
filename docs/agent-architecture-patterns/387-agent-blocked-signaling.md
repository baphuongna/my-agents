# Hướng NW: Agent Blocked Signaling — pane trạng thái working/blocked/idle, báo khi kẹt

> **Nguồn gốc:** Process status (top/htop — running/sleeping/zombie); TUI pane status bar; "blocked-state reporting"; "watchdog alert"; herdr; CI status badge (pending/running/success/fail)
> **Coupling:** 🟢 — thêm status state machine vào agent + TUI
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (print/TUI + lifecycle-hooks sẵn — chưa có blocked state machine + alert)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**Process status** (top/htop, ps): mỗi tiến trình có state (running, sleeping, blocked-on-IO, zombie) — nhìn 1 cái biết đang làm gì. **TUI status bar / pane status** (tmux pane, herdr): mỗi pane hiển thị trạng thái (working/blocked/idle/done) — user biết agent nào kẹt mà không cần check từng cái. **Watchdog alert**: khi agent blocked quá lâu → alert (notify, change color). **CI status badge**: pending → running → success/fail — at-a-glance status. Nguyên tắc: agent có **state machine rõ ràng** (working/blocked/idle/done), **TUI hiển thị real-time**, **alert khi blocked** lâu. Khác **103 agent-drift** (detect drift) — NW là **explicit status signal**; khác **327 interruptible** — NW **báo trạng thái** không phải interrupt.

## Mô tả

mya agent blocked signaling: mỗi agent (pane) có trạng thái trong state machine: **working** (đang làm), **blocked** (kẹt — chờ dependency/decision/resource), **idle** (rảnh, chờ task), **done** (xong). TUI (packages/print) hiển thị trạng thái real-time per pane — user nhìn 1 cái biết agent nào kẹt. Khi agent **blocked quá lâu** (> threshold) → alert (notify, đổi màu, sound). Agent tự set trạng thái (working khi bắt đầu, blocked khi chờ, idle khi xong). mya có `packages/print` (TUI) + `292 hooks` — NW thêm **status state machine** + **blocked threshold alert**.

## Kiến trúc

```
   AGENT STATE MACHINE (per pane):
     IDLE ──task──► WORKING ──chờ dep/decision──► BLOCKED
       ▲                │                            │
       │              done                      got resource
       │                │                            │
       └────────────────┘ ◄─────────────────────────┘
                             (unblock → WORKING)

   TUI (packages/print) — real-time status bar:
   ┌─ Pane 1: [WORKING] refactor auth    │  ⏱ 2m
   ├─ Pane 2: [BLOCKED] waiting review   │  ⚠ 8m  ← ALERT (blocked > 5m)
   ├─ Pane 3: [IDLE]                     │
   └─ Pane 4: [DONE] docs complete       │  ✓

   BLOCKED THRESHOLD ALERT:
    · blocked > 5min → notify user (sound/color)
    · blocked > 15min → escalate (382 need_decision?)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/print — TUI render (nền — NW status bar)
// ✅ 292 agent-lifecycle-hooks — hooks (nền — NW state transition)
// ✅ 103 agent-drift — detect drift (nền — NW explicit status)
// ✅ 382 NR escalation — blocked → escalate (nền — NW trigger)

// ❌ THIẾU: status state machine (working/blocked/idle/done)
// ❌ THIẾU: TUI status bar per pane (real-time)
// ❌ THIẾU: blocked threshold alert (notify khi kẹt lâu)
// ❌ THIẾU: blocked reason (tại sao kẹt — dependency/decision/resource)
```

## Implementation

```typescript
// packages/agent/src/blocked-signaling.ts (MỚI)
type AgentStatus = 'idle' | 'working' | 'blocked' | 'done';

interface StatusState {
  status: AgentStatus;
  since: number;        // timestamp chuyển sang status này
  reason?: string;      // tại sao blocked
  task?: string;        // đang làm gì
}

class BlockedSignaler {
  private states = new Map<string, StatusState>();
  private blockedThresholdMs = 5 * 60 * 1000; // 5 min

  set(id: string, status: AgentStatus, extra?: Partial<StatusState>): void {
    const prev = this.states.get(id);
    this.states.set(id, { status, since: Date.now(), ...extra });
    if (prev?.status !== status) this.emit(id, status); // state change → TUI
  }

  // Watchdog — check blocked quá lâu
  tick(): void {
    const now = Date.now();
    for (const [id, s] of this.states) {
      if (s.status === 'blocked' && now - s.since > this.blockedThresholdMs) {
        this.alert(id, s); // notify user
      }
    }
  }

  snapshot(): { id: string; status: AgentStatus; elapsedMs: number; reason?: string }[] {
    const now = Date.now();
    return [...this.states].map(([id, s]) => ({
      id, status: s.status, elapsedMs: now - s.since, reason: s.reason,
    }));
  }

  private emit(id: string, status: AgentStatus) { /* TUI update */ }
  private alert(id: string, s: StatusState) { /* notify: sound/color */ }
}

// Agent self-report:
// signaler.set('pane-2', 'blocked', { reason: 'waiting code review', task: 'auth refactor' });
// signaler.set('pane-2', 'working', { task: 'auth refactor' }); // unblocked
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User biết agent nào kẹt (at-a-glance) | ❌ Agent phải self-report (quên set status) |
| ✅ Alert khi blocked lâu (không bị quên) | ❌ Threshold tuning (5m? 15m?) |
| ✅ Reason kèm theo (biết TẠI SAO kẹt) | ❌ Status overhead (set state mỗi transition) |
| ✅ Nối 382 escalation (blocked → ask) | ❌ False positive (blocked OK — chờ hợp lý) |

## Khác các hướng gần

| | 103 Agent Drift | 327 Interruptible | 292 Lifecycle Hooks | NW: Blocked Signaling |
|---|---|---|---|---|
| Cái gì | Detect drift | Interrupt agent | Event hooks | **Status state machine + alert** |
| Status | ❌ (drift) | ❌ | ❌ (event) | ✅ working/blocked/idle |
| Alert | ❌ | ❌ | ❌ | ✅ blocked threshold |
| TUI | ❌ | ❌ | ❌ | ✅ per-pane bar |

## Khi nào chọn

- Nhiều agent pane chạy song song (cần at-a-glance status)
- Agent hay bị blocked (chờ dependency/decision)
- Muốn alert khi kẹt lâu (không bị quên)
- Kết hợp packages/print (TUI render) + 292 hooks (transition) + 382 escalation (blocked → ask); tune blocked threshold + guard false positive (blocked OK nếu hợp lý)
