# Hướng TC: Code Community Detection — Leiden community detection gom cụm code-graph (module/đồng sửa)

> **Nguồn gốc:** graphify `graphify/` (code-graph, `symbol_resolution.py`, `dedup.py`, `ids.py`, `paths.py`); Leiden algorithm (community detection, modularity); "code-graph clustering"; "module boundaries from co-change"; "community = files that change together"; "Leiden modularity optimization" | **Coupling:** 🟡 — thêm community-detection layer lên code-graph (gom cụm module/co-change) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có code-graph + Leiden community detection) | **Effort:** 3-4 tuần

## Nguồn gốc

**Leiden algorithm** (community detection) gom node trong graph thành **community** (cụm kết nối chặt) — tối ưu **modularity**. Áp dụng cho **code-graph** (graphify): node = file/symbol, edge = dependency/co-change (file nào hay sửa cùng nhau). Community detection → phát hiện **module ngầm** (file kết nối chặt = 1 module logic) và **co-change cluster** (file hay commit cùng nhau = nên để gần nhau). Nguyên tắc: **cấu trúc module không chỉ từ thư mục** — từ **dependency + co-change graph** thực tế; Leiden tối ưu modularity → cụm chặt. Khác **MJ AST-Code-Knowledge-Graph** (graph symbol) — TC là **community detection trên graph đó**; khác dir-based module — TC **emergent từ graph**.

## Mô tả

mya code community detection: (1) **Code-graph**: build graph (node = file/symbol, edge = import/dependency + co-change từ git log). (2) **Leiden**: chạy Leiden community detection → gom thành community (cụm modularity cao). (3) **Label**: mỗi community = module ngầm (gợi ý tên từ symbol phổ biến) / co-change cluster. (4) **Surface**: agent thấy "file X thuộc module Y (cùng community với A, B, C)" → hiểu cấu trúc, refactor boundary. mya có code search — TC thêm **code-graph builder** + **Leiden community detection** + **module labeler**.

## Kiến trúc

```
  CODE-GRAPH (node=file/symbol, edge=import + co-change):
  parser.rs ── imports ── token.rs
     │                      │
  co-change            co-change
     │                      │
  parser.test.rs ─────── ast.rs
        │
        ▼
  ┌─── LEIDEN COMMUNITY DETECTION ───────────────────────┐
  │  tối ưu modularity → gom cụm kết nối chặt              │
  └───────────────────────┬─────────────────────────────┘
                          │ (communities)
                          ▼
  ┌─── MODULE / CO-CHANGE CLUSTER ───────────────────────┐
  │  Community 1 "parser-core": parser.rs, token.rs,       │
  │    ast.rs, parser.test.rs  (import + co-change chặt)   │
  │  Community 2 "transport": rpc.rs, gateway.rs, …        │
  │  → module ngầm (không chỉ từ thư mục)                  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools find/search — code search (nền — TC build graph từ đây)
// ✅ MJ AST-Code-Knowledge-Graph — symbol graph (nền — TC detect community)
// ✅ bash git log — co-change data (nền — TC co-change edge)

// ❌ THIẾU: code-graph builder (file/symbol + import/co-change edge)
// ❌ THIẾU: Leiden community detection (modularity optimization)
// ❌ THIẾU: module labeler (community → tên gợi ý)
// ❌ THIẾU: boundary surface (agent thấy module ngầm)
```

## Implementation

```typescript
// packages/agent/src/code-community.ts (MỚI)
interface GraphEdge { from: string; to: string; weight: number; kind: 'import' | 'cochange' }

class CodeCommunityDetection {
  constructor(
    private buildGraph: () => Promise<{ nodes: string[]; edges: GraphEdge[] }>,
    private leiden: (nodes: string[], edges: GraphEdge[], resolution: number) => Map<string, number>, // → community id
  ) {}

  // detect communities (module/co-change clusters)
  async detect(): Promise<Map<number, string[]>> {
    const { nodes, edges } = await this.buildGraph();
    const nodeComm = this.leiden(nodes, edges, 1.0); // Leiden modularity
    // invert: community id → members
    const communities = new Map<number, string[]>();
    for (const [node, comm] of nodeComm) {
      const arr = communities.get(comm) ?? [];
      arr.push(node);
      communities.set(comm, arr);
    }
    return communities;
  }

  // label community (gợi ý tên từ symbol phổ biến)
  label(members: string[], extractSymbol: (path: string) => string): string {
    const stems = members.map(extractSymbol); // 'parser' from 'src/parser.rs'
    const freq = new Map<string, number>();
    for (const s of stems) freq.set(s, (freq.get(s) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  }
}

// Usage:
// const comms = await ccd.detect();
// Community 1 "parser": [parser.rs, token.rs, ast.rs, parser.test.rs]
// agent: "file X thuộc module parser (refactor boundary ở đây)"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Module ngầm (từ graph, không chỉ thư mục) | ❌ Leiden non-deterministic (random seed → cụm khác) |
| ✅ Co-change cluster (file sửa cùng → gần nhau) | ❌ Graph build cost (import + git-log parse) |
| ✅ Refactor boundary (community = module) | ❌ Resolution tuning (quá thô/mịn) |
| ✅ Agent hiểu cấu trúc (không lạc file rời) | ❌ Label gợi ý sai (symbol phổ biến không意味 module) |

## Khác các hướng gần

| | MJ AST-Knowledge-Graph | Dir-based module | TC: Community-Detection |
|---|---|---|---|
| Cái gì | Symbol graph | Folder = module | **Leiden cụm từ graph** |
| Module | ❌ | Tĩnh (dir) | **Emergent (modularity)** |
| Co-change | ❌ | ❌ | **✅ (git-log edge)** |

## Khi nào chọn

- Codebase lớn — muốn hiểu module ngầm (không chỉ thư mục)
- Agent refactor — cần biết boundary (community = module)
- Có co-change data (git log) — gom file sửa cùng
- Nối packages/tools find + MJ AST-Code-Knowledge-Graph (graph) + git log (co-change); guard Leiden determinism (fixed seed, resolution cap), graph freshness (rebuild khi code đổi), và label quality (tên gợi ý hợp lý); TC = community detection cho code-graph, kết hợp MJ (graph) + 525 graph-edge-provenance (edge có nguồn)
