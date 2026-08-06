# Hướng ZK: Graph Task Dependencies — issue tracker dạng graph DB (Dolt) với quan hệ blocks/relates_to/duplicates/supersedes/discovered-from/parent-child — dependency-aware task graph sống qua compaction
> **Nguồn gốc:** beads (docs/reference-repos/gastownhall/beads/research.md) | **Coupling:** 🟡 — task graph store + dependency relations | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tools graph-store.ts + memory graph.ts — chưa có task-relation graph) | **Effort:** 3 tuần

## Nguồn gốc

**beads** quản lý issue/task bằng **graph DB (Dolt)** — không phải list flat. Task là node, quan hệ là edge với **nhiều kiểu**: **blocks** (A chặn B), **relates_to** (liên quan), **duplicates** (trùng), **supersedes** (thay thế), **discovered-from** (phát hiện từ), **parent-child** (phân rã). Vì là graph nên: biết **task nào đang bị chặn** (blocks), **task nào thừa** (duplicates), **thứ tự đóng** (dependency ordering), và graph **sống qua compaction** (lịch sử quan hệ không mất khi nén context). Nguyên tắc: **task management là graph problem, không phải list problem**.

## Mô tả

mya graph task dependencies: (1) **Task node** — id, status, description. (2) **Relation edges** — blocks/relates_to/duplicates/supersedes/discovered-from/parent-child. (3) **Queries** — blocked-by (task nào chặn tôi), blocking (tôi chặn ai), duplicates-of, children-of. (4) **Dependency ordering** — close task bottom-up theo blocks/parent-child (mya có session-branch classify analog). (5) **Compaction survival** — graph lưu persistent (SQLite/graph-store), không phụ thuộc context. mya có tools/graph-store.ts + memory/graph.ts + sqlite-store — ZK thêm **task-relation schema** + **relation queries** + **dependency ordering**.

## Kiến trúc

```
  TASK GRAPH (Dolt/GraphStore — node + edge nhiều kiểu)
  ┌─────────────────────────────────────────────────────┐
  │  epic-E (parent-child)                                │
  │   └── task-A ──blocks──▶ task-B                       │
  │   └── task-A ──discovered-from──▶ issue-99            │
  │  task-C ──duplicates──▶ task-B                        │
  │  task-D ──relates_to──▶ task-E                        │
  │  task-D ──supersedes──▶ task-old                      │
  └────────────────────┬────────────────────────────────┘
                       ▼ queries
  ┌─── DEPENDENCY-AWARE ──────────────────────────────┐
  │  blocked-by(task-B) = [task-A]                      │
  │  duplicates(task-C)  = task-B → đóng trùng          │
  │  close order: parent-child bottom-up + blocks trước │
  │  graph sống qua compaction (persistent store)       │
  └────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools graph-store.ts — GraphStore + GraphSnapshot (nền — ZK task graph)
// ✅ packages/tools codegraph.ts — Codegraph { edges } (nền — ZK relation edges analog)
// ✅ packages/memory graph.ts — knowledge graph (nền — ZK task graph analog)
// ✅ packages/memory sqlite-store.ts — persistent store (nền — ZK compaction survival)
// ✅ packages/core session-branch.ts — classifyChildSession (relate — ZK parent-child)

// ❌ THIẾU: task-relation schema (blocks/relates_to/duplicates/supersedes/discovered-from)
// ❌ THIẾU: relation queries (blocked-by/blocking/duplicates/children)
// ❌ THIẾU: dependency ordering (close bottom-up theo blocks)
```

## Implementation

```typescript
// packages/tools/src/task-graph.ts (MỚI)

type TaskRelation = "blocks" | "relates_to" | "duplicates" | "supersedes" | "discovered-from" | "parent-child";

interface TaskNode { id: string; status: "open" | "in-progress" | "closed"; description: string }
interface TaskEdge { from: string; to: string; relation: TaskRelation }

class TaskGraph {
  constructor(private store: { load(): { nodes: TaskNode[]; edges: TaskEdge[] }; save(g: { nodes: TaskNode[]; edges: TaskEdge[] }): void }) {}

  private graph() { return this.store.load(); }

  // Relation queries — dependency-aware
  blockedBy(id: string): string[] {
    return this.graph().edges.filter(e => e.to === id && e.relation === "blocks").map(e => e.from);
  }
  blocking(id: string): string[] {
    return this.graph().edges.filter(e => e.from === id && e.relation === "blocks").map(e => e.to);
  }
  duplicatesOf(id: string): string[] {
    return this.graph().edges.filter(e => e.from === id && e.relation === "duplicates").map(e => e.to);
  }
  childrenOf(id: string): string[] {
    return this.graph().edges.filter(e => e.from === id && e.relation === "parent-child").map(e => e.to);
  }

  // Dependency ordering: task chỉ đóng được khi mọi blocker/child đã đóng
  closable(id: string): { ok: boolean; blockers: string[] } {
    const g = this.graph();
    const blockers = [
      ...this.blockedBy(id),
      ...this.childrenOf(id).filter(c => g.nodes.find(n => n.id === c)?.status !== "closed"),
    ];
    return { ok: blockers.length === 0, blockers };
  }

  addEdge(from: string, to: string, relation: TaskRelation): void {
    const g = this.graph();
    g.edges.push({ from, to, relation });
    this.store.save(g);                                    // persistent — sống qua compaction
  }
}
// Usage:
// const tg = new TaskGraph(sqliteGraphStore);
// tg.addEdge("task-A", "task-B", "blocks");
// tg.blockedBy("task-B");       // → ["task-A"]
// tg.closable("task-B");        // → { ok: false, blockers: ["task-A"] }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dependency-aware (biết ai chặn ai, đóng theo thứ tự) | ❌ Graph DB phức tạp hơn list flat |
| ✅ Nhiều quan hệ (dup/supersede/relate → bắt trùng, thay thế) | ❌ Edge sai → ordering sai (task chặn nhầm) |
| ✅ Sống qua compaction (persistent, không mất lịch sử) | ❌ Query nhiều edge → cần index (chậm khi graph lớn) |
| ✅ Epic decompose thành graph (không list) | ❌ Relation semantics phải rõ (blocks vs relates_to) |

## Khác các hướng gần

| | List flat | Kanban (cột) | ZK: Task Graph |
|---|---|---|---|
| Quan hệ | Không | Trạng thái | **6 kiểu edge** |
| Ordering | Thủ công | Cột | **Dependency-driven** |
| Compaction | Mất | Mất | **✅ persistent** |

## Khi nào chọn

- Task phức tạp có dependency chéo (epic → sub-task → blocker)
- Cần bắt duplicates/supersedes (task thừa, task thay thế)
- Muốn task graph sống qua compaction/restart
- Nối packages/tools graph-store.ts + codegraph.ts + memory/graph.ts + sqlite-store.ts + core session-branch.ts; guard edge-correctness (relation đúng kiểu), ordering-determinism (đóng theo dependency, không ngẫu nhiên), và persistence (mọi thay đổi save ngay); ZK = graph task dependencies, kết hợp 692 ZP epic-graph-decomposition (epic → task graph) + 691 ZO dependency-ready-gate (gate trước khi nhận task)
