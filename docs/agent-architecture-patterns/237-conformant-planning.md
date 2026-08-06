# Hướng IC: Conformant Planning — lập kế hoạch bền vững dưới không đầy đủ quan sát

> **Nguồn gốc:** classical AI planning — "conformant planning" (Smith & Weld 1998; Camacho et al. POMDP-based); "planning under uncertainty"; FOND planning (fully observable non-deterministic)
> **Coupling:** 🟡 — planner nằm trong agent loop, ảnh hưởng action selection
> **Agent-agnostic:** ⚠️ (cần planner tích hợp vào reasoning loop)
> **Code sẵn:** ❌ (có lookahead-tree 185 + structured-reasoning 125 — thiếu uncertainty planner)
> **Effort:** 3-5 tuần

## Nguồn gốc

Conformant planning là nhánh classical AI planning xử lý **thiếu thông tin**: agent không biết chính xác trạng thái môi trường (partial observability) — chỉ có *belief state* (tập hợp các trạng thái có thể). Bài toán: tìm một plan **đảm bảo đạt mục tiêu bất kể trạng thái thật nào** (trong tập belief). Smith & Weld (1998) định nghĩa: conformant plan là chuỗi action "work regardless of initial state uncertainty." POMDP (Partially Observable MDP) là khung toán học tổng quát — belief state là probability distribution, chọn action tối ưu hoá kỳ vọng. FOND planning (fully-observable non-deterministic) nhẹ hơn — action có nhiều outcome, tìm plan robust.

Khác **185 lookahead-tree-search** (giả định *đầy đủ quan sát* — biết chính xác state để search) — IC xử lý *không đầy đủ*. Khác **119 bounded-self-correction** (sửa sau khi thấy lỗi) — IC phòng *trước* (plan robust từ đầu, không cần sửa). Khác **159 multi-criteria-decision** (chọn theo nhiều tiêu chí, đã biết outcome) — IC chọn action **bền vững dưới nhiều outcome**. Nối **238 uncertainty-quantification** (ID — đo độ chắc chắn), **239 world-model** (IE — belief state).

## Mô tả

mya conformant planning: thay vì agent lập plan giả định môi trường xác định, agent lập plan **bền vững** — mỗi step cân nhắc nhiều outcome có thể, chọn action "an toàn bất kể chuyện gì xảy ra." Ví dụ: agent cần tạo file — không biết thư mục tồn không (uncertain) → plan conformant: kiểm tra + tạo thư mục (xử lý cả hai trường hợp) trước khi ghi. Agent dùng **structured-reasoning** (125) + lookahead (185) nhưng thêm belief tracking: trạng thái = tập hợp khả năng, action phải "cover" hết. Khi quan sát thêm (tool result) → thu hẹp belief.

## Kiến trúc

```
  GOAL: "deploy agent v2 to /opt/mya"
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  BELIEF STATE (tập hợp trạng thái có thể)     │
  │                                               │
  │  S1: /opt/mya tồn tại, v1 chạy                │
  │  S2: /opt/mya tồn tại, rỗng                   │
  │  S3: /opt/mya KHÔNG tồn tại                   │
  │  S4: disk đầy                                  │
  │  (agent không biết trạng thái thật là nào)     │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────┐
  │  CONFORMANT PLANNER                            │
  │  Tìm plan reach goal từ MỌI Si:                │
  │                                               │
  │  step 1: check df -h (thu hẹp: loại S4)       │
  │  step 2: mkdir -p /opt/mya (cover S3)          │
  │  step 3: backup if v1 exists (cover S1)       │
  │  step 4: deploy (an toàn cho mọi S còn lại)    │
  │                                               │
  │  → plan WORKS bất kể belief thật              │
  └──────────────────┬───────────────────────────┘
                     │ quan sát (tool result)
                     ▼
              THU HẸP BELIEF → re-plan nếu cần
```

```
mya: lookahead 185 + structured-reasoning 125 — thiếu belief-state tracker + conformant solver
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 185 lookahead-tree-search — search tree (giả định deterministic — nền tảng)
// ✅ 125 structured-reasoning — step-by-step reasoning (scaffold cho planning)
// ✅ 104 task-decomposition — chia task lớn → sub-tasks (plan structure)
// ✅ 119 bounded-self-correction — sửa lỗi sau khi thấy (reactive — khác IC proactive)
// ✅ packages/tools — tool discovery + observation (input cho belief update)

// ❌ THIẾU: belief-state representation (tập hợp trạng thái có thể)
// ❌ THIẾU: conformant solver (tìm plan robust cho mọi belief)
// ❌ THIẾU: observation → belief-update (thu hẹp sau tool result)
// ❌ THIẾU: outcome branching model (non-deterministic action)
```

## Implementation

```typescript
// packages/agent/src/conformant-planner.ts (NEW)
interface BeliefState {
  possibleStates: WorldState[];   // tập hợp trạng thái agent chưa phân biệt được
}

interface Action {
  name: string;
  // effect trên mỗi possibleState → trạng thái kế tiếp (non-deterministic)
  effects: (s: WorldState) => WorldState[];
  // observation: chạy action → thu hẹp belief
  observe?: (s: WorldState) => Observation;
}

class ConformantPlanner {
  plan(goal: Goal, belief: BeliefState, actions: Action[]): Action[] | null {
    // BFS: tìm chuỗi action đạt goal từ MỌI state trong belief
    const queue: { belief: BeliefState; path: Action[] }[] = [{ belief, path: [] }];
    while (queue.length) {
      const { belief: b, path } = queue.shift()!;
      if (b.possibleStates.every(s => goal.satisfied(s))) return path; // all covered!
      if (path.length > this.maxDepth) continue;
      for (const action of actions) {
        const next = this.apply(b, action);       // expand belief
        queue.push({ belief: next, path: [...path, action] });
      }
    }
    return null; // no conformant plan found within depth
  }

  private apply(belief: BeliefState, action: Action): BeliefState {
    // apply action to every possible state → union of outcomes = new belief
    const next: WorldState[] = [];
    for (const s of belief.possibleStates) next.push(...action.effects(s));
    return { possibleStates: dedup(next) };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan robust — work bất kể uncertainty (Smith & Weld) | ❌ Plan dài hơn (cover mọi case) |
| ✅ Không cần re-plan liên tục (proactive) | ❌ Belief explosion (tập state phình to) |
| ✅ An toàn cho task rủi ro (deploy, migrate) | ❌ Depth limit (NP-hard — capping needed) |
| ✅ Nối 238 uncertainty + 239 world-model | ❌ LLM phải "hiểu" belief — prompt phức tạp |

## Khác các hướng gần

| | 185 Lookahead Tree | 119 Bounded Self-Correct | IC: Conformant Planning |
|---|---|---|---|
| Quan sát | Đầy đủ (đã biết state) | Sau khi fail | **Không đầy đủ (belief)** |
| Khi fail | Re-search | Sửa sau | **Phòng trước (robust)** |
| Uncertainty | ❌ | ❌ | ✅ multiple outcomes |

## Khi nào chọn

- Môi trường không đầy đủ quan sát (không biết chính xác state)
- Task rủi ro — cần plan đảm bảo thành công (deploy, migrate, delete)
- Action có nhiều outcome không xác định (non-deterministic tools)
- OK với plan dài hơn đổi lấy robustness
