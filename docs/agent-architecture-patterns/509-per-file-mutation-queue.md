# Hướng SO: Per-File Mutation Queue — serialize ghi/sửa theo file (key realpath), cùng file tuần tự

> **Nguồn gốc:** pi-coding-agent (per-file mutation serialization); "serialize writes per file"; "realpath key mutation queue"; "same-file sequential ordering"; "per-file lock preventing interleaved edits"
> **Coupling:** 🟡 — thêm per-file queue quanh tool dispatcher (edit/write queue, không đổi tool logic)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool dispatcher + edit/write tools sẵn — chưa có per-file realpath queue + lock)
> **Effort:** 1-2 tuần

## Nguồn gốc

**pi-coding-agent** concurrency issue: nhiều tool call (hoặc nhiều agent/subagent song song) **ghi/sửa cùng 1 file** đồng thời → **interleaved edits** (edit A chèn content, edit B đọc bản cũ, ghi đè mất A) → **race condition / corruption**. **Per-file mutation queue**: serialize mọi ghi/sửa theo **file** — key = `realpath(file)`, mỗi file có **queue riêng**, operation trên cùng file **chạy tuần tự** (không interleaved), khác file **chạy song song**. Nguyên tắc: **cùng file = tuần tự, khác file = song song** — không lock toàn cục (chậm), mà lock per-file (granular). realpath key để symlink không đánh lừa (2 path symlink → cùng file → cùng queue).

## Mô tả

mya per-file mutation queue: (1) **Key = realpath**: mỗi mutation (edit/write) resolve `realpath(file)` → canonical key. (2) **Per-file queue**: `Map<realpath, Queue>` — mỗi file có queue riêng. (3) **Enqueue**: mutation vào queue của file → **chờ** mutation trước trên cùng file xong (tuần tự). (4) **Run sequential**: cùng file → chạy tuần tự (A xong → B mới chạy); khác file → chạy song song (queue độc lập). (5) **No global lock**: không block file khác (chỉ block cùng file). mya có tool dispatcher + edit/write tools — SO thêm **per-file queue** (Map realpath → Queue) + **enqueue/run** wrapper.

## Kiến trúc

```
  TOOL CALLS (edit/write) đến song song:
  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
  │ edit src/x.ts       │ │ edit src/x.ts       │ │ edit src/y.ts       │
  │ (mutation A)        │ │ (mutation B)        │ │ (mutation C)        │
  └─────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
            │ realpath                │ realpath               │ realpath
            ▼                         ▼                         ▼
  ┌─── PER-FILE QUEUE (key = realpath) ────────────────────────────────┐
  │  queue[src/x.ts]: [A] → [B]   (cùng file → TUẦN TỰ)                │
  │  queue[src/y.ts]: [C]         (khác file → ĐỘC LẬP)                │
  └───────────────┬────────────────────────────────────────────────────┘
                  │
                  ▼
  ┌─── RUN ─────────────────────────────────────────────┐
  │  x.ts: A chạy → xong → B chạy (tuần tự, không đè)     │
  │  y.ts: C chạy song song với x.ts (khác file)          │
  │  → cùng file tuần tự (anti-interleave), khác file OK  │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ tool dispatcher — run tool (nền — SO queue quanh nó)
// ✅ edit/write tools — file mutation (nền — SO serialize chúng)
// ✅ realpath resolve — canonical path (nền — SO key)
// ✅ 504 workspace-partition — realpath (gần — SO = per-file lock)

// ❌ THIẾU: per-file queue (Map<realpath, Queue>)
// ❌ THIẾU: enqueue/run wrapper (mutation → queue → sequential)
// ❌ THIẾU: realpath key resolution (symlink-safe)
```

## Implementation

```typescript
// packages/agent/src/per-file-mutation-queue.ts (MỚI)
import { realpathSync } from 'node:fs';

class PerFileMutationQueue {
  private queues = new Map<string, Promise<unknown>>();
  private keyOf(path: string): string {
    try { return realpathSync(path); } catch { return path; } // file chưa tồn tại → dùng path
  }

  // enqueue mutation: cùng file tuần tự, khác file song song
  async run<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const key = this.keyOf(path);
    const prev = this.queues.get(key) ?? Promise.resolve();
    // chain: chờ mutation trước trên cùng file xong → chạy fn
    const next = prev.then(fn, fn); // run fn dù trước fail
    this.queues.set(key, next.catch(() => {})); // store, không propagate để chain không break
    try { return await next; }
    finally { /* cleanup entry nếu queue rỗng (optional) */ }
  }
}

// Usage:
// await queue.run('src/x.ts', () => editTool.run({ path: 'src/x.ts', ... })); // A
// await queue.run('src/x.ts', () => editTool.run({ path: 'src/x.ts', ... })); // B chờ A
// await queue.run('src/y.ts', () => editTool.run({ path: 'src/y.ts', ... })); // C song song
// → x.ts tuần tự (A→B), y.ts độc lập (C song song với A/B)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Anti-interleave (cùng file tuần tự, không đè) | ❌ Throughput giảm (cùng file chờ — không song song) |
| ✅ Granular (không global lock — khác file song song) | ❌ realpath syscall overhead (mỗi mutation) |
| ✅ Symlink-safe (realpath key) | ❌ Deadlock risk (nếu mutation chờ file khác có cycle) |
| ✅ Phối 504 workspace-partition (realpath) | ❌ Queue memory (Map giữ promise chain) |

## Khác các hướng gần

| | Global Lock | No Lock | SO: Per-File-Queue |
|---|---|---|---|
| Granularity | Toàn cục (chậm) | Không (race) | **Per-file (realpath)** |
| Cùng file | Tuần tự | Race | **Tuần tự** |
| Khác file | Block | Song song | **Song song** |

## Khi nào chọn

- Multi-tool/multi-agent ghi cùng file song song (race risk)
- Muốn serialize per-file nhưng không global lock (khác file song song)
- Symlink trong workspace (realpath key an toàn)
- Nối tool dispatcher + edit/write tools; guard realpath overhead (memoize nếu nóng) + deadlock (mutation không chờ file khác trong khi giữ lock) + queue cleanup ( Map không phình); phối 460 atomic-commit-splitting (SO serialize per-file, 460 atomic multi-file transaction — khác cấp)
