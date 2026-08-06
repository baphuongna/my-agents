# Hướng OF: Repository Graph Planning — planning trên đồ thị repo thay vì file-by-file

> **Nguồn gốc:** Papers CodePlan (Microsoft); RPG (Repository Graph); "topological plan on dependency graph"; "change impact analysis"; "call-graph-aware planning"; "ripple effect prediction"
> **Coupling:** 🟡 — thêm graph-building + planning layer trước agent execution
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (file-watcher + symbol search sẵn — chưa có dependency graph builder + topo planning)
> **Effort:** 3-4 tuần

## Nguồn gốc

**CodePlan** (Microsoft): thay vì plan file-by-file (tuần tự, flat), agent plan trên **đồ thị phụ thuộc** của repo — nodes là files/symbols, edges là dependency (import, call, type-ref). Khi sửa 1 node → biết **ripple effect** (những node nào bị ảnh hưởng) → plan theo **topological order** (sửa dependency trước, dependent sau). **RPG (Repository Graph)**: build graph từ AST — import edges, call edges, type edges; plan trên graph đảm bảo **consistency** (không quên file phụ thuộc). **Change impact analysis**: sửa `auth.ts` → graph cho biết `session.ts`, `middleware.ts`, `test/auth.test.ts` đều cần cập nhật. Nguyên tắc: **repo là đồ thị, không phải danh sách file** — plan trên topology đảm bảo đầy đủ + đúng thứ tự. Khác **104 task-decomposition** (chia task) — OF là **dependency-graph-driven planning**.

## Mô tả

mya repository graph planning: trước khi agent sửa code, build **dependency graph** (files/symbols → nodes, import/call/type → edges). (1) **Build graph** từ AST/grep — import edges, call edges, type edges. (2) **Change impact**: khi agent định sửa node X → tìm tất cả node phụ thuộc X (downstream) + X phụ thuộc ai (upstream). (3) **Topological plan**: sắp xếp thay đổi theo topo order — upstream trước, downstream sau. (4) **Execute** theo plan — đảm bảo mỗi thay đổi không phá dependency chưa sửa. mya có `06 file-watcher` + symbol search — OF thêm **graph builder** + **impact analysis** + **topo planner**.

## Kiến trúc

```
  REPO (flat file list — OLD):
  auth.ts, session.ts, middleware.ts, routes.ts, test/auth.test.ts
  → agent sửa file-by-file (có thể quên dependent, sai thứ tự)

  REPO GRAPH (NEW):
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  auth.ts ──import──► session.ts ──import──► routes  │
  │     │                  ▲                            │
  │   call               import                         │
  │     ▼                  │                            │
  │  middleware.ts    test/auth.test.ts                 │
  │                                                     │
  │  edges: import, call, type-ref                      │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── CHANGE IMPACT ANALYSIS ─────────────────────────┐
  │  Agent wants to change: auth.ts                     │
  │                                                     │
  │  downstream (depends on auth.ts):                   │
  │    session.ts, middleware.ts, test/auth.test.ts     │
  │  upstream (auth.ts depends on):                     │
  │    crypto.ts (stdlib)                               │
  │                                                     │
  │  ripple: 4 nodes affected (not just 1)              │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── TOPOLOGICAL PLAN ───────────────────────────────┐
  │  Order (upstream → downstream):                     │
  │    1. auth.ts         (change source)               │
  │    2. session.ts      (depends on auth)             │
  │    3. middleware.ts   (depends on auth)             │
  │    4. routes.ts       (depends on session)          │
  │    5. test/auth.test  (depends on auth)             │
  │                                                     │
  │  Execute in order → no broken dependency            │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 06 file-watcher — track file changes (nền — OF graph source)
// ✅ symbol search (grep/find) — find symbols (nền — OF graph nodes)
// ✅ 104 task-decomposition — divide tasks (nền — OF = graph-aware decomposition)
// ✅ AST/natives — parse source (nền — OF graph extraction)

// ❌ THIẾU: dependency graph builder (import/call/type edges from AST)
// ❌ THIẾU: change impact analysis (downstream/upstream ripple)
// ❌ THIẾU: topological planner (order changes by dependency)
// ❌ THIẾU: graph cache (incremental update on file change)
```

## Implementation

