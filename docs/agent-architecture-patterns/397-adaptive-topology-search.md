# Hướng OG: Adaptive Topology Search — tìm topology multi-agent bằng bandit

> **Nguồn gốc:** Papers BOAD (Bandit-driven Optimization of Agent topologies); SEW; "multi-agent topology optimization"; "multi-armed bandit for structure search"; "explore vs exploit agent graph"; "auto-config multi-agent system"
> **Coupling:** 🟡 — thêm topology-search meta-layer trên multi-agent orchestration
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent + workflows sẵn — chưa có bandit topology optimizer)
> **Effort:** 3-4 tuần

## Nguồn gốc

**BOAD**: thay vì cố định topology multi-agent (ai gọi ai, bao nhiêu agent, song song hay tuần tự), dùng **multi-armed bandit** để **tìm topology tốt nhất**. Mỗi "arm" là một topology config (vd: arm A = 1-coordinator + 3-workers parallel; arm B = pipeline tuần tự 5 steps; arm C = star topology hub-and-spoke). Bandit **explore** (thử topology mới) vs **exploit** (dùng topology đang thắng) — UCB1 / Thompson Sampling. Sau nhiều runs, bandit **hội tụ** về topology tốt nhất cho task type. **SEW**: topology search theo workflow structure. Nguyên tắc: **topology không cố định** — agent tự **tìm cấu trúc tối ưu** qua trial. Khác **105 self-improving-agents** (agent tự sửa prompt) — OG là **structure-level optimization**.

## Mô tả

mya adaptive topology search: có nhiều topology configs (arm) — bandit chọn topology cho mỗi task run dựa trên **historical reward** (success rate, latency, cost, quality). (1) **Explore**: thử topology ít dùng (discovery). (2) **Exploit**: dùng topology có reward cao (optimization). (3) **Update reward**: sau mỗi run, record outcome → update bandit estimate. Sau nhiều runs → hội tụ topology tốt nhất per task type. mya có `08 subagents` + `pi-dynamic-workflows` — OG thêm **bandit topology optimizer** + **reward tracking** + **explore/exploit balance**.

## Kiến trúc

```
  TASK arrives → need multi-agent topology
        │
        ▼
  ┌─── BANDIT TOPOLOGY SELECTOR ───────────────────────┐
  │                                                     │
  │  Arms (topology candidates):                        │
  │    A: coordinator + 3 workers (parallel fan-out)    │
  │    B: pipeline 5 sequential steps                   │
  │    C: star hub-and-spoke (1 hub → N spokes)         │
  │    D: tree (hierarchical delegation)                │
  │                                                     │
  │  UCB1 selection:                                    │
  │    score(arm) = mean_reward(arm)                    │
  │               + C × sqrt(ln(N) / n(arm))            │
  │               └─────────────────────────            │
  │                 exploration bonus (try underused)    │
  │                                                     │
  │    pick arm with highest score                       │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── EXECUTE topology ───────────────────────────────┐
  │  spawn agents per selected topology config          │
  │  → run task                                         │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── REWARD UPDATE ──────────────────────────────────┐
  │  measure outcome:                                   │
  │    reward = w₁·success + w₂·(1/latency)             │
  │            + w₃·(1/cost) + w₄·quality                │
  │                                                     │
  │  update bandit: mean_reward(arm), n(arm) += 1       │
  └─────────────────────────────────────────────────────┘
        │ (next task → bandit knows better)
        ▼
  CONVERGENCE: best topology per task type emerges
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 08 subagents — multi-agent orchestration (nền — OG optimizes topology)
// ✅ pi-dynamic-workflows — workflow definitions (nền — OG topology candidates)
// ✅ 104 task-decomposition — divide tasks (nền)
// ✅ 105 self-improving-agents — self-tune (nền — OG = structure-level)
// ✅ 127 agentic-finops — cost tracking (nền — OG reward signal)

// ❌ THIẾU: bandit topology selector (UCB1 / Thompson Sampling)
// ❌ THIẾU: topology reward tracking (success/latency/cost/quality per arm)
// ❌ THIẾU: explore/exploit balance (exploration bonus)
// ❌ THIẾU: per-task-type convergence (best topology per category)
```

## Implementation

