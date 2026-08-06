# Hướng QE: Goal Reflection Agent — goals agent review mục tiêu so memory/hội thoại rồi điều chỉnh

> **Nguồn gốc:** OpenHuman (goal reflection agent); "meta-cognitive goal review"; "goal drift detection"; "periodic goal re-evaluation"; "self-assessment loop for objectives"
> **Coupling:** 🟡 — cần dedicated goals-agent + meta-cognitive review loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent + memory sẵn — chưa có goals-agent + goal-review protocol)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenHuman** có **goals agent** chuyên trách: định kỳ **review** mục tiêu hiện tại so với **memory** + **hội thoại gần đây** → phát hiện mục tiêu đã stale/completed/conflicting → **điều chỉnh** (đánh dấu done, đổi priority, thêm mục tiêu mới). Giống **meta-cognition** (nghĩ về nghĩ): agent không chỉ làm task mà còn **review chính mục tiêu** có còn hợp lý không. **Goal drift detection**: mục tiêu ban đầu có thể không còn phù hợp sau nhiều turn → goals agent phát hiện và điều chỉnh. Nguyên tắc: **mục tiêu là động, không tĩnh** — review định kỳ, cập nhật. Khác **446 QD subconscious** (behavioral nudge) — QE là **goal-level review**; khác **08 subagents** (delegate task) — QE delegate **meta-cognition**.

## Mô tả

mya goal reflection agent: **goals agent** (subagent chuyên trách) chạy định kỳ (mỗi N turn hoặc end-of-session). (1) **Load** current goals (list, priority, status). (2) **Review** so với memory + conversation: goal nào completed? conflicting? stale (không còn relevant)? (3) **Adjust**: mark done, change priority, add new, remove stale. (4) **Report** goal changes to main agent. Main agent biết mục tiêu cập nhật → điều chỉnh hành vi. Nối 08 subagents + 82 memory-consolidation + 446 subconscious-steering.

## Kiến trúc

```
  GOALS AGENT (meta-cognitive subagent — periodic):
  ┌──────────────────────────────────────────────────────┐
  │                                                       │
  │  ① LOAD current goals:                                │
  │     [1] "fix auth bug" (priority: high, active)       │
  │     [2] "add logging" (priority: medium, active)      │
  │     [3] "write docs" (priority: low, pending)         │
  │                                                       │
  │  ② REVIEW against memory + recent conversation:       │
  │     memory: "auth bug fixed in commit abc"            │
  │     conv:   user said "logging can wait"              │
  │     → goal 1: COMPLETED (auth bug fixed)              │
  │     → goal 2: DEPRIORITIZED (user said wait)          │
  │     → goal 3: STILL RELEVANT                          │
  │                                                       │
  │  ③ ADJUST:                                            │
  │     [1] "fix auth bug" → status: done                 │
  │     [2] "add logging" → priority: low                 │
  │     [3] "write docs" → priority: medium (bumped up)   │
  │     [4] NEW: "deploy to staging" (from conversation)  │
  │                                                       │
  │  ④ REPORT goal changes → main agent adjusts behavior  │
  │                                                       │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 08 subagents — subagent dispatch (nền — QE = goals-specific subagent)
// ✅ 82 memory-consolidation — memory query (review source)
// ✅ message history — conversation (review source)
// ✅ 446 subconscious-steering — behavioral nudge (relate — QE = goal-level)

// ❌ THIẾU: goals agent (meta-cognitive subagent)
// ❌ THIẾU: goal store (goal list + priority + status)
// ❌ THIẾU: goal review protocol (load → review → adjust → report)
// ❌ THIẾU: goal drift detection (stale/conflicting/completed)
```

## Implementation

```typescript
// packages/agent/src/goal-reflection.ts (NEW)
interface Goal {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'active' | 'done' | 'dropped';
  createdAt: number;
}

interface GoalReviewResult {
  changes: GoalChange[];
  updatedGoals: Goal[];
}
interface GoalChange { goalId: string; field: string; oldValue: unknown; newValue: unknown; reason: string; }

class GoalReflectionAgent {
  async review(
    goals: Goal[],
    memorySnapshot: string,
    conversationSummary: string,
  ): Promise<GoalReviewResult> {
    const changes: GoalChange[] = [];
    const updated = goals.map((g) => ({ ...g }));

    for (const goal of updated) {
      // Check completed: memory says task done
      if (goal.status === 'active' && this.isCompleted(goal, memorySnapshot)) {
        changes.push({ goalId: goal.id, field: 'status', oldValue: 'active', newValue: 'done', reason: 'memory confirms completion' });
        goal.status = 'done';
      }
      // Check stale: not mentioned in recent conversation
      if (goal.status === 'active' && this.isStale(goal, conversationSummary)) {
        changes.push({ goalId: goal.id, field: 'priority', oldValue: goal.priority, newValue: 'low', reason: 'not mentioned recently, deprioritize' });
        goal.priority = 'low';
      }
      // Check conflicting with higher priority goal
      const conflict = this.findConflict(goal, updated);
      if (conflict) {
        changes.push({ goalId: goal.id, field: 'priority', oldValue: goal.priority, newValue: 'low', reason: `conflicts with ${conflict.id}` });
        goal.priority = 'low';
      }
    }

    // Detect new goals from conversation
    const newGoals = this.extractNewGoals(conversationSummary);
    updated.push(...newGoals);

    return { changes, updatedGoals: updated };
  }

  private isCompleted(_goal: Goal, _mem: string): boolean { return false; }
  private isStale(_goal: Goal, _conv: string): boolean { return false; }
  private findConflict(_goal: Goal, _all: Goal[]): Goal | null { return null; }
  private extractNewGoals(_conv: string): Goal[] { return []; }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mục tiêu động (review + adjust định kỳ, không stale) | ❌ Meta-cognitive cost (goals agent tốn token) |
| ✅ Phát hiện completed/conflicting/stale (tự động) | ❌ False positive (đánh dấu done khi chưa done) |
| ✅ Main agent biết mục tiêu cập nhật (adjust behavior) | ❌ Priority churn (đổi liên tục gây nhiễu) |
| ✅ Meta-cognition (nghĩ về mục tiêu, không chỉ làm) | ❌ Latency (review periodic, không real-time) |

## Khác các hướng gần

| | 446 Subconscious | 08 Subagents | 82 Memory-Consolidation | QE: Goal-Reflection |
|---|---|---|---|---|
| Trọng tâm | Behavioral nudge | Delegate task | Session → memory | **Review goals** |
| Cấp | Behavior | Task | Memory | **Meta-cognitive** |
| Agent thấy? | ❌ (stealth) | ✅ (explicit) | Background | **✅ (report to main)** |

## Khi nào chọn

- Agent chạy dài (nhiều turn, mục tiêu có thể stale)
- Cần meta-cognition (review mục tiêu, không chỉ làm task)
- Mục tiêu động (completed, conflicting, stale cần phát hiện)
- Nối 08 subagents + 82 memory-consolidation + 446 subconscious-steering
