# Hướng ABF: Incremental Parallel Parsing — pipeline discovery → parallel parse (rayon + oxc, cache-aware) → graph → dead code

> **Nguồn gốc:** fallow (CLAUDE.md) | **Coupling:** 🟡 — thêm incremental parallel parse vào codegraph build | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codegraph + native parse — chưa có parallel cache-aware pipeline) | **Effort:** 2-3 tuần

## Nguồn gốc

**fallow** parse codebase theo **pipeline**: `config → discovery → incremental parallel parsing → module resolution → graph construction → dead code detection`. Điểm mấu chốt: **incremental + parallel** — dùng **rayon** (thread pool) + **oxc_parser + oxc_semantic** (parser nhanh, semantic analysis) + **cache-aware** (file không đổi thì không re-parse). Kết quả: **sub-second** trên repo lớn. Nguyên tắc: **pipeline có thứ tự, parse song song, cache-aware, dead code là bước cuối (cần graph hoàn chỉnh)**.

## Mô tả

mya incremental parallel parsing: (1) **config** — root, include/exclude, parser options; (2) **discovery** — walk tìm file set; (3) **incremental parallel parse** — chia file cho worker (thread pool), mỗi file check cache fingerprint trước (đổi mới parse), parse bằng native (tree-sitter / oxc) sinh symbol + semantic; (4) **module resolution** — nối import → file; (5) **graph construction** — node/edge; (6) **dead code detection** — node không có edge tới entry → dead. mya có packages/tools codegraph.ts + symbol-extractor.ts + packages/natives nativeParseTsSymbols — ABF thêm **parallel worker pool** + **cache-aware parse** + **pipeline stages tách bạch**.

## Kiến trúc

```
  CONFIG → DISCOVERY (file set, 10.000 files)
     │
     ▼
  INCREMENTAL PARALLEL PARSE (worker pool, cache-aware)
     ├─ worker 1: a.ts (cache hit  → skip)
     ├─ worker 2: b.ts (cache miss → parse oxc + semantic)
     └─ ... (rayon-style, N thread)
     │
     ▼
  MODULE RESOLUTION (import → file) → GRAPH (node + edge)
     │
     ▼
  DEAD CODE DETECTION (node không reachable từ entry)
     ▼
  SUB-SECOND trên repo lớn
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codegraph.ts — buildCodegraph + Codegraph edges (nền — ABF graph stage)
// ✅ packages/tools symbol-extractor.ts — extractSymbols (nền — ABF parse stage)

// ❌ THIẾU: parallel worker pool (parse song song nhiều file)
// ❌ THIẾU: pipeline stages tách bạch (config/discovery/parse/resolve/graph/dead)
// ❌ THIẾU: dead code detection stage (graph → unreachable nodes)
```

## Implementation

```typescript
// packages/tools/src/incremental-parallel-parse.ts (MỚI)
import { Worker } from "node:worker_threads";

export interface ParseJob { path: string; content: string }
export interface ParseResult { path: string; symbols: string[]; imports: string[] }

/** Worker pool: chia file set cho N worker, parse song song. */
export async function parallelParse(jobs: ParseJob[], workerCount = 4): Promise<ParseResult[]> {
  const results: ParseResult[] = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(workerCount, jobs.length) }, () =>
    new Worker(new URL("./parse-worker.js", import.meta.url), { type: "module" }),
  );
  await Promise.all(workers.map((w) => new Promise<void>((resolve, reject) => {
    w.on("message", (r: { idx: number; result: ParseResult }) => {
      results[r.idx] = r.result;
      if (next < jobs.length) w.postMessage({ idx: next, job: jobs[next++]! });
      else { void w.terminate(); resolve(); }
    });
    w.on("error", reject);
    w.postMessage({ idx: next, job: jobs[next++]! });
  })));
  return results.filter(Boolean);
}

/** Pipeline: config → discovery → parallel parse → resolve → graph → dead code. */
export async function incrementalParsePipeline(
  files: string[], readOne: (f: string) => Promise<string>,
  cache: Map<string, string>, // path → content hash (cache-aware)
): Promise<{ nodes: string[]; edges: Map<string, string[]>; dead: string[] }> {
  const changed = files.filter(f => cache.get(f) !== hash(f));
  const parsed = await parallelParse(
    await Promise.all(changed.map(async f => ({ path: f, content: await readOne(f) }))),
  );
  const edges = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const r of parsed) {
    nodes.add(r.path);
    edges.set(r.path, r.imports);
    for (const imp of r.imports) nodes.add(imp);
  }
  const reachable = new Set<string>();
  const visit = (p: string): void => {
    if (reachable.has(p)) return;
    reachable.add(p);
    for (const e of edges.get(p) ?? []) visit(e);
  };
  for (const entry of files.filter(f => f.includes("index") || f.includes("main"))) visit(entry);
  return { nodes: [...nodes], edges, dead: [...nodes].filter(n => !reachable.has(n)) };
}

function hash(f: string): string {
  let h = 0;
  for (let i = 0; i < f.length; i++) h = (h * 31 + f.charCodeAt(i)) | 0;
  return String(h);
}
// Usage:
// const { dead } = await incrementalParsePipeline(files, readFile, fpCache);
// → parse chỉ file đổi (cache-aware), song song, dead = unreachable
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhanh repo lớn (song song + cache → sub-second) | ❌ Worker overhead (spawn thread pool — chi phí khởi động) |
| ✅ Cache-aware (file không đổi → không re-parse) | ❌ Cache invalidation (hash lệch → re-parse thừa) |
| ✅ Dead code detect (graph đầy đủ → unreachable rõ) | ❌ Module resolution phức tạp (alias, node_modules, dynamic import) |
| ✅ Pipeline tách bạch (mỗi stage test được riêng) | ❌ Memory (giữ toàn bộ AST/symbol trong lúc parse) |

## Khác các hướng gần

| | Sequential parse | Full rebuild mỗi lần | ABF: Incremental Parallel |
|---|---|---|---|
| Tốc độ | chậm | chậm | **nhanh (parallel + cache)** |
| Re-parse | mọi file | mọi file | **chỉ file đổi** |
| Dead code | cần graph riêng | có | **có (stage cuối)** |
| Resource | thấp | cao | **cao nhưng kiểm soát (worker pool)** |

## Khi nào chọn

- Repo lớn (hàng nghìn file) → cần parse nhanh, không chờ rebuild toàn bộ
- Cần dead code detection (graph đầy đủ trước khi kết luận)
- Nối packages/tools codegraph.ts + symbol-extractor.ts + packages/natives + 639 XO (fingerprint cache); guard worker-bound (giới hạn worker theo CPU), cache-hash-stability (deterministic hash), và resolve-completeness (module resolution hiểu alias/extension trước build graph); ABF = incremental parallel parsing, kết hợp 639 XO incremental-fingerprint-analysis (cache fingerprint) + 641 XQ diff-ripple-analysis (diff → ripple)
