# Hướng ABX: FS Scan Cache Partitioning — cache scan keyed theo root/include_hidden/use_gitignore/skip_node_modules, glob/fuzzyFind/grep dùng chung, invalidate sau mutation

> **Nguồn gốc:** gajae-code (docs/fs-scan-cache-architecture.md) | **Coupling:** 🟡 — thêm partitioned scan cache vào search/index layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có search-index — chưa có partitioned cache) | **Effort:** 2 tuần

## Nguồn gốc

**gajae-code** viết **FS scan cache bằng Rust** keyed theo **`root / include_hidden / use_gitignore / skip_node_modules`** — **mỗi flag khác nhau là một partition khác** (cache `root=A, hidden=false` ≠ cache `root=A, hidden=true`). Ba consumer **glob, fuzzyFind, grep** dùng **chung cache** (không mỗi cái walk riêng); sau **mutation** (file thay đổi) → **invalidate** để tránh walk lặp. Kết quả: scan cùng root với cùng flags → cache hit (không walk lại), các tool khác nhau chia sẻ 1 kết quả walk. Nguyên tắc: **partition theo flag-set (mỗi flag là key), chung cache cho glob/fuzzy/grep, invalidate sau mutation**.

## Mô tả

mya fs scan cache partitioning: scan cache keyed theo **`root + includeHidden + useGitignore + skipNodeModules`** — mỗi tổ hợp flag là partition riêng; glob/fuzzyFind/grep **dùng chung** cache (1 walk → 3 consumer); mutation (file add/change/delete) → **invalidate partition tương ứng**. mya có packages/tools search-index.ts (index) + find.ts (walk) + builtin.ts (grep) + packages/natives nativeGlob — ABX thêm **partitioned cache** (flag-keyed) + **shared consumers** + **mutation invalidation**.

## Kiến trúc

```
  SCAN CACHE (Rust — keyed theo flag-set)
  ┌──────────────────────────────────────────────────┐
  │  partition key = root|hidden|gitignore|node_modules│
  │  (A, false, true,  true)  → file list A           │
  │  (A, true,  true,  true)  → file list A+hidden    │
  │  (B, false, false, false) → file list B           │
  └──────────────────────┬───────────────────────────┘
                         │  dùng chung (1 walk → nhiều consumer)
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  glob()            fuzzyFind()       grep()
  (cache hit)      (cache hit)       (cache hit)
        │
        ▼
  MUTATION (file thay đổi)
  ──► invalidate partition (A, false, true, true)
  ──► lần sau scan lại walk (không dùng cache cũ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools search-index.ts — SearchIndex + frecency (nền — ABX cache consumer)
// ✅ packages/tools find.ts — find walk (nền — ABX scan source)
// ✅ packages/tools builtin.ts — grep tool (nền — ABX grep consumer)
// ✅ packages/natives nativeGlob — native glob (nền — ABX Rust scan)
// ✅ 739 ABK background-watcher-index — watcher (nền — ABX mutation source)

// ❌ THIẾU: partitioned cache (flag-set → partition riêng)
// ❌ THIẾU: shared consumers (glob/fuzzy/grep dùng chung 1 walk)
// ❌ THIẾU: mutation invalidation (file đổi → invalidate partition)
```

## Implementation

```typescript
// packages/tools/src/scan-cache.ts (MỚI)

export interface ScanFlags { root: string; includeHidden: boolean; useGitignore: boolean; skipNodeModules: boolean }

export type ScanConsumer = "glob" | "fuzzyFind" | "grep";

/** Partition key: mỗi tổ hợp flag là partition khác. */
export function partitionKey(f: ScanFlags): string {
  return `${f.root}|hidden:${f.includeHidden}|gitignore:${f.useGitignore}|node_modules:${f.skipNodeModules}`;
}

/** Partitioned scan cache — glob/fuzzyFind/grep dùng chung, invalidate sau mutation. */
export class ScanCache {
  private cache = new Map<string, { files: string[]; mtimes: Map<string, number> }>();

  /** Scan (có cache) hoặc walk (cache miss) — shared cho mọi consumer. */
  getOrScan(flags: ScanFlags, walk: () => string[]): string[] {
    const key = partitionKey(flags);
    const hit = this.cache.get(key);
    if (hit) return hit.files; // cache hit — không walk lại
    const files = walk();
    this.cache.set(key, { files, mtimes: new Map() });
    return files;
  }

  /** Invalidate sau mutation: file đổi → partition tương ứng bị xóa. */
  invalidate(flags: ScanFlags, changedPath: string): void {
    const key = partitionKey(flags);
    const hit = this.cache.get(key);
    if (!hit) return;
    if (changedPath.startsWith(flags.root) || flags.root === changedPath) {
      this.cache.delete(key); // mutation trong root → walk lại lần sau
    }
  }

  /** Consumer dùng chung: glob/fuzzy/grep gọi getOrScan với cùng flags. */
  filesFor(flags: ScanFlags, walk: () => string[]): string[] {
    return this.getOrScan(flags, walk);
  }
}

// Usage:
// const cache = new ScanCache();
// const flags = { root: "/repo", includeHidden: false, useGitignore: true, skipNodeModules: true };
// const files = cache.filesFor(flags, () => nativeGlob("**/*", flags.root)); // glob
// const fuzzy = cache.filesFor(flags, () => nativeGlob("**/*", flags.root)); // fuzzyFind — CÙNG cache
// const grepSet = cache.filesFor(flags, () => nativeGlob("**/*", flags.root)); // grep — CÙNG cache
// cache.invalidate(flags, "/repo/src/new.ts"); // mutation → walk lại lần sau
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không walk lặp (glob/fuzzy/grep chung 1 cache — 1 walk) | ❌ Cache stale (file đổi ngoài mutation path → cache cũ) |
| ✅ Partition rõ (flag khác → partition khác — không lẫn) | ❌ Memory (nhiều partition × file list lớn → RAM) |
| ✅ Invalidate sau mutation (không dùng dữ liệu cũ) | ❌ Invalidate scope (invalidate cả partition — không granular) |
| ✅ Nhanh (cache hit → không walk, sub-ms) | ❌ Key correctness (flags sai key → lấy nhầm partition) |

## Khác các hướng gần

| | Walk mỗi lần | Cache đơn (1 key) | ABX: Partitioned Cache |
|---|---|---|---|
| glob/fuzzy/grep | 3 walks | chung nhưng lẫn flags | **chung + partition theo flags** |
| Mutation | — | invalidate hết | **invalidate partition đúng** |
| Correctness | luôn đúng | flag lẫn → sai | **mỗi flag 1 partition** |
| Speed | chậm | nhanh | **nhanh + chính xác** |

## Khi nào chọn

- Nhiều tool scan cùng root (glob + fuzzy + grep) — đang walk lặp
- Flag-set khác nhau cần cache riêng (hidden/gitignore/node_modules)
- Có mutation thường xuyên — cần invalidate đúng chỗ
- Nối packages/tools search-index.ts + find.ts + builtin.ts + packages/natives nativeGlob + 739 ABK (watcher = mutation source); guard key-correctness (partition key đủ flag — không thiếu), invalidation-coverage (mọi mutation path phải invalidate — không sót), và memory-bound (partition LRU — không giữ vô hạn); ABX = fs scan cache partitioning, kết hợp 739 ABK background-watcher-index (watcher cung cấp mutation) + 734 ABF incremental-parallel-parsing (scan cache nuôi parser cache-aware)