```typescript
// packages/agent/src/topology-search.ts (MỚI)
interface TopologyConfig {
  id: string;
  name: string;
  structure: 'parallel' | 'pipeline' | 'star' | 'tree' | 'coordinator-workers';
  agentCount: number;
}

interface ArmStats {
  topology: TopologyConfig;
  totalReward: number;
  count: number;      // times played
}

class BanditTopologySearch {
  private stats = new Map<string, ArmStats>();
  private totalPlays = 0;
  private readonly C = 1.41; // exploration constant (√2 for UCB1)

  constructor(private topologies: TopologyConfig[]) {
    for (const t of topologies) {
      this.stats.set(t.id, { topology: t, totalReward: 0, count: 0 });
    }
  }

  // UCB1 selection — explore vs exploit
  select(): TopologyConfig {
    // If any arm unplayed → play it first (initial exploration)
    for (const [, s] of this.stats) {
      if (s.count === 0) return s.topology;
    }

    // UCB1: score = mean_reward + C × sqrt(ln(N) / n)
    let best: TopologyConfig | null = null;
    let bestScore = -Infinity;
    for (const [, s] of this.stats) {
      const mean = s.totalReward / s.count;
      const exploration = this.C * Math.sqrt(Math.log(this.totalPlays) / s.count);
      const score = mean + exploration;
      if (score > bestScore) {
        bestScore = score;
        best = s.topology;
      }
    }
    return best!;
  }

  // Update reward after run
  update(topologyId: string, outcome: {
    success: boolean;
    latencyMs: number;
    costUsd: number;
    qualityScore: number; // 0-1
  }): void {
    const weights = { success: 0.4, latency: 0.2, cost: 0.1, quality: 0.3 };
    const reward = weights.success * (outcome.success ? 1 : 0)
      + weights.latency * (1 / Math.max(outcome.latencyMs / 10000, 0.01))
      + weights.cost * (1 / Math.max(outcome.costUsd / 1.0, 0.01))
      + weights.quality * outcome.qualityScore;

    const s = this.stats.get(topologyId)!;
    s.totalReward += reward;
    s.count += 1;
    this.totalPlays += 1;
  }

  // Best topology so far (for exploitation-only mode)
  bestSoFar(): TopologyConfig {
    let best: TopologyConfig | null = null;
    let bestMean = -Infinity;
    for (const [, s] of this.stats) {
      if (s.count === 0) continue;
      const mean = s.totalReward / s.count;
      if (mean > bestMean) { bestMean = mean; best = s.topology; }
    }
    return best!;
  }
}

// Usage:
// const topology = bandit.select();     // pick topology to try
// const result = await runTopology(topology, task);
// bandit.update(topology.id, result);   // reward feedback → learn
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự tìm topology tốt nhất (không cố định) | ❌ Cần nhiều trial để hội tụ (initial exploration) |
| ✅ Explore/exploit balance (UCB1 — discovery + optimization) | ❌ Reward design khó (success/latency/cost/quality weights) |
| ✅ Per-task-type convergence (best topology per category) | ❌ Stale arms (topology tốt trước không còn do code đổi) |
| ✅ Nối 08 subagents (topology execution) | ❌ Topology search overhead (thử topology kém = lãng phí) |

## Khác các hướng gần

| | 105 Self-Improving | 08 Subagents | 104 Task-Decomposition | OG: Adaptive-Topology |
|---|---|---|---|---|
| Cái gì | Tự sửa prompt | Multi-agent orchestrate | Chia task | **Bandit tìm topology** |
| Level | Prompt | Fixed structure | Task | **Structure (topology)** |
| Optimize | Text | ❌ | ❌ | ✅ UCB1 bandit |
| Explore | ❌ | ❌ | ❌ | ✅ explore/exploit |

## Khi nào chọn

- Multi-agent topology không rõ (không biết parallel/pipeline/star tốt hơn)
- Có nhiều task runs (bandit cần trial để hội tụ)
- Có reward signal rõ (success/latency/cost/quality đo được)
- Nối 08 subagents (topology execution) + 105 self-improving (OG = structure-level) + 127 agentic-finops (reward cost signal); tune UCB1 constant C (explore/exploit balance); guard stale arms (topology cũ không còn phù hợp)
