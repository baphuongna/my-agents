# Hướng ZP: Epic Graph Decomposition — epic-level bead → decompose thành task graph có blocks/parent-child, close bottom-up theo dependency ordering — phân rã feature lớn thành graph chứ không list
> **Nguồn gốc:** beads (research.md) | **Coupling:** 🟡 — decomposition flow vào task graph + orchestrator | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (task graph ZK nền — chưa có decompose flow) | **Effort:** 2 tuần

## Nguồn gốc

**beads** không phân rã epic thành **list** task (list phẳng mất dependency, mất thứ tự) mà thành **task graph**: epic (epic-level bead) → **decompose** thành task nodes có **blocks** (task A chặn B) và **parent-child** (sub-task thuộc task cha). Sau đó **close bottom-up theo dependency ordering**: sub-task đóng trước, task cha sau; task bị chặn đóng sau task chặn. Nhờ graph: biết chính xác **bắt đầu từ đâu** (node không bị chặn), **thứ tự đóng** (dependency), và **phần nào làm song song được** (nhánh độc lập). Nguyên tắc: **phân rã feature lớn thành graph, không thành list**.

## Mô tả

mya epic graph decomposition: (1) **Decompose** — epic → task nodes + edges (blocks, parent-child) bằng agent/LLM (hoặc template). (2) **Graph validate** — không vòng lặp dependency, mọi node reachable từ epic. (3) **Ordering** — topological: đóng sub-task trước cha, task bị chặn sau blocker. (4) **Parallelism** — nhánh độc lập (không dependency) → chạy song song (nối ZI deterministic parallel). mya có task graph (ZK) + agent spawn + workflows runner — ZP thêm **decompose flow** + **graph validation** + **topological ordering**.

## Kiến trúc

```
  EPIC-E
  ┌──────────────────────────────────────────────┐
  │  decompose → task graph (không phải list)     │
  │                                               │
  │        E ──parent-child──▶ T1 ──parent──▶ T3  │
  │         │                   │                 │
  │         └──parent──▶ T2 ──blocks──▶ T4        │
  │                        │                      │
  │                        └──blocks──▶ T5        │
  └────────────────────┬─────────────────────────┘
                       ▼
  ┌─── CLOSE BOTTOM-UP (topological) ────────────┐
  │  leaves không bị chặn trước: T3, T5 (song song)│
  │  sau: T1, T4 → cuối cùng: T2, E               │
  │  (T4 chờ T2 — blocks)                         │
  └──────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools graph-store.ts — GraphStore (nền — ZP task graph)
// ✅ packages/tools codegraph.ts — related/buildCodegraph (nền — ZP decompose analog cho code)
// ✅ packages/agent index.ts — createAgent/spawn (nền — ZP decompose bằng agent)
// ✅ packages/workflows runner.ts — ctx.parallel (nền — ZP chạy nhánh song song)
// ✅ packages/core session-branch.ts — branch/delegate (relate — ZP parent-child marker)

// ❌ THIẾU: decompose flow (epic → task graph)
// ❌ THIẾU: graph validation (không cycle, mọi node reachable)
// ❌ THIẾU: topological ordering (close bottom-up theo dependency)
```

## Implementation

```typescript
// packages/tools/src/epic-decompose.ts (MỚI)

type Edge = { from: string; to: string; relation: "blocks" | "parent-child" }
interface TaskNode { id: string; parent: string | null; blockedBy: string[]; status: "open" | "closed" }

class EpicGraphDecomposition {
  // Decompose: epic → task nodes + edges (agent/template sinh)
  async decompose(epicId: string, subTasks: Array<{ id: string; blockedBy: string[] }>): Promise<TaskNode[]> {
    return subTasks.map(t => ({ id: t.id, parent: epicId, blockedBy: t.blockedBy, status: "open" }));
  }

  // Validate: không cycle dependency, mọi node có parent (reachable từ epic)
  validate(nodes: TaskNode[]): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    for (const n of nodes) {
      for (const b of n.blockedBy) {
        if (!nodes.some(x => x.id === b)) problems.push(`${n.id} blockedBy thiếu node ${b}`);
      }
      if (n.blockedBy.includes(n.id)) problems.push(`${n.id} tự chặn chính mình (cycle)`);
    }
    return { ok: problems.length === 0, problems };
  }

  // Topological ordering: close bottom-up — leaves trước, blocked sau cha
  order(nodes: TaskNode[]): TaskNode[] {
    const status = new Map(nodes.map(n => [n.id, n.status]));
    const done = new Set<string>();
    const result: TaskNode[] = [];
    const visit = (n: TaskNode) => {
      if (done.has(n.id)) return;
      // đóng blocker/sub-task trước (bottom-up)
      for (const b of n.blockedBy) {
        const node = nodes.find(x => x.id === b);
        if (node) visit(node);
      }
      done.add(n.id);
      result.push(n);
    };
    for (const n of nodes) visit(n);
    return result;                       // thứ tự đóng: dependency trước
  }
}
// Usage:
// const d = new EpicGraphDecomposition();
// const nodes = await d.decompose("EPIC-1", [
//   { id: "T1", blockedBy: [] }, { id: "T2", blockedBy: ["T1"] }, { id: "T3", blockedBy: [] },
// ]);
// d.validate(nodes);               // ok
// d.order(nodes);                  // → T1/T3 trước (song song được), T2 sau
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết thứ tự đóng chính xác (dependency) | ❌ Decompose bằng LLM có thể thiếu task/edge |
| ✅ Nhánh độc lập chạy song song (tăng tốc) | ❌ Graph lớn → ordering phức tạp hơn list |
| ✅ Không làm lại việc (thứ tự đúng) | ❌ Cycle dependency → phải validate kỹ |
| ✅ Progress rõ (node nào còn mở, chặn gì) | ❌ Decompose tốn 1 lượt LLM (so với list nhanh) |

## Khác các hướng gần

| | Task list | WBS phẳng | ZP: Epic Graph |
|---|---|---|---|
| Dependency | Không | Không | **blocks + parent-child** |
| Thứ tự | Thủ công | Theo số | **Topological** |
| Song song | Không biết | Không | **Nhánh độc lập** |

## Khi nào chọn

- Feature lớn (epic) cần chia nhỏ có dependency rõ
- Muốn agent chạy đúng thứ tự + song song nhánh độc lập
- Muốn progress theo graph (biết chính xác còn gì, chặn gì)
- Nối packages/tools graph-store.ts + codegraph.ts + agent index.ts + workflows runner.ts + core session-branch.ts; guard decompose-completeness (mọi epic con có edge), cycle-detection (validate trước chạy), và ordering-determinism (topological ổn định); ZP = epic graph decomposition, kết hợp 687 ZK graph-task-dependencies (task graph nền) + 691 ZO dependency-ready-gate (chỉ nhận task ready) + 685 ZI deterministic-parallel-map (nhánh song song)
