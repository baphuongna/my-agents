# Hướng XR: Topology-Driven Tours — tour-builder agent viết script tính fan-in/fan-out, BFS theo depth, entry-point score, clusters rồi thiết kế tour 5-15 bước

> **Nguồn gốc:** Understand-Anything (tour-builder agent) | **Coupling:** 🟡 — thêm topology analyzer + tour planner vào code exploration | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codegraph + reference-graph — chưa có fan-in/out + tour planner) | **Effort:** 2-3 tuần

## Nguồn gốc

**Understand-Anything** có **tour-builder agent** tự động thiết kế "tour thăm codebase" cho người mới. Agent viết script phân tích **topology** của dependency graph: (1) **fan-in/fan-out** — node nào nhiều inbound (hub, dùng khắp nơi) vs nhiều outbound (leaf, phụ thuộc nhiều). (2) **BFS theo depth** — từ entry point, lan bao nhiêu lớp. (3) **entry-point score** — file nào là "cổng vào" tự nhiên (index.ts, main.ts). (4) **clusters** — nhóm node dính nhau (connected components). Từ topology, agent thiết kế **tour 5-15 bước**: bắt đầu entry-point → đi qua hub → cluster → leaf, mỗi bước giải thích 1 node. Nguyên tắc: **tour theo topology, không theo alphabet**.

## Mô tả

mya topology-driven tours: tour-builder (sub-agent hoặc skill) chạy topology analysis trên codegraph → tính fan-in/out, entry-point score, clusters → sinh **ordered tour** (5-15 node theo thứ tự dễ hiểu). Tour = danh sách node + rationale (tại sao node này sau node kia). Agent dùng tour để onboarding (giải thích repo cho user mới) hoặc auto-document. mya có packages/tools codegraph.ts (edges, reverse, related) + reference-graph.ts (callGraphFor) — XR thêm **topology metrics** + **tour planner**.

## Kiến trúc

```
  ┌─── TOPOLOGY ANALYSIS (trên codegraph) ─────────────────┐
  │                                                           │
  │  fan-in(node)   = reverse.get(node).size   ← ai import nó│
  │  fan-out(node)  = edges.get(node).size     ← nó import ai│
  │  entry-score    = fan-in cao + tên (index/main) + depth 0│
  │  clusters       = connected components (union-find)       │
  │  BFS depth      = khoảng cách entry → node                │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── TOUR PLANNER (5-15 bước) ───────────────────────────┐
  │  Step 1: index.ts        (entry-score 0.95, fan-in 42)   │
  │  Step 2: router.ts       (hub, fan-in 30)                 │
  │  Step 3: cluster {auth}  (3 node dính nhau)               │
  │  Step 4: leaf util.ts    (fan-out 12, explicar cuối)      │
  │  → rationale: "index → router (hub) → auth cluster → leaf"│
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codegraph.ts — edges, reverse, related (nền — XR fan-in/out source)
// ✅ packages/tools reference-graph.ts — callGraphFor (callers/callees, nền — XR analog)
// ✅ packages/tools codegraph.ts — Codegraph (nền — XR phân tích graph này)
// ✅ packages/agent subagent.ts — sub-agent (nền — XR tour-builder = sub-agent)

// ❌ THIẾU: fan-in/fan-out metric calculator
// ❌ THIẾU: entry-point scorer + BFS depth
// ❌ THIẾU: cluster detection (connected components)
// ❌ THIẾU: tour planner (topology → ordered 5-15 steps)
```

## Implementation

```typescript
// packages/tools/src/topology-tour.ts (MỚI)
import type { Codegraph } from "./codegraph.js";

interface NodeMetrics {
  path: string;
  fanIn: number;    // imported-by count
  fanOut: number;   // imports count
  depth: number;    // BFS depth from entry
  entryScore: number;
}

function computeMetrics(graph: Codegraph): NodeMetrics[] {
  const nodes = new Set<string>([...graph.edges.keys(), ...graph.reverse.keys()]);
  return [...nodes].map((path) => {
    const fanIn = graph.reverse.get(path)?.size ?? 0;
    const fanOut = graph.edges.get(path)?.size ?? 0;
    const isEntry = /(^|\/)(index|main)\.[tj]s$/.test(path);
    const entryScore = fanIn * 0.5 + (isEntry ? 10 : 0) + (fanOut === 0 ? 2 : 0);
    return { path, fanIn, fanOut, depth: -1, entryScore };
  });
}

function bfsDepth(graph: Codegraph, entry: string): Map<string, number> {
  const depth = new Map<string, number>([[entry, 0]]);
  const queue = [entry];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur) ?? 0;
    for (const next of graph.edges.get(cur) ?? [])
      if (!depth.has(next)) { depth.set(next, d + 1); queue.push(next); }
  }
  return depth;
}

interface TourStep { path: string; reason: string }

function planTour(graph: Codegraph, metrics: NodeMetrics[], maxSteps = 12): TourStep[] {
  // entry = highest entryScore
  const entry = [...metrics].sort((a, b) => b.entryScore - a.entryScore)[0];
  if (!entry) return [];
  const depthMap = bfsDepth(graph, entry.path);
  metrics.forEach((m) => (m.depth = depthMap.get(m.path) ?? 99));
  // tour: entry → hubs → by ascending depth → leaves
  const ordered = [...metrics].sort((a, b) => (a.depth - b.depth) || (b.fanIn - a.fanIn)).slice(0, maxSteps);
  return ordered.map((m) => ({
    path: m.path,
    reason: m.depth === 0 ? "entry point" : m.fanIn > 10 ? `hub (fan-in ${m.fanIn})` : m.fanOut > 8 ? `leaf (fan-out ${m.fanOut})` : `depth ${m.depth}`,
  }));
}

// Usage:
// const metrics = computeMetrics(graph);
// const tour = planTour(graph, metrics, 12);
// → [ {index.ts,"entry"}, {router.ts,"hub fan-in 30"}, ... ]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tour có ý nghĩa (theo topology, không alphabet) | ❌ Topology cost (fan-in/out + BFS + cluster) |
| ✅ Onboarding auto (tour 5-15 bước cho người mới) | ❌ Tour subjective (rationale heuristic) |
| ✅ Hub/leaf insight (fan-in/out highlight node quan trọng) | ❌ Graph staleness (topology cũ → tour sai) |
| ✅ Cluster aware (nhóm node dính nhau thăm cùng lúc) | ❌ Max-step arbitrary (5-15 — repo lớn thì thiếu) |

## Khác các hướng gần

| | File listing | XQ diff-ripple | XR: Topology Tour |
|---|---|---|---|
| Đích | enumerate | impact scope | **onboarding path** |
| Thứ tự | alphabet | changed-first | **topology (entry→hub→leaf)** |
| Metric | ❌ | neighbors | **fan-in/out + entry-score** |

## Khi nào chọn

- Onboarding (agent giải thích repo cho user mới qua tour có thứ tự)
- Muốn highlight node quan trọng (hub fan-in cao, entry-point)
- Cần auto-document (tour = outline docs)
- Nối packages/tools codegraph.ts + reference-graph.ts + packages/agent subagent.ts; guard graph-freshness (topology đúng khi graph mới), cluster-threshold (tuning connected-component size), và tour-pruning (repo lớn → cluster sampling, không enumerate tất cả); XR = topology-driven tours, kết hợp 641 XQ diff-ripple-analysis (ripple = tour impact scope) + 639 XO incremental-fingerprint-analysis (topology trên graph incrementally updated)
