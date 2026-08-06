# Hướng ABK: Background Watcher Index — thread nền + filesystem watcher cập nhật index real-time, picker thấy file mới không cần rescan

> **Nguồn gốc:** fff (CLAUDE.md) | **Coupling:** 🟡 — thêm watcher thread + invalidation vào search index | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có search-index + frecency — chưa có watcher real-time) | **Effort:** 2 tuần

## Nguồn gốc

**fff** chạy một **thread nền** với **filesystem watcher** cập nhật index file **trong real time** — file mới tạo, sửa, xóa được index cập nhật ngay khi sự kiện FS xảy ra (fff có `background_watcher.rs` + `watch.rs` trong crates/fff-core). Hệ quả: **picker luôn thấy file mới mà không cần rescan thủ công** — user/agent gõ tên file vừa tạo, picker trả kết quả ngay (index đã cập nhật sau sự kiện watch). Không phải chạy `rescan` mỗi lần, không phải đợi full walk. Nguyên tắc: **watcher nền theo dõi FS events, index update incremental, picker đọc index luôn tươi**.

## Mô tả

mya background watcher index: khởi động một **watcher nền** (fs.watch / chokidar / native inotify) trên root; sự kiện FS (add / change / unlink) → **cập nhật index incrementally** (thêm file mới, refresh file đổi, xóa file biến mất — không rebuild toàn bộ). Picker/search đọc index — **luôn thấy file mới** (sub-second sau khi file được tạo). mya có packages/tools search-index.ts (index + frecency, "watcher tombstoning is Tier-2+") + packages/core time helper — ABK thêm **watcher thread** + **incremental index update** + **tombstone handling** (file xóa → đánh dấu, không giữ ghost).

## Kiến trúc

```
  WATCHER THREAD (nền — fs.watch / inotify trên root)
  ┌───────────────────────────────────────────────┐
  │  event: add src/new.ts    → index.add(new.ts) │
  │  event: change a.ts       → index.refresh(a.ts)│
  │  event: unlink b.ts       → index.tombstone(b.ts)
  └───────────────────────┬───────────────────────┘
                          │ (incremental update, không rebuild)
                          ▼
  SEARCH INDEX (luôn tươi — path → { frecency, git, bigram })
                          │
                          ▼
  PICKER / SEARCH "new"
    [1] src/new.ts   ← file vừa tạo, thấy ngay (không rescan thủ công)
    [2] src/newer.ts
  → real-time, sub-second
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools search-index.ts — SearchIndex + frecency + bigram (nền — ABK index)
// ✅ packages/natives nativeGlob — walk nhanh (nền — ABK initial build)
// ✅ packages/tools find.ts — find tool (nền — ABK consumer)
// ✅ packages/core time.ts — nowWallclock (nền — ABK timestamp)

// ❌ THIẾU: filesystem watcher thread (fs.watch loop nền)
// ❌ THIẾU: incremental index update (event → add/refresh/tombstone)
// ❌ THIẾU: tombstone handling (file xóa → remove khỏi index, không ghost)
```

## Implementation

```typescript
// packages/tools/src/background-watcher.ts (MỚI)
import { watch, type FSWatcher } from "node:fs";
import { join, relative } from "node:path";
import { nowWallclock } from "@my-agent/core";

export interface WatchIndex {
  add(path: string): void;
  refresh(path: string): void;
  remove(path: string): void;
  entries(): string[];
}

/** Watcher nền: theo dõi FS events → cập nhật index incremental (không rebuild). */
export class BackgroundWatcher {
  private watchers: FSWatcher[] = [];
  private lastEventAt = 0;

  constructor(private root: string, private index: WatchIndex) {}

  /** Bắt đầu watch: 1 watcher cho root + watch thư mục con khi cần. */
  start(): void {
    this.watchers.push(watch(this.root, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const rel = relative(this.root, join(this.root, filename.toString()));
      this.lastEventAt = nowWallclock();
      if (event === "rename" || event === "change") {
        // rename: có thể là add hoặc delete — kiểm tra tồn tại
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _s = require("node:fs").statSync(join(this.root, rel));
          this.index.add(rel); // tồn tại → add/refresh
        } catch {
          this.index.remove(rel); // không tồn tại → tombstone
        }
      }
    }));
  }

  /** Độ tươi: index được cập nhật trong real time → không cần rescan thủ công. */
  get fresh(): boolean { return nowWallclock() - this.lastEventAt < 2000; }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}

// Usage:
// const watcher = new BackgroundWatcher(workspaceRoot, searchIndex);
// watcher.start();
// // file mới tạo → index.add ngay → picker thấy file không cần rescan
// watcher.stop(); // khi shutdown (kết hợp 745 ABQ safety net)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Real-time (file mới thấy ngay — không rescan thủ công) | ❌ Watch limit (fs.watch trên tree lớn có thể tràn handle) |
| ✅ Incremental (event → update 1 file, không rebuild) | ❌ Event loss (rename nhanh add→delete có thể bị miss) |
| ✅ Zero user action (không cần /rescan) | ❌ Platform khác nhau (inotify vs FSEvents vs ReadDirectoryChangesW) |
| ✅ Index luôn tươi (picker đúng trạng thái hiện tại) | ❌ Debounce cần thiết (event storm khi copy/bulk edit) |

## Khác các hướng gần

| | Rescan thủ công | Full rebuild định kỳ | ABK: Background Watcher |
|---|---|---|---|
| File mới thấy | sau khi rescan | sau rebuild | **ngay (real-time)** |
| Chi phí | 1 full walk mỗi lần | định kỳ full | **1 event → 1 update** |
| Độ tươi | phụ thuộc user | phụ thuộc chu kỳ | **luôn tươi** |
| Độ phức tạp | thấp | thấp | **cao (watch + debounce + tombstone)** |

## Khi nào chọn

- Agent hay tạo file rồi tìm ngay (codegen, scaffold, test fixtures)
- Muốn picker/search luôn tươi mà không bắt user/agent rescan
- Đã có search-index (packages/tools) — chỉ thêm watcher layer
- Nối packages/tools search-index.ts + packages/natives nativeGlob + 739-family fff watcher + 745 ABQ process-registry-safety-net (dọn watcher khi shutdown); guard debounce (gộp event storm), watch-limit (recursive watch có giới hạn handle — fallback walk định kỳ), và tombstone-correct (file xóa → remove khỏi index, không ghost trong picker); ABK = background watcher index, kết hợp 737 ABI git-aware-annotations (watcher cũng refresh git status) + 639 XO fingerprint (watcher event → re-index file đổi)
