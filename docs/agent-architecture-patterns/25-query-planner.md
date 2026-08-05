# Hướng Y: Query Planner — cost-based task decomposition

> **Nguồn gốc:** Database internals — query optimization (Selinger, 1979; Graefe, 1993)
> **Coupling:** 🟡 Planner decides execution strategy
> **Agent-agnostic:** ✅ — bất kỳ agent execute plan
> **Effort:** 2-3 tuần

## Nguồn gốc

Khi viết `SELECT * FROM users JOIN orders ...`, database không execute literally. Query planner generates MULTIPLE execution plans, estimates costs, picks cheapest. Selinger (1979) System R. Graefe (1993) Volcano optimizer.

**Tham chiếu:**
- Selinger, P. G. et al. (1979). "Access Path Selection in a Relational Database Management System." *SIGMOD '79*.
- Graefe, G. (1993). "Volcano — An Extensible and Parallel Query Evaluation System." *IEEE TKDE*, 6(1).

## Mô tả

Task decomposition KHÔNG làm 1 lần rồi execute blind. Query planner generates MULTIPLE execution strategies, estimates costs (token usage, time, failure probability, quality), picks optimal. Nếu execution reveal thông tin tốt hơn → adaptive re-planning (như database runtime re-optimization).

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│              QUERY PLANNER                               │
│                                                          │
│  User: "Refactor auth to use OAuth"                      │
│                                                          │
│  Step 1: PARSE → logical plan                            │
│  ┌────────────────────────────────────────────┐          │
│  │ 1. Understand current auth system           │          │
│  │ 2. Design OAuth integration                 │          │
│  │ 3. Implement OAuth flow                     │          │
│  │ 4. Migrate existing tests                   │          │
│  │ 5. Add new OAuth tests                      │          │
│  │ 6. Update documentation                     │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  Step 2: GENERATE PHYSICAL PLANS                         │
│                                                          │
│  Plan A: "Sequential Deep"                               │
│    1 agent, all steps, 50k tokens, 10min                 │
│    Risk: context overflow. Quality: HIGH                 │
│                                                          │
│  Plan B: "Parallel Fan-out"                              │
│    5 agents, 35k tokens, 4min                            │
│    Risk: merge conflicts. Quality: MEDIUM                │
│                                                          │
│  Plan C: "Subagent Pipeline"                             │
│    1+6 agents, 45k tokens, 6min                          │
│    Risk: coordination overhead. Quality: MEDIUM-HIGH     │
│                                                          │
│  Step 3: COST ESTIMATION                                 │
│  cost(plan) = w1·tokens + w2·time + w3·risk + w4·(1-qual)│
│                                                          │
│  Step 4: SELECT CHEAPEST                                 │
│  → Plan B wins                                           │
│                                                          │
│  Step 5: EXECUTE (adaptive re-planning)                  │
│  Step 3 fail → re-plan từ step 3 với info mới            │
└──────────────────────────────────────────────────────────┘
```

## Plan generation

```typescript
interface ExecutionPlan {
  id: string;
  name: string;
  stages: PlanStage[];
  estimatedCost: {
    tokens: number;
    timeMinutes: number;
    failureProbability: number;
    quality: number;
  };
}

interface PlanStage {
  description: string;
  agentCount: number;
  sequential: boolean;   // must wait for previous stage?
  toolBudget: number;
  dependsOn?: string[];
}

// Generate multiple strategies
function generatePlans(logicalPlan: TaskStep[]): ExecutionPlan[] {
  return [
    { name: "sequential-deep",
      stages: [{ description: "all steps", agentCount: 1, sequential: true }] },
    { name: "parallel-fanout",
      stages: [
        { description: "understand + design", agentCount: 1, sequential: true },
        { description: "implement", agentCount: 1 },
        { description: "tests + docs", agentCount: 2, dependsOn: ["implement"] },
      ]},
    { name: "subagent-pipeline",
      stages: logicalPlan.map(step => ({
        description: step.description, agentCount: 1, sequential: true,
      }))},
  ];
}

// Cost estimation (based on historical stats)
function estimateCost(plan: ExecutionPlan, stats: ExecutionStats): PlanCost {
  return {
    tokens: plan.stages.reduce((sum, s) => sum + stats.avgTokensPerStage(s.description), 0),
    timeMinutes: plan.stages.reduce((sum, s) => sum + stats.avgTimePerStage(s.description), 0),
    failureProbability: plan.stages.reduce((max, s) =>
      Math.max(max, stats.failureRate(s.description)), 0),
    quality: plan.stages.length <= 2 ? 0.9 : (plan.agentCount <= 3 ? 0.7 : 0.6),
  };
}
```

## Adaptive re-planning

```
Initial plan: parallel-fanout (Plan B)
  Stage 1: understand + design → SUCCESS (2 min, better than expected)
  Stage 2: implement → SUCCESS
  Stage 3: tests + docs → FAIL (merge conflicts!)

Adaptive: re-plan from Stage 3
  New plan: "sequential-fix"
    Stage 3a: resolve merge conflicts (1 agent, sequential)
    Stage 3b: run tests (1 agent)
    Stage 3c: write docs (1 agent, parallel with 3b)
  → Execute new plan
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Optimal resource usage (simple → cheap plan) | ❌ Planning overhead (generate + cost multiple plans) |
| ✅ Adaptive (re-plan mid-task) | ❌ Cost model accuracy (estimates can be wrong) |
| ✅ Explicit trade-offs (quality vs speed vs cost) | ❌ Cold start (no historical stats) |
| ✅ Predictable cost (estimate before execution) | ❌ Complexity (planner + estimator + re-optimizer) |
| ✅ Rich statistics (improve over time) | ❌ Non-determinism (same task → different plans) |

## Khi nào chọn

- Tasks có nhiều cách thực hiện (trade-offs đáng kể)
- Want cost optimization (don't waste tokens on simple tasks)
- Need adaptive planning (re-plan khi gặp obstacles)
- Have historical execution stats (improve estimates)
- OK with planner complexity
