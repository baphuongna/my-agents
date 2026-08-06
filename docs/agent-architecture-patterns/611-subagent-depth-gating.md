# Hướng WM: Subagent Depth Gating — task tool tính nesting depth qua parentID chain, vượt depth thì reject; task_id truyền để chạy tiếp same child session

> **Nguồn gốc:** opencode `task tool` (subagent nesting depth gating; depth tính qua parentID chain; vượt max-depth → reject; `task_id` truyền để resume same child session); "nesting depth via parentID", "reject when depth exceeded", "task_id resume same child" | **Coupling:** 🟡 — thêm depth-gate + task_id resume vào subagent dispatch | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent pool + lifecycle sẵn — chưa có depth-gating + task_id resume) | **Effort:** 2 tuần

## Nguồn gốc

**opencode** `task tool` cho agent spawn subagent — subagent cũng có thể spawn sub-subagent → **nesting chain**. Nguy cơ: nesting quá sâu → exponential cost (mỗi tầng spawn thêm), infinite recursion (agent spawn chính nó). Giải: (1) **Depth gating**: tính nesting depth qua **parentID chain** (đi lên parent → parent → root → đếm tầng); nếu depth vượt **max-depth** → **reject** (không spawn). (2) **task_id resume**: thay vì spawn mới mỗi lần, truyền `task_id` → **tiếp tục same child session** (resume subagent đã có, không new). Nguyên tắc: **depth limit chống explosion + task_id reuse tránh duplicate**.

## Mô tả

mya subagent depth gating: (1) **parentID chain**: mỗi subagent biết parent → chain `child → parent → grandparent → root`. (2) **Depth calc**: đếm tầng trong chain = nesting depth. (3) **Gate**: depth > maxDepth → reject (error "nesting too deep"). (4) **task_id**: spawn với task_id mới → new child; spawn với task_id cũ → resume same child (continue session). mya có subagent pool + lifecycle — WM thêm **depth-gate** + **parentID chain depth** + **task_id resume**.

## Kiến trúc

```
  NESTING CHAIN (parentID):
  root (depth 0)
   └─ agent-A (depth 1, parentID: root)
       └─ agent-B (depth 2, parentID: A)
           └─ agent-C (depth 3, parentID: B)
               └─ agent-D wants spawn (depth 4?)

  AGENT-D SPAWN REQUEST:
        │
        ▼
  ┌─── DEPTH CALC (parentID chain) ──────────────────────┐
  │  D → parent B → parent A → parent root                │
  │  depth = 4                                            │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── DEPTH GATE ───────────────────────────────────────┐
  │  if (depth > maxDepth=3) → REJECT "nesting too deep"  │
  │  → agent-D không spawn được (chống explosion)         │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── task_id RESUME (thay spawn mới) ──────────────────┐
  │  agent-C muốn tiếp tục agent-B:                       │
  │  spawn(task_id="B-existing") → RESUME same child      │
  │  → không new session, tiếp tục context agent-B        │
  │  (tiết kiệm — không duplicate setup)                  │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — subagent pool (nền — WM depth-gate ở đây)
// ✅ packages/agent subagent.ts — subagent lifecycle (nền — WM parentID + task_id)
// ✅ packages/core session-branch.ts — session branching (nền — WM resume analog)

// ❌ THIẾU: parentID chain depth calc (đi lên chain → đếm tầng)
// ❌ THIẾU: depth-gate (vượt maxDepth → reject)
// ❌ THIẾU: task_id resume (truyền task_id cũ → continue same child)
```

## Implementation

```typescript
// packages/agent/src/subagent-depth-gating.ts (MỚI)
interface SubagentRecord { id: string; parentId: string | null; depth: number }

class SubagentDepthGate {
  private registry = new Map<string, SubagentRecord>();

  register(id: string, parentId: string | null): SubagentRecord {
    const depth = parentId ? (this.registry.get(parentId)?.depth ?? 0) + 1 : 0;
    const rec: SubagentRecord = { id, parentId, depth };
    this.registry.set(id, rec);
    return rec;
  }

  // depth gate: reject if exceeds maxDepth
  canSpawn(parentId: string | null, maxDepth: number): { ok: boolean; depth: number } {
    const depth = parentId ? (this.registry.get(parentId)?.depth ?? 0) + 1 : 0;
    if (depth > maxDepth) return { ok: false, depth }; // reject — nesting too deep
    return { ok: true, depth };
  }

  // task_id resume: if task_id exists → resume same child (no new session)
  resolveTaskId(taskId: string | undefined): { resume: boolean; childId: string } {
    if (taskId && this.registry.has(taskId)) {
      return { resume: true, childId: taskId }; // resume existing child
    }
    return { resume: false, childId: crypto.randomUUID() }; // new child
  }
}

// Usage:
// const gate = new SubagentDepthGate();
// gate.register("A", null);   // depth 0
// gate.register("B", "A");    // depth 1
// gate.register("C", "B");    // depth 2
// const { ok } = gate.canSpawn("C", 3); // depth 3 ≤ 3 → ok
// const { ok: ok2 } = gate.canSpawn("C", 2); // depth 3 > 2 → REJECT
// const { resume } = gate.resolveTaskId("B"); // → resume: true (continue B)
```

## Được

- ✅ Chống nesting explosion (depth limit → không infinite recursion)
- ✅ Cost control (depth gate → không exponential spawn)
- ✅ Resume efficiency (task_id → continue, không duplicate setup)
- ✅ Chain traceability (parentID → biết lineage, debug dễ)

## Mất

- ❌ Depth limit rigidity (maxDepth cứng → task hợp lệ bị reject nếu cần sâu)
- ❌ Resume state staleness (task_id cũ → child context cũ, có thể stale)
- ❌ Chain lookup cost (deep chain → nhiều parentID lookup)
- ❌ Orphan handling (parent die → child orphan, depth chain break)

## Khác

Khác **542 TV subagent-turn-budget-recovery** (budget per subagent) — WM **depth across subagents** (nesting tầng, không turn). Khác **flat spawn** (không limit depth) — WM **gated depth** (reject khi quá sâu). Khác **new-each-time spawn** (luôn new child) — WM **task_id resume** (continue existing).

## Khi nào chọn

- Subagent có thể spawn sub-subagent → risk nesting explosion
- Muốn cost control (depth limit → không exponential)
- Cần resume (task_id → continue same child, không duplicate)
- Nối packages/agent pool.ts + subagent.ts + packages/core session-branch.ts; guard depth-tuning (maxDepth hợp lý — không quá nông/th sâu), resume-validation (task_id cũ còn valid không — stale check), và orphan-cleanup (parent die → child cleanup); WM = subagent depth gating, kết hợp 542 TV subagent-turn-budget-recovery (budget) + 612 WN background-subagent-registry (registry)
