# Hướng XQ: Diff Ripple Analysis — diff-analyzer.ts map changed files → graph nodes → 1-hop neighbors + impacted edges + affected layers

> **Nguồn gốc:** Understand-Anything (`diff-analyzer.ts`) | **Coupling:** 🟢 — thêm diff→graph ripple mapper, dùng graph có sẵn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codegraph + reference-graph — chưa có diff→ripple mapper) | **Effort:** 1-2 tuần

## Nguồn gốc

**Understand-Anything** có `diff-analyzer.ts` trả lời câu hỏi "đổi file X thì ảnh hưởng gì?". Cơ chế: lấy **changed files** (git diff) → map mỗi file thành **graph node** → duyệt **1-hop neighbors** (ai import X, X import ai) → thu **impacted edges** (edge liên quan tới changed node) + **affected layers** (layer kiến trúc bị dính). Kết quả: **ripple set** — tập node/edge/layer bị ảnh hưởng bởi diff, giúp agent focus test/review đúng chỗ, không quét toàn repo. Nguyên tắc: **diff → graph traversal → ripple** — ảnh hưởng lan theo dependency, không theo đoán.

## Mô tả

mya diff ripple analysis: input changed files (git diff) → map lên codegraph node → BFS 1-hop (neighbors qua edge import/imported-by) → output `{ changed, neighbors, impactedEdges, affectedLayers }`. Agent dùng ripple set để: chọn test chạy (chỉ test neighbor), review scope (chỉ review impacted edge), đánh giá layer blast radius. mya có packages/tools codegraph.ts (related, edges, reverse) + reference-graph.ts — XQ thêm **diff→ripple mapper** dùng graph có sẵn.

## Kiến trúc

```
  CHANGED FILES (git diff): [src/a.ts, src/b.ts]
        │
        ▼
  ┌─── MAP → GRAPH NODES ──────────────────────────────────┐
  │  src/a.ts → node "src/a.ts"                             │
  │  src/b.ts → node "src/b.ts"                             │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── 1-HOP NEIGHBORS (BFS depth 1) ──────────────────────┐
  │  related(graph, "src/a.ts"):                             │
  │    imports: [src/c.ts, src/d.ts]       ← a phụ thuộc     │
  │    imported-by: [src/e.ts, src/f.ts]   ← phụ thuộc a     │
  │  → neighbor set = {c,d,e,f}                              │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── IMPACTED EDGES + AFFECTED LAYERS ───────────────────┐
  │  impacted edges: (a→c), (a→d), (e→a), (f→a)              │
  │  affected layers: [controller, service]  ← từ path map   │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  RIPPLE = { changed: [a,b], neighbors: [c,d,e,f], edges: [...], layers: [ctrl,svc] }
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codegraph.ts — related() (imports + imported-by, nền — XQ 1-hop)
// ✅ packages/tools codegraph.ts — Codegraph { edges, reverse } (nền — XQ traverse)
// ✅ packages/tools reference-graph.ts — symbol reference graph (nền — XQ edge nguồn)
// ✅ packages/tools lsp-cascade.ts — LSP cascade (nền — XQ layer impact analog)

// ❌ THIẾU: diff → changed node mapper (git diff → graph node)
// ❌ THIẾU: 1-hop ripple BFS (changed → neighbors via related)
// ❌ THIẾU: affected-layers classifier (path → architectural layer)
```

## Implementation

```typescript
// packages/tools/src/diff-ripple.ts (MỚI)
import { related, type Codegraph } from "./codegraph.js";

interface RippleResult {
  changed: string[];
  neighbors: string[];
  impactedEdges: { from: string; to: string }[];
  affectedLayers: string[];
}

function classifyLayer(path: string): string {
  if (/\/controller?s?\//.test(path)) return "controller";
  if (/\/service?s?\//.test(path)) return "service";
  if (/\/model?s?\//.test(path)) return "model";
  if (/\/test|\.test\./.test(path)) return "test";
  return "other";
}

function ripple(graph: Codegraph, changed: string[], depth = 1): RippleResult {
  const neighbors = new Set<string>();
  const impactedEdges: { from: string; to: string }[] = [];
  const changedSet = new Set(changed);

  for (const node of changed) {
    const rels = related(graph, node); // 1-hop: imports + imported-by
    for (const r of rels) {
      neighbors.add(r.path);
      impactedEdges.push(
        r.relation === "imports" ? { from: node, to: r.path } : { from: r.path, to: node },
      );
    }
  }

  const affectedLayers = new Set<string>();
  for (const n of [...changed, ...neighbors]) affectedLayers.add(classifyLayer(n));

  return {
    changed,
    neighbors: [...neighbors].filter((n) => !changedSet.has(n)),
    impactedEdges,
    affectedLayers: [...affectedLayers],
  };
}

// Usage:
// const changed = await gitDiffNames();  // [src/a.ts, src/b.ts]
// const r = ripple(graph, changed);
// → test chỉ r.neighbors, review r.impactedEdges, blast radius = r.affectedLayers
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Focus (chỉ test/review ripple set, không toàn repo) | ❌ 1-hop limit (ảnh hưởng >1 hop bị miss) |
| ✅ Blast radius (affected layers — biết phạm vi) | ❌ Graph staleness (graph cũ → neighbor lệch) |
| ✅ Edge-aware (impacted edges cụ thể, không chỉ node) | ❌ Layer heuristic (classifyLayer đoán theo path) |
| ✅ Cheap (graph có sẵn, chỉ BFS 1-hop) | ❌ Dynamic dispatch miss (reflection/runtime import không có edge) |

## Khác các hướng gần

| | Run all tests | XQ: Diff Ripple | LSP find-refs |
|---|---|---|---|
| Scope | toàn repo | **1-hop ripple set** | per-cursor refs |
| Cost | cao | **thấp (graph có sẵn)** | trung (query LSP) |
| Layer insight | ❌ | **✅ affected layers** | ❌ |

## Khi nào chọn

- Đổi vài file → cần biết ảnh hưởng lan đâu (test/review scope)
- Muốn blast radius (layer kiến trúc bị dính)
- Có graph import sẵn (codegraph) — ripple cheap
- Nối packages/tools codegraph.ts (related) + reference-graph.ts + lsp-cascade.ts; guard graph-freshness (ripple đúng khi graph mới build — kết hợp XO incremental), dynamic-import-gap (reflection không có edge → ripple miss), và depth-tuning (1-hop default, tăng depth khi cần); XQ = diff ripple analysis, kết hợp 639 XO incremental-fingerprint-analysis (diff stale → input ripple) + 642 XR topology-driven-tours (tour follow ripple path)
