# Hướng AAF: MCP Cypher Query Surface — agent chạy Cypher trực tiếp trên graph qua tool query_graph + trace_call_path

> **Nguồn gốc:** codebase-memory-mcp (docs/BENCHMARK.md) | **Coupling:** 🟢 — thêm tool surface lên graph có sẵn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codegraph + graph-store — chưa có Cypher/trace surface) | **Effort:** 2 tuần

## Nguồn gốc

**codebase-memory-mcp** expose **MCP tool `query_graph`**: agent chạy **Cypher** truy vấn trực tiếp trên graph — inheritance (`MATCH (c)-[:INHERITS]->(p)`), params/returns (`MATCH (f)-[:RETURNS]->(t)`). Thêm **`trace_call_path`** với direction **inbound/outbound** để lần vết call chain (ai gọi X, X gọi ai). Nguyên tắc: **graph query là first-class tool surface** — agent không cần code riêng, dùng ngôn ngữ truy vấn graph chuẩn để hỏi quan hệ.

## Mô tả

mya MCP cypher query surface: packages/tools đã có codegraph.ts (`related()`) + reference-graph.ts (`getCallGraph`, `findReferences`). AAF thêm **query surface**: (1) `queryGraph(pattern)` — sub-graph pattern match trên node/edge (mya không kéo Neo4j — dùng **mini-pattern matcher** trên Map adjacency: `{kind:function} → {kind:call}`); (2) `traceCallPath(symbol, direction)` — inbound (`byRef` reverse) / outbound (`getCallGraph`) BFS. Đóng gói thành ToolImpl (`.meta.name` + `.run()`) để agent gọi như tool. Cypher full không cần — pattern DSL nhỏ đủ cho inheritance/call/params/returns.

## Kiến trúc

```
  AGENT
    │
    ▼
  ┌─── TOOL SURFACE (ToolImpl) ────────────────────────┐
  │  queryGraph({ pattern, from })                      │
  │    MATCH (c)-[:INHERITS]->(p) → subgraph match      │
  │    MATCH (f)-[:RETURNS]->(t) → params/returns       │
  │  traceCallPath({ symbol, direction })               │
  │    inbound  → who calls X (byRef reverse)           │
  │    outbound → X calls who (getCallGraph)            │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── GRAPH LAYER (có sẵn) ───────────────────────────┐
  │  codegraph.ts edges/reverse                         │
  │  reference-graph.ts getCallGraph/byRef              │
  │  graph-store.ts byName/byFile indexes               │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codegraph.ts — edges + reverse + related() (nền outbound/inbound)
// ✅ packages/tools reference-graph.ts — getCallGraph/findReferences (nền trace)
// ✅ packages/tools graph-store.ts — byName/byFile/byRef indexes (nền lookup)
// ✅ packages/tools symbol-extractor.ts — Symbol kinds (nền pattern kind match)
// ✅ packages/tools codegraph.test.ts — test graph (nền cho query tests)

// ❌ THIẾU: queryGraph tool (pattern match → subgraph)
// ❌ THIẾU: traceCallPath tool (inbound/outbound BFS)
```

## Implementation

```typescript
// packages/tools/src/graph-query.ts (NEW)
import { ok, err, type ToolImpl } from "./registry.js";
import type { Codegraph } from "./codegraph.js";
import type { GraphStore } from "./graph-store.js";

export interface PathQuery { symbol: string; direction: "inbound" | "outbound"; depth?: number }

/** BFS call path — inbound qua reverse, outbound qua edges. */
export function traceCallPath(graph: Codegraph, store: GraphStore, q: PathQuery): string[] {
  const depth = q.depth ?? 2;
  const adj = q.direction === "inbound" ? graph.reverse : graph.edges;
  const start = store.findDefinitions(q.symbol)[0]?.file ?? q.symbol;
  const seen = new Set<string>([start]);
  const queue: Array<[string, number]> = [[start, 0]];
  while (queue.length) {
    const [cur, d] = queue.shift()!;
    if (d >= depth) continue;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push([next, d + 1]); }
    }
  }
  return [...seen].slice(1); // bỏ node gốc
}

/** queryGraph: pattern match trên adjacency (mini-Cypher — không cần Neo4j). */
export function queryGraph(graph: Codegraph, pattern: string): string[] {
  const [fromKind, toKind] = pattern.split("→").map((s) => s.trim());
  const out: string[] = [];
  for (const [src, targets] of graph.edges) {
    if (!fromKind || src.startsWith(fromKind)) {
      for (const t of targets) if (!toKind || t.startsWith(toKind)) out.push(`${src} → ${t}`);
    }
  }
  return out;
}

export function makeGraphQueryTools(graph: Codegraph, store: GraphStore): ToolImpl[] {
  return [
    {
      meta: { name: "query_graph", description: "Pattern-match subgraph (Cypher-like).", args: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
      run: async ({ pattern }) => ok({ matches: queryGraph(graph, pattern) }),
    },
    {
      meta: { name: "trace_call_path", description: "Trace call chain inbound/outbound.", args: { type: "object", properties: { symbol: { type: "string" }, direction: { enum: ["inbound", "outbound"] } }, required: ["symbol"] } },
      run: async (args) => {
        const p = args as unknown as PathQuery;
        if (p.direction !== "inbound" && p.direction !== "outbound") return err("direction must be inbound|outbound");
        return ok({ path: traceCallPath(graph, store, p) });
      },
    },
  ];
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent tự hỏi graph — không cần tool code mới mỗi lần | ❌ Mini-pattern matcher không full Cypher (JOIN, aggregate) |
| ✅ Inbound/outbound call path — lần vết call chain | ❌ Kind prefix match thô (khi symbol trùng tên) |
| ✅ Dùng graph có sẵn (codegraph + graph-store) | ❌ Depth BFS có thể nổ trên graph lớn — cần cap |
| ✅ Tool surface chuẩn (ToolImpl) | ❌ Pattern syntax cần document + validate |

## Khác các hướng gần

| | related() (codegraph) | AAF: Graph Query Surface |
|---|---|---|
| Query | 1-hop relevance | **Pattern + call path** |
| Direction | Cả hai (imports+importers) | **Inbound/outbound tùy chọn** |
| Ngôn ngữ | API TS | **Tool surface (agent gọi)** |
| Mối quan hệ | Nền | **Expose qua tool** |

## Khi nào chọn

- Agent cần hỏi quan hệ graph (inheritance, call chain) lặp lại nhiều
- Đã có codegraph + reference-graph + graph-store — thêm tool surface
- MVP: pattern DSL nhỏ + BFS; nâng cấp full Cypher khi cần aggregate
- Guard: depth cap (tránh nổ BFS), validate pattern syntax, kind match ổn định
