# Hướng LC: Plan Merge Agents — gộp kế hoạch của nhiều agent, giữ ràng buộc

> **Nguồn gốc:** "Multi-agent planning" (Brenner); "plan merging" (Kambhampati); distributed constraint optimization (DCOP); Gantt merge / critical path; "Partial Order Planning"; conflict-based search (CBS)
> **Coupling:** 🟡 — chạm planning + subagent coordination
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (104 task-decomp + subagents + planning sẵn — thiếu plan merge + constraint check + critical path)
> **Effort:** 4-5 tuần

## Nguồn gốc

Multi-agent planning: nhiều agent mỗi cái có subplan → cần **merge** thành plan toàn cục. Plan merging (Kambhampati): kết hợp partial plans — preserve **ordering constraints** (A before B), **resource constraints** (không 2 agent dùng cùng resource), **causal links** (output của A là input của B). DCOP: tối ưu phân bổ resource khi agent cạnh tranh. Critical path (Gantt/CPM): merge schedules → tìm đường dài nhất → bottleneck. Conflict-based search (CBS): detect conflict giữa 2 plan (cùng resource cùng lúc) → re-plan. Cốt lõi: **merge không chỉ nối đuôi** — phải check constraint + giải conflict + tối ưu order.

## Mô tả

mya plan merge: khi subagents (8-subagents) mỗi cái trả subplan → **merger** gộp. (1) **collect** subplans (mỗi cái: steps + dependency + resource claim); (2) **detect conflict** — 2 subplan cùng claim resource, hoặc ordering vi phạm (B needs A but A scheduled sau); (3) **resolve** — serialize (A then B), parallelize (nếu không conflict), hoặc re-plan; (4) **critical path** — tìm path dài nhất → estimate total time → bottleneck. Nối 104 task-decomposition (chia → merge), 233 work-stealing (balance), 316 resource-negotiation (claim).

## Kiến trúc

```
  TASK → 104 DECOMPOSE
     │
     ├──→ Agent A subplan: [a1→a2→a3]  resource: DB-write
     ├──→ Agent B subplan: [b1→b2]      resource: DB-write
     └──→ Agent C subplan: [c1→c2→c3]   resource: file-R
                    │
                    ▼
  ┌──────────────────────────────────────────────────────┐
  │  PLAN MERGER                                         │
  │                                                      │
  │  1. COLLECT subplans + dependencies + resources      │
  │  2. CONFLICT DETECT (CBS-style):                     │
  │     A.claim(DB-write) ∩ B.claim(DB-write) → CONFLICT │
  │  3. RESOLVE:                                         │
  │     · serialize: A.run() → B.run() (DB write order)  │
  │     · parallel: C.run() ∥ (A then B) — no conflict   │
  │  4. CRITICAL PATH: max(A2+B2, C3) → bottleneck       │
  └──────────────────┬───────────────────────────────────┘
                     │ merged plan
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  MERGED PLAN (DAG, constraint-satisfied)             │
  │                                                      │
  │     ┌─ A[a1→a2→a3] ──┐                               │
  │     │   (DB-w)       ├──→ join → done                │
  │     └─ B[b1→b2] ─────┘                               │
  │     ┌─ C[c1→c2→c3] ──┘ (parallel — no conflict)      │
  └──────────────────────────────────────────────────────┘
```

```
mya: 104 task-decomp + subagents + planning sẵn — thiếu plan merge + conflict detect + critical path
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 104 task-decomposition — split task (documented)
// ✅ packages/agent (8-subagents) — subagent spawn (sẵn)
// ✅ 233 work-stealing — load balance (documented)
// ✅ planning (agent-loop) — single-agent plan (sẵn)

// ❌ THIẾU: plan merger (collect subplans → merge)
// ❌ THIẾU: conflict detection (resource + ordering — CBS)
// ❌ THIẾU: resolution (serialize / parallel / re-plan)
// ❌ THIẾU: critical path analysis (bottleneck → total time)
```

## Implementation

```typescript
// packages/agent/src/plan-merge.ts (NEW)
interface PlanStep { id: string; agent: string; deps: string[]; resources: string[]; durationMs: number; }
interface SubPlan { agent: string; steps: PlanStep[]; }

export class PlanMerger {
  merge(subplans: SubPlan[]): { plan: PlanStep[]; criticalPathMs: number; conflicts: string[] } {
    const all = subplans.flatMap((s) => s.steps);
    const conflicts: string[] = [];

    // 1. Detect resource conflicts (two concurrent steps claim same resource)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const shared = all[i].resources.filter((r) => all[j].resources.includes(r));
        if (shared.length > 0 && !this.dependent(all[i], all[j])) {
          // serialize: add ordering constraint
          all[j].deps.push(all[i].id);
          conflicts.push(`${all[j].agent} waits for ${all[i].agent} on ${shared.join(",")}`);
        }
      }
    }

    // 2. Topological order (respect deps)
    const ordered = this.topoSort(all);

    // 3. Critical path — longest dependency chain
    const criticalPathMs = this.criticalPath(ordered);

    return { plan: ordered, criticalPathMs, conflicts };
  }

  private dependent(a: PlanStep, b: PlanStep): boolean {
    return a.deps.includes(b.id) || b.deps.includes(a.id);
  }

  private topoSort(steps: PlanStep[]): PlanStep[] {
    const map = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const result: PlanStep[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const d of map.get(id)!.deps) visit(d);
      result.push(map.get(id)!);
    };
    steps.forEach((s) => visit(s.id));
    return result;
  }

  private criticalPath(sorted: PlanStep[]): number {
    const finish = new Map<string, number>();
    for (const s of sorted) {
      const depMax = Math.max(0, ...s.deps.map((d) => finish.get(d) ?? 0));
      finish.set(s.id, depMax + s.durationMs);
    }
    return Math.max(...finish.values());
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Plan toàn cục consistent (Kambhampati) | ❌ Merge complexity (conflict detection O(n²)) |
| ✅ Conflict resolved (CBS — no resource clash) | ❌ Serialization → mất parallelism |
| ✅ Critical path — biết bottleneck (CPM) | ❌ Re-plan cost khi unresolvable conflict |
| ✅ Tối ưu order (parallel khi được) | ❌ Subplan chất lượng ảnh hưởng merge |

## Khác các hướng gần

| | 104 Task-Decomp | 233 Work-Stealing | LC: Plan Merge |
|---|---|---|---|
| Mục | Chia task | Balance worker | **Gộp subplan + giữ constraint** |
| Conflict | ❌ | ❌ | **✅ resource + ordering (CBS)** |
| Tối ưu | ❌ | Load | **Critical path (CPM)** |

## Khi nào chọn

- Multi-agent: mỗi agent có subplan → cần gộp toàn cục
- Resource có giới hạn (DB-write, file-lock) — phải serialize
- Cần estimate total time (critical path)
- Nối 104 decomp + 233 work-stealing + 316 resource-negotiation + 317 cross-agent-txn
