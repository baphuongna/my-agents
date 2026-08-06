# Hướng XO: Incremental Fingerprint Analysis — Chỉ re-analyze file thay đổi: fingerprint + staleness so sánh để cập nhật graph incrementally — tiết kiệm token trên repo lớn

> **Nguồn gốc:** Understand-Anything (incremental graph update) | **Coupling:** 🟡 — thêm fingerprint cache vào codegraph build | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có codegraph.ts build — chưa có fingerprint cache/incremental) | **Effort:** 2 tuần

## Nguồn gốc

**Understand-Anything** cập nhật code graph **incrementally** thay vì rebuild toàn bộ mỗi lần. Cơ chế: mỗi file có **fingerprint** (hash nội dung + mtime) lưu trong cache. Khi scan lại, so **fingerprint hiện tại vs cache** — nếu khớp → file **stale=false** (không đổi) → giữ node/edge cũ; nếu lệch → **stale=true** → re-analyze file đó, cập nhật node/edge. Chỉ file thay đổi mới re-parse → tiết kiệm token/CPU lớn trên repo hàng chục nghìn file. Nguyên tắc: **cache fingerprint, diff stale, patch graph** — không rebuild from scratch.

## Mô tả

mya incremental fingerprint analysis: build codegraph lần đầu → cache `{ path → fingerprint }`. Lần sau: walk file → compare fingerprint → stale set (file đổi) → re-analyze chỉ stale set → **patch graph** (add/update/remove node + edge). File unchanged → giữ nguyên (zero cost). mya có packages/tools codegraph.ts (buildCodegraph, full rebuild) + graph-store.ts — XO thêm **fingerprint cache** + **staleness diff** + **incremental patch**.

## Kiến trúc

```
  ┌─── FINGERPRINT CACHE (.mya/graph-fp.json) ─────────────┐
  │  { "src/a.ts": { hash: "ab12", mtime: 1700 },            │
  │    "src/b.ts": { hash: "cd34", mtime: 1699 } }           │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── WALK + DIFF STALENESS ──────────────────────────────┐
  │  for each file:                                          │
  │    fp_now = hash(content) + mtime                         │
  │    if fp_now == cache[path] → STALE = false (giữ node)   │
  │    else                    → STALE = true  (re-analyze)  │
  │  deleted file (có cache, không có fs) → REMOVE node      │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── PATCH GRAPH (chỉ stale set) ────────────────────────┐
  │  stale file → re-parse → update node + edges             │
  │  unchanged  → giữ nguyên (zero re-analysis)              │
  │  → graph cập nhật incrementally                          │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codegraph.ts — buildCodegraph (full rebuild, nền — XO patch thay vì rebuild)
// ✅ packages/tools codegraph.ts — Codegraph { edges, reverse } (nền — XO update graph này)
// ✅ packages/tools graph-store.ts — GraphStore/snapshot (nền — XO cache analog)
// ✅ packages/sync — sync/diff (nền — XO staleness diff analog)

// ❌ THIẾU: fingerprint cache ({ path → hash+mtime })
// ❌ THIẾU: staleness diff (compare fp → stale set)
// ❌ THIẾU: incremental graph patch (update chỉ stale node/edge)
```

## Implementation

```typescript
// packages/tools/src/incremental-codegraph.ts (MỚI)
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { Codegraph } from "./codegraph.js";

interface Fingerprint { hash: string; mtime: number }
type FingerprintCache = Map<string, Fingerprint>;

async function fingerprint(path: string): Promise<Fingerprint> {
  const [content, s] = await Promise.all([readFile(path), stat(path)]);
  return { hash: createHash("sha256").update(content).digest("hex").slice(0, 16), mtime: Math.floor(s.mtimeMs) };
}

interface StaleResult { stale: string[]; removed: string[]; unchanged: number }

async function diffStale(files: string[], cache: FingerprintCache): Promise<StaleResult> {
  const stale: string[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const f of files) {
    seen.add(f);
    const fp = await fingerprint(f).catch(() => null);
    if (!fp) continue;
    const cached = cache.get(f);
    if (cached && cached.hash === fp.hash && cached.mtime === fp.mtime) unchanged++;
    else { stale.push(f); cache.set(f, fp); }
  }
  const removed = [...cache.keys()].filter((k) => !seen.has(k));
  for (const r of removed) cache.delete(r);
  return { stale, removed, unchanged };
}

// Patch graph: re-analyze chỉ stale set + xóa removed
async function incrementalBuild(
  graph: Codegraph,
  files: string[],
  cache: FingerprintCache,
  analyzeOne: (f: string) => Promise<{ edges: Map<string, Set<string>> }>,
): Promise<{ reanalyzed: number; removed: number }> {
  const { stale, removed } = await diffStale(files, cache);
  for (const f of stale) {
    const { edges } = await analyzeOne(f);
    for (const [k, v] of edges) graph.edges.set(k, new Set([...(graph.edges.get(k) ?? []), ...v])); // merge
  }
  for (const r of removed) graph.edges.delete(r); // prune node removed
  return { reanalyzed: stale.length, removed: removed.length };
}

// Usage:
// const { reanalyzed, removed } = await incrementalBuild(graph, files, cache, analyzeOne);
// → 10000 file, 50 đổi → reanalyze 50, không phải 10000
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm token/CPU (chỉ re-analyze file đổi) | ❌ Fingerprint cost (hash mỗi file mỗi scan) |
| ✅ Nhanh repo lớn (10000 file, 50 đổi → 50 work) | ❌ Cache invalidation (cache corrupt → stale miss) |
| ✅ Patch graph (giữ context trước, không rebuild) | ❌ Edge cascade (file đổi → edge neighbor lệch) |
| ✅ Detect deletion (file xóa → prune node) | ❌ mtime resolution (mtime không đổi nhưng content đổi — hiếm) |

## Khác các hướng gần

| | Full rebuild | Watch (fs event) | XO: Fingerprint Incremental |
|---|---|---|---|
| Khi re-analyze | mỗi lần | on event | **scan + diff fp** |
| Repo lớn | chậm | ok | **✅ chỉ stale** |
| Deletion detect | rebuild | event | **✅ cache diff** |
| Platform | mọi OS | fs-dependent | **✅ portable** |

## Khi nào chọn

- Repo lớn (hàng nghìn file) → full rebuild đắt
- Muốn cập nhật graph nhanh (chỉ file thay đổi)
- Cần portable (không phụ thuộc fs watch event của OS)
- Nối packages/tools codegraph.ts + graph-store.ts + packages/sync; guard hash-stability (deterministic hash — cùng file → cùng fp), edge-cascade (file đổi → re-analyze neighbor 1-hop), và cache-persistence (lưu fp cache ra disk để survive restart); XO = incremental fingerprint analysis, kết hợp 638 XN intermediate-results-on-disk (cache intermediate theo fingerprint) + 641 XQ diff-ripple-analysis (diff changed → ripple neighbor)
