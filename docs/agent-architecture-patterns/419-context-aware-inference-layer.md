# Hướng PC: Context-Aware Inference Layer — prompt đi qua degree/search over entity relations

> **Nguồn gốc:** graphify (context-aware inference layer); "prompt traverses graph via degree + relation search"; "graph-augmented context injection"; "entity-relation traversal for prompt enrichment"; "contextual graph walk"
> **Coupling:** 🟡 — thêm graph-traversal inference layer giữa prompt + KG
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (repo-graph + context-engineering sẵn — chưa có graph-traversal inference layer)
> **Effort:** 3 tuần

## Nguồn gốc

**graphify** có **context-aware inference layer**: prompt đi qua đồ thị — **traverse entity relations** (degree walk + relation search) để enrich context. Vd prompt nhắc "auth module" → layer walk graph: `auth module --imports--> crypto`, `auth module --called-by--> session`, `session --used-in--> routes` → inject neighbors (degree 2-3) vào context. **Degree-bounded**: chỉ walk N bước (tránh toàn graph). **Relation search**: tìm relation type cụ thể ("depends-on"). Nguyên tắc: **context từ đồ thị quan hệ** — không chỉ keyword match. Khác **410 OT pre-tool-inject** — PC traverse **graph relations** (không phải memory); khác **396 OF repo-graph** — PC là **inference traversal** (không phải planning).

## Mô tả

mya context-aware inference layer: (1) **Detect entities** trong prompt. (2) **Graph walk**: traverse entity relations (degree N) — neighbors, transitive relations. (3) **Relation search**: filter theo relation type. (4) **Inject** traversal results vào context prompt. mya có `396 OF repo-graph` + `348 MJ AST-KG` — PC thêm **inference traversal layer**.

## Kiến trúc

```
  PROMPT: "Review auth module và dependencies"
        │
        ▼
  ┌─── ENTITY DETECTION ───────────────────────────────┐
  │  prompt → entities: ["auth module"]                  │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── GRAPH WALK (degree-bounded) ────────────────────┐
  │  start: [auth module]                                │
  │                                                     │
  │  DEGREE 1:                                          │
  │    auth --imports--> crypto                         │
  │    auth --called-by--> session                      │
  │                                                     │
  │  DEGREE 2:                                          │
  │    session --used-in--> routes                      │
  │    crypto --depends--> openssl                      │
  │                                                     │
  │  DEGREE 3: (cap — stop)                             │
  └───────────────────────┬─────────────────────────────┘
                          │ traversal results
                          ▼
  ┌─── CONTEXT INJECTION ──────────────────────────────┐
  │  prompt += `[GRAPH CONTEXT]                         │
  │    auth imports crypto, depends openssl             │
  │    auth called-by session, used-in routes           │
  │  ]                                                   │
  │  → LLM thấy relation graph, không chỉ keyword        │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 396 OF repo-graph-planning — dependency graph (nền — PC traverses this)
// ✅ 348 MJ AST-KG — code KG (nền — PC walk entities)
// ✅ 170 context-engineering — context mgmt (nền — PC inject into context)
// ✅ 410 OT pre-tool-inject — context inject (nền — PC = graph-based version)

// ❌ THIẾU: prompt entity detection (entities in prompt text)
// ❌ THIẕU: degree-bounded graph walk (traverse N steps)
// ❌ THIẕU: relation search (filter by relation type)
// ❌ THIẕU: context injection from traversal results
```

## Implementation

```typescript
// packages/agent/src/graph/context-inference-layer.ts (MỚI)
interface GraphEdge { from: string; to: string; type: string; }

class ContextAwareInference {
  constructor(
    private edges: GraphEdge[],         // KG edges (from 348 MJ / 396 OF)
    private adjacency = new Map<string, GraphEdge[]>(),
  ) {
    // build adjacency for fast walk
    for (const e of edges) {
      if (!this.adjacency.has(e.from)) this.adjacency.set(e.from, []);
      this.adjacency.get(e.from)!.push(e);
    }
  }

  // Detect entities in prompt (simple keyword match against known nodes)
  detectEntities(prompt: string): string[] {
    const nodes = [...this.adjacency.keys()];
    return nodes.filter(n => prompt.includes(n));
  }

  // Degree-bounded walk from start entity
  walk(start: string, maxDegree = 2, relationFilter?: string[]): GraphEdge[] {
    const visited = new Set<string>([start]);
    const results: GraphEdge[] = [];
    let frontier = [start];

    for (let deg = 0; deg < maxDegree; deg++) {
      const next: string[] = [];
      for (const node of frontier) {
        const neighbors = this.adjacency.get(node) ?? [];
        for (const edge of neighbors) {
          if (relationFilter && !relationFilter.includes(edge.type)) continue;
          results.push(edge);
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            next.push(edge.to);
          }
        }
      }
      frontier = next;
    }
    return results;
  }

  // Enrich prompt with graph context
  enrich(prompt: string, maxDegree = 2): string {
    const entities = this.detectEntities(prompt);
    if (entities.length === 0) return prompt;

    const allEdges: GraphEdge[] = [];
    for (const e of entities) allEdges.push(...this.walk(e, maxDegree));

    if (allEdges.length === 0) return prompt;
    const lines = allEdges.map(e => `${e.from} --${e.type}--> ${e.to}`);
    return `${prompt}\n\n[GRAPH CONTEXT]\n${lines.join('\n')}`;
  }
}

// Usage:
// const inf = new ContextAwareInference(kgEdges);
// const enriched = inf.enrich('Review auth module và dependencies', 2);
//   → prompt + [GRAPH CONTEXT] auth--imports-->crypto, auth--called-by-->session, ...
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context từ quan hệ (không chỉ keyword) | ❌ Walk explosion (degree cao → toàn graph) |
| ✅ Relation filter (chỉ relation type cần) | ❌ Entity detection miss (prompt mơ hồ) |
| ✅ Degree-bounded (cap traversal) | ❌ Context phình (nhiều relation → token tăng) |
| ✅ Nối 396 OF (traverse graph) + 348 MJ | ❌ Adjacency build cost (large KG) |

## Khác các hướng gần

| | 396 OF Repo-Graph | 410 OT Pre-Tool-Inject | 170 Context-Engineering | PC: Context-Inference |
|---|---|---|---|---|
| Cái gì | Plan trên graph | Inject before tool | Context mgmt | **Graph-traverse enrich** |
| Walk | ❌ (topo plan) | ❌ | ❌ | ✅ degree-bounded |
| Entity | ❌ | tool target | ❌ | ✅ detect in prompt |
| Inject | ❌ | memory | context build | **graph relations** |

## Khi nào chọn

- Cần context từ quan hệ entity (dependencies, callers)
- Prompt nhắc entity → muốn enrich bằng graph neighbors
- Cần relation filter (chỉ "depends-on" / "calls")
- Nối 396 OF repo-graph-planning (graph source) + 348 MJ AST-KG (entity store) + 170 context-engineering (inject); guard walk explosion (cap degree) + entity detection accuracy
