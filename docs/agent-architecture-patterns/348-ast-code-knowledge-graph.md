# Hướng MJ: AST Code Knowledge Graph — đồ thị tri thức mã nguồn 0-LLM từ tree-sitter, query thay vì grep

> **Nguồn gốc:** graphify (tree-sitter → code graph); codebase-memory-mcp (LSP-backed codebase memory); "code knowledge graph" (codelingo, Sourcegraph); tree-sitter (atom-level AST parsing); "semantic code navigation" vs grep; "structural code search"
> **Coupling:** 🟡 — thêm AST indexer + graph store cạnh code-index
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (code-index.ts semantic embeddings + graph.ts sẵn — chưa có AST node/edge graph)
> **Effort:** 3-4 tuần

## Nguồn gốc

**graphify**: dùng tree-sitter parse AST → node (function, class, variable) + edge (calls, imports, defines) → graph có thể **query** thay vì `grep`. **codebase-memory-mcp**: kết hợp LSP (go-to-definition, find-references) + tree-sitter → agent "biết" cấu trúc code, hỏi "hàm nào gọi `parseRequest`?" → trả graph traversal, không phải text search. **Sourcegraph/codelingo**: structural search — query theo cấu trúc ("tất cả hàm async gọi await mà không có try-catch"). Nguyên tắc: **code là đồ thị** (call graph, import graph) — grep chỉ thấy text, AST graph thấy **cấu trúc + quan hệ**. Khác **code-index.ts** (semantic embedding — tìm theo *ý nghĩa*) — MJ tìm theo **cấu trúc** (cú pháp, call/define/import); khác **tool-orchestration-graph** (graph tool CALL) — MJ graph **code**.

## Mô tả

mya AST code knowledge graph: indexer dùng tree-sitter parse mỗi file → node (function, class, type, variable) + edge (calls, imports, defines, returns). Lưu graph store (nối graph.ts). Agent query cấu trúc: "ai gọi `handleError`?" → graph traversal trả danh sách callers; "tất cả file import `core.time`?" → import edge; "hàm nào > 200 dòng?" → AST node attribute. mya đã có **code-index.ts** (semantic — tìm theo ý nghĩa) + **graph.ts** (knowledge graph) — MJ thêm **AST structural layer**: parse code thành graph, query cấu trúc. mya có tree-sitter trong `source/rtk` — nền tảng parse sẵn.

## Kiến trúc

```
  FILE CHANGE (file-watcher)
        │
        ▼
  ┌─── AST INDEXER (tree-sitter) ──────────────┐
  │                                             │
  │  parse(file) → AST                          │
  │   · node: { function, class, type, var }    │
  │   · edge: { calls, imports, defines, refs } │
  │   · attr: { loc, params, returnType, line } │
  │                                             │
  │  merge vào GRAPH STORE (graph.ts)           │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  ┌─── STRUCTURAL QUERY ────────────────────────┐
  │                                             │
  │  "callers of handleError?" → traverse edge  │
  │  "files importing core.time?" → import edge │
  │  "functions > 200 LOC?" → node attr filter  │
  │  "orphaned exports?" → no-incoming-edge     │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼
  AGENT nhận kết quả cấu trúc (không cần grep toàn repo)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/code-index.ts — semantic code search (embeddings — ý nghĩa)
// ✅ packages/memory/src/graph.ts — knowledge graph (node/edge store)
// ✅ source/rtk — tree-sitter infrastructure (parse nền)
// ✅ 06 file-watcher — re-index on change (trigger)
// ✅ 88 CJ hybrid-graph-vector — graph pattern (CJ là memory graph, MJ là CODE graph)

// ❌ THIẾU: AST parser indexer (tree-sitter → node/edge extraction)
// ❌ THIẾU: code structural graph store (call/import/define edges)
// ❌ THIẾU: structural query API ("callers of X", "imports of Y")
// ❌ THIÉU: incremental re-index (file change → re-parse only changed)
```

## Implementation

```typescript
// packages/memory/src/code-graph.ts (NEW)
import { Parser } from "tree-sitter";

interface CodeNode {
  id: string;            // file:symbol (VD "graph.ts:traverse")
  type: 'function' | 'class' | 'type' | 'variable';
  name: string;
  file: string;
  line: number;
  loc: number;
}

interface CodeEdge {
  from: string; to: string;
  type: 'calls' | 'imports' | 'defines' | 'returns' | 'references';
}

class CodeKnowledgeGraph {
  private nodes = new Map<string, CodeNode>();
  private edges: CodeEdge[] = [];

  // Parse file → extract nodes + edges from AST
  indexFile(path: string, source: string): void {
    const tree = this.parser.parse(source);
    const visitor = new ASTVisitor(path);
    visitor.walk(tree.rootNode);            // collect func/class/import nodes
    for (const n of visitor.nodes) this.nodes.set(n.id, n);
    this.edges = this.edges.filter(e => !e.from.startsWith(path + ':')); // remove old
    this.edges.push(...visitor.edges);      // call/import/define edges
  }

  // Structural query — "who calls X?"
  callers(symbol: string): CodeNode[] {
    return this.edges
      .filter(e => e.to.endsWith(`:${symbol}`) && e.type === 'calls')
      .map(e => this.nodes.get(e.from)!)
      .filter(Boolean);
  }

  importers(modulePath: string): string[] {
    return this.edges.filter(e => e.to === modulePath && e.type === 'imports')
      .map(e => this.nodes.get(e.from)!.file);
  }

  private parser = new Parser();
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Query cấu trúc (callers/imports) không grep (0-LLM) | ❌ Parse overhead (re-index khi file đổi) |
| ✅ Cấu trúc + ý nghĩa (code-index + MJ cùng dùng) | ❌ Tree-sitter grammar per-language |
| ✅ Refactor an toàn ("callers?" trước khi đổi API) | ❌ Graph sync khi file rename/delete |
| ✅ Sourcegraph-style structural search | ❌ Incremental index phức tạp (partial parse) |

## Khác các hướng gần

| | code-index.ts (semantic) | 88 CJ Hybrid Graph | MJ: AST Code Graph |
|---|---|---|---|
| Tìm theo | Ý nghĩa (embedding) | Entity quan hệ (memory) | **Cấu trúc (AST)** |
| 0-LLM | ❌ (embed) | ❌ (extract) | **✅ (tree-sitter parse)** |
| Query | Semantic gần đúng | Entity traversal | **Call/import/define** |

## Khi nào chọn

- Agent cần hiểu cấu trúc code (callers, imports, definition chains)
- Refactor thường (cần biết "ai dùng symbol này?" trước khi đổi)
- Repo lớn — grep chậm/cồng kềnh, structural query chính xác hơn
- Kết hợp code-index.ts (ý nghĩa) + MJ (cấu trúc) — 2 chiều code understanding