```typescript
// packages/agent/src/repo-graph.ts (MỚI)
interface GraphNode {
  id: string;        // file path or symbol FQN
  type: 'file' | 'function' | 'class' | 'module';
}

interface GraphEdge {
  from: string;      // node id
  to: string;        // node id
  type: 'import' | 'call' | 'type-ref' | 'test';
}

class RepoGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  // adjacency: downstream[nodeId] = nodes that depend on nodeId
  private downstream = new Map<string, Set<string>>();
  private upstream = new Map<string, Set<string>>();

  // Build graph from AST (import/call/type edges)
  buildFromAST(files: { path: string; ast: unknown }[]): void {
    for (const file of files) {
      this.nodes.set(file.path, { id: file.path, type: 'file' });
      const imports = this.extractImports(file.ast);
      const calls = this.extractCalls(file.ast);
      for (const imp of imports) this.addEdge(file.path, imp, 'import');
      for (const call of calls) this.addEdge(file.path, call, 'call');
    }
    this.rebuildAdjacency();
  }

  // Change impact — all nodes affected by changing nodeId
  impact(nodeId: string): { downstream: string[]; upstream: string[] } {
    return {
      downstream: [...(this.downstream.get(nodeId) ?? [])],  // depend on nodeId
      upstream: [...(this.upstream.get(nodeId) ?? [])],       // nodeId depends on
    };
  }

  // Topological plan — order changes (upstream → downstream)
  plan(changes: string[]): string[] {
    // Kahn's algorithm: nodes with no unresolved dependency first
    const visited = new Set<string>();
    const order: string[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      // visit upstream first (dependencies before dependents)
      for (const dep of this.upstream.get(id) ?? []) {
        if (changes.includes(dep)) visit(dep);
      }
      order.push(id);
    };
    changes.forEach(visit);
    return order;
  }

  private addEdge(from: string, to: string, type: GraphEdge['type']): void {
    this.edges.push({ from, to, type });
  }
  private rebuildAdjacency(): void {
    for (const e of this.edges) {
      if (!this.downstream.has(e.from)) this.downstream.set(e.from, new Set());
      this.downstream.get(e.from)!.add(e.to);
      if (!this.upstream.has(e.to)) this.upstream.set(e.to, new Set());
      this.upstream.get(e.to)!.add(e.from);
    }
  }
  private extractImports(ast: unknown): string[] { return []; }
  private extractCalls(ast: unknown): string[] { return []; }
}

// Usage:
// graph.buildFromAST(parseRepo());
// const impact = graph.impact('src/auth.ts');    // → { downstream: [...], upstream: [...] }
// const plan = graph.plan(['src/auth.ts', 'src/session.ts', 'test/auth.test.ts']);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ripple effect đầy đủ (không quên dependent) | ❌ Graph build cost (parse toàn repo — chậm khi lớn) |
| ✅ Topological order (sửa dependency trước — không phá) | ❌ Graph staleness (file đổi → graph phải rebuild) |
| ✅ Change impact prediction (biết trước scope thay đổi) | ❌ Dynamic deps (runtime import, reflection → graph miss) |
| ✅ Nối 104 task-decomposition (graph-aware) | ❌ Cross-language graph (TS + Rust → parser khác nhau) |

## Khác các hướng gần

| | 104 Task-Decomposition | 06 File-Watcher | 114 Spec-Driven | OF: Repo-Graph-Planning |
|---|---|---|---|---|
| Cái gì | Chia task | Track changes | Spec → code | **Plan trên dependency graph** |
| Graph | ❌ | ❌ | ❌ | ✅ import/call/type edges |
| Topology | ❌ | ❌ | ❌ | ✅ topo order |
| Ripple | ❌ | ❌ | ❌ | ✅ impact analysis |

## Khi nào chọn

- Repo lớn (nhiều file phụ thuộc lẫn nhau — không thể sửa file-by-file)
- Thay đổi có ripple rộng (sửa core → nhiều dependent cần cập nhật)
- Cần đúng thứ tự (dependency trước — tránh broken build)
- Nối 06 file-watcher (graph source) + 104 task-decomposition (graph-aware decomposition) + AST/natives (graph extraction); cache graph + incremental update khi file đổi; guard dynamic deps (runtime import — graph miss)
