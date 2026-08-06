# Hướng PB: File-Watch Incremental Graph — watch file tree + git diff update deltas, cache theo path

> **Nguồn gốc:** graphify (file-watch + incremental graph update); "watch file tree + git diff for graph deltas"; "incremental graph update on change"; "path-keyed graph cache"; "diff-driven graph maintenance"
> **Coupling:** 🟡 — thêm file-watch + git-diff incremental graph update layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (file-watcher + repo-graph sẵn — chưa có incremental delta update + path cache)
> **Effort:** 3-4 tuần

## Nguồn gốc

**graphify** thay vì rebuild graph toàn repo mỗi lần (chậm), **watch file tree + git diff** → chỉ **update deltas** (node/edge thay đổi). Cache graph theo **path key** — khi file đổi → chỉ re-extract graph cho file đó → merge delta vào graph chính. Nguyên tắc: **graph incremental** — không rebuild N pixel khi chỉ 1 file đổi. Vd `auth.ts` edit → re-parse `auth.ts` → update edges của `auth.ts` (không touch 9999 file khác). Khác **396 OF repo-graph** — PB là **incremental maintenance** (không phải build-from-scratch); khác **06 file-watcher** — PB watch để **update graph** (không phải trigger agent).

## Mô tả

mya file-watch incremental graph: (1) **File-watch** — monitor file tree changes (→ 06). (2) **Git diff** — parse diff để biết file nào đổi. (3) **Delta extract** — re-parse chỉ file đổi → new edges. (4) **Cache by path** — graph node/edge cache keyed by path. (5) **Merge delta** — remove old edges of changed file + insert new. mya có `06 file-watcher` + `396 OF repo-graph` — PB thêm **incremental delta** + **path cache**.

## Kiến trúc

```
  FILE TREE (10k files):
  auth.ts, session.ts, routes.ts, ... (9997 more)
        │
        │  EDIT: auth.ts changed (git diff)
        ▼
  ┌─── FILE-WATCH + GIT DIFF ──────────────────────────┐
  │  watch detects: auth.ts modified                    │
  │  git diff: auth.ts (only this file changed)         │
  └───────────────────────┬─────────────────────────────┘
                          │ changed files: [auth.ts]
                          ▼
  ┌─── DELTA EXTRACT (re-parse only changed) ──────────┐
  │  re-parse auth.ts → new edges:                      │
  │    auth.ts --calls--> validate()     (new)          │
  │    auth.ts --imports--> crypto.ts     (unchanged)   │
  │  (9999 other files NOT re-parsed)                   │
  └───────────────────────┬─────────────────────────────┘
                          │ delta edges
                          ▼
  ┌─── PATH-CACHE + MERGE DELTA ───────────────────────┐
  │  graph cache[path=auth.ts] = old edges              │
  │  → REMOVE old edges of auth.ts                      │
  │  → INSERT new edges of auth.ts                      │
  │  → cache[path=auth.ts] = new edges                  │
  │  (graph updated incrementally, no full rebuild)     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 06 file-watcher — track file changes (nền — PB = graph update on watch)
// ✅ 396 OF repo-graph-planning — graph build (nền — PB = incremental version)
// ✅ 348 MJ AST-KG — AST extraction (nền — PB re-parse via AST)
// ✅ 11 git-as-ipc — git integration (nền — PB git diff source)

// ❌ THIẾU: git-diff delta parser (which files changed)
// ❌ THIẾU: incremental graph update (remove old + insert new edges per file)
// ❌ THIẾU: path-keyed graph cache (file → edges)
```

## Implementation

```typescript
// packages/agent/src/graph/incremental-file-graph.ts (MỚI)
interface GraphEdge {
  from: string; to: string; type: string;
}

class IncrementalFileGraph {
  // path-keyed cache: file → its edges
  private cache = new Map<string, GraphEdge[]>();
  private allEdges: GraphEdge[] = [];

  // On file change: re-parse only that file, merge delta
  onFileChanged(path: string, parse: (p: string) => GraphEdge[]): { removed: number; added: number } {
    const oldEdges = this.cache.get(path) ?? [];
    const newEdges = parse(path);  // re-parse only this file

    // remove old edges belonging to this path
    this.allEdges = this.allEdges.filter(e => !(e.from === path || e.to === path));
    // insert new edges
    this.allEdges.push(...newEdges);
    // update cache
    this.cache.set(path, newEdges);

    return { removed: oldEdges.length, added: newEdges.length };
  }

  // Batch update from git diff (multiple files)
  applyGitDiff(changedFiles: string[], parse: (p: string) => GraphEdge[]): void {
    for (const file of changedFiles) {
      this.onFileChanged(file, parse);
    }
  }

  // Query graph (uses cached edges)
  edgesFrom(path: string): GraphEdge[] {
    return this.allEdges.filter(e => e.from === path);
  }

  edgesTo(path: string): GraphEdge[] {
    return this.allEdges.filter(e => e.to === path);
  }

  // Full rebuild (fallback if cache corrupted)
  rebuild(files: string[], parse: (p: string) => GraphEdge[]): void {
    this.cache.clear();
    this.allEdges = [];
    for (const file of files) this.onFileChanged(file, parse);
  }
}

// Wiring with 06 file-watcher + git diff:
// watcher.on('change', (path) => graph.onFileChanged(path, parseAST));
// const diff = git.diff();  // → changed files via 11 git-as-ipc
// graph.applyGitDiff(diff.changedFiles, parseAST);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Incremental update (chỉ re-parse file đổi) | ❌ Cache staleness (watch miss → graph cũ) |
| ✅ Path cache (lookup nhanh theo file) | ❌ Edge removal correctness (orphan edge nếu miss) |
| ✅ Git diff batch (nhiều file cùng lúc) | ❌ Rename/move detection (path đổi → cache miss) |
| ✅ Nối 06 file-watcher + 396 OF | ❌ Initial build cost (lần đầu full rebuild) |

## Khác các hướng gần

| | 06 File-Watcher | 396 OF Repo-Graph | 348 MJ AST-KG | PB: Incremental-File-Graph |
|---|---|---|---|---|
| Cái gì | Track changes | Build + plan graph | AST extract | **Incremental delta update** |
| Update | Trigger agent | Full build | Static | **On-change delta** |
| Cache | ❌ | ❌ | ❌ | ✅ path-keyed |
| Git diff | ❌ | ❌ | ❌ | ✅ delta source |

## Khi nào chọn

- Repo lớn (rebuild toàn graph chậm)
- File change thường xuyên (cần graph luôn fresh)
- Muốn incremental (chỉ re-parse file đổi)
- Nối 06 file-watcher (change detection) + 396 OF repo-graph-planning (graph base) + 11 git-as-ipc (diff source); guard rename detection + cache invalidation on watch miss
