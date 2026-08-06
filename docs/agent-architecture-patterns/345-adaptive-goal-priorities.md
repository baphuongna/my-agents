# Hướng MG: Adaptive Goal Priorities — replan + đổi ưu tiên khi context thay đổi

> **Nguồn gốc:** Replanning (HTN — Hierarchical Task Network); "adaptive planning"; "goal reasoning" (GRD — Goal Reasoning Domain); "dynamic priority queue"; "opportunistic planning"; "task interruption & resumption"; priority inversion
> **Coupling:** 🟡 — thêm replan engine vào agent loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (task decomposition sẵn — chưa có dynamic reprioritization)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Replanning** (HTN planner): khi state đổi, plan cũ không còn tối ưu → replan. **Goal reasoning** (GRD): agent tự xác định goal nào quan trọng nhất **trong context hiện tại** — goal ưu tiên thay đổi theo time/resource/new info. **Dynamic priority queue**: task priority đổi runtime (VD deadline đến → boost). **Opportunistic planning**: nếu cơ hội xuất hiện (info mới), nắm lấy — đổi goal. Nguyên tắc: **goal không cố định** — agent theo dõi context, **reprioritize** khi cần. Khác **104 task-decomposition** (phân nhỏ 1 lần) — MG **động** (reprioritize liên tục); khác **331 escalation** (deadline → escalate) — MG **reorder goal**; khác **345** (self).

## Mô tả

mya adaptive goal priorities: agent có nhiều goal (task), mỗi goal có priority dynamic. Khi context đổi (deadline đến, info mới, error xảy ra, resource hết) → replan → reorder priority. VD: đang làm goal A → phát hiện bug khẩn → boost goal "fix bug" lên cao → tạm dừng A. mya có 104 task-decomposition — MG thêm **dynamic reprioritization** + **context-triggered replan**. Nối 331 escalation (deadline trigger).

## Kiến trúc

```
  AGENT GOAL QUEUE (priority dynamic):
   [G1: refactor (pri 5)] [G2: fix-bug (pri 3)] [G3: docs (pri 1)]
        │
        │  CONTEXT CHANGE EVENT:
        │   · user: "production is down!" → EMERGENCY
        │   · deadline: G3 due in 10min → BOOST
        │   · error: G1 hit blocker → DEMOTE
        │   · new info: dependency ready → ENABLE new goal
        │
        ▼
  REPLAN ENGINE:
   · evaluate all goals against new context
   · G2 fix-bug: EMERGENCY → pri 9 (⬆ từ 3)
   · G3 docs: deadline imminent → pri 7 (⬆ từ 1)
   · G1 refactor: blocked → pri 0 (⬇ từ 5, tạm dừng)
        │
        ▼
  REORDERED QUEUE:
   [G2: fix-bug (pri 9)] [G3: docs (pri 7)] [G1: refactor (paused)]
        │
        ▼
  AGENT switch to G2 (highest priority)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 104 task-decomposition — decompose task (nền — MG reprioritize động)
// ✅ 331 LS escalation — deadline trigger (nền — MG deadline boost)
// ✅ 291 cancel-propagation — cancel/interrupt (nền — MG pause goal)
// ✅ 292 agent-lifecycle-hooks — hooks (nền — replan trigger)
// ✅ 103 agent-drift — detect drift (replan trigger)

// ❌ THIẾU: dynamic priority queue (priority đổi runtime)
// ❌ THIẾU: replan engine (context change → reprioritize)
// ❌ THIẾU: context trigger rules (deadline/error/new-info → action)
// ❌ THIẾU: goal pause/resume (interrupt + resume sau)
```

## Implementation

```typescript
// packages/agent/src/replan.ts (NEW)
interface Goal {
  id: string;
  description: string;
  priority: number;       // dynamic — higher = more urgent
  status: 'active' | 'paused' | 'done' | 'blocked';
  deadline?: number;
  dependencies?: string[];
}

type ContextEvent =
  | { type: 'emergency'; goalId: string }
  | { type: 'deadline-near'; goalId: string; hoursLeft: number }
  | { type: 'error'; goalId: string }
  | { type: 'dependency-ready'; goalId: string };

class AdaptivePlanner {
  constructor(private goals: Goal[]) {}

  // Replan — process context event → reprioritize
  replan(event: ContextEvent): Goal[] {
    switch (event.type) {
      case 'emergency':
        this.boost(event.goalId, 9); // ⬆ urgent
        this.pauseOthers(event.goalId);
        break;
      case 'deadline-near':
        this.boost(event.goalId, Math.max(7, 10 - event.hoursLeft));
        break;
      case 'error':
        this.update(event.goalId, { status: 'blocked', priority: 0 });
        break;
      case 'dependency-ready':
        this.update(event.goalId, { status: 'active' });
        break;
    }
    return this.ranked();
  }

  // Periodic replan — check deadline, drift
  tick(): Goal[] {
    const now = Date.now();
    for (const g of this.goals) {
      if (g.deadline && g.status === 'active') {
        const hoursLeft = (g.deadline - now) / 3_600_000;
        if (hoursLeft < 1) this.boost(g.id, 8);    // imminent → boost
        else if (hoursLeft < 0) this.boost(g.id, 10); // overdue → max
      }
    }
    return this.ranked();
  }

  private ranked(): Goal[] {
    return this.goals.filter(g => g.status === 'active').sort((a, b) => b.priority - a.priority);
  }
  private boost(id: string, pri: number) { this.update(id, { priority: pri }); }
  private pauseOthers(activeId: string) {
    this.goals.filter(g => g.id !== activeId && g.status === 'active')
      .forEach(g => this.update(g.id, { status: 'paused' }));
  }
  private update(id: string, patch: Partial<Goal>) {
    const g = this.goals.find(x => x.id === id); if (g) Object.assign(g, patch);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thích ứng context đổi (HTN replanning) | ❌ Replan overhead (re-evaluate mỗi event) |
| ✅ Emergency → switch ngay (opportunistic) | ❌ Thrashing (priority đổi liên tục) |
| ✅ Deadline-aware (boost khi gần) | ❌ Paused goal có thể bị quên (starvation) |
| ✅ Nối 104 decomposition + 331 escalation | ❌ Replan logic phức tạp (trigger rule tuning) |

## Khác các hướng gần

| | 104 Task Decomposition | 331 Escalation | 103 Agent Drift | MG: Adaptive Priorities |
|---|---|---|---|---|
| Cái gì | Phân nhỏ 1 lần | Deadline → escalate | Detect drift | **Reprioritize động** |
| Dynamic | ❌ (1 lần) | ❌ (1 event) | ❌ (detect) | ✅ continuous |
| Reorder | ❌ | ❌ | ❌ | ✅ priority queue |
| Pause/Resume | ❌ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Nhiều goal cạnh tranh (priority cần đổi runtime)
- Context thay đổi thường (emergency, deadline, error, new info)
- Muốn agent opportunistic (nắm cơ hội / switch khi cần)
- Kết hợp 104 decomposition (phân nhỏ) + 331 escalation (deadline) + 103 drift (detect); guard against thrashing (cooldown) + starvation (fairness)
