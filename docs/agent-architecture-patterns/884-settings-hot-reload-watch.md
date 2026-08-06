# Hướng AGZ: Settings Hot-Reload Watch — settings file theo dõi bằng fs.watch + mtime polling + debounce 200ms; mtime đổi → parse JSON validate → applySettingsFromDisk (re-register tools, reset interval) không cần reload Pi

> **Nguồn gốc:** pi-sub | **Coupling:** 🟡 — bind vào config + tool registry | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có mtime logic trong code-index, nhưng KHÔNG có settings hot-reload watcher) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-sub** theo dõi settings file **live**: dùng `fs.watch` (event-driven) **+ mtime polling** (fallback khi fs.watch miss event — đặc biệt NFS/some FS) **+ debounce 200ms** (gom nhiều change event liên tiếp). Khi **mtime đổi** → **parse JSON validate** (reject config hỏng) → **`applySettingsFromDisk`** (re-register tools, reset interval) — **không cần reload toàn bộ Pi**. Kết quả: đổi settings file → hiệu lực ngay, không restart.

Nguyên tắc: **3 lớp watch** (fs.watch event + mtime polling fallback + debounce gom); **validate trước apply** (config hỏng không crash); **applySettingsFromDisk granular** (re-register tool, reset interval — không reload whole app); **hot-reload không restart**.

## Mô tả

Với mya, packages/memory `code-index.ts` đã dùng **mtime-incremental** (so mtime skip unchanged — line 168-183), nhưng mya **chưa có** **settings hot-reload watcher**: (1) `fs.watch` + mtime polling + debounce, (2) validate JSON, (3) `applySettingsFromDisk` granular (re-register tools). Pattern này cho phép đổi config khi đang chạy mà không restart.

## Kiến trúc (ASCII)

```
  settings.json thay đổi
        │
        ▼
  fs.watch (event) + mtime polling (fallback) + debounce 200ms (gom burst)
        │  mtime đổi?
        ▼
  parse JSON → validate (reject config hỏng)
        │  ok
        ▼
  applySettingsFromDisk:
    ├─ re-register tools (tool list mới)
    ├─ reset interval (cron/refresh)
    └─ ... (granular, không reload whole app)
  ── hiệu lực ngay, không restart Pi
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/code-index.ts — mtime-incremental (so mtime skip unchanged, line 168-183)
// ✅ packages/intercom/src/config.ts — config read
// ⚠️ KHÔNG có fs.watch + mtime polling watcher cho settings
// ❌ KHÔNG có applySettingsFromDisk granular (re-register tools, reset interval)
```

## Implementation

```typescript
// packages/core/src/settings-watcher.ts (NEW)
import { watch, statSync } from "node:fs";

export class SettingsWatcher {
  private lastMtime = 0;
  private debounce?: NodeJS.Timeout;
  private watcher?: ReturnType<typeof watch>;

  constructor(
    private readonly path: string,
    private readonly apply: (raw: unknown) => void,
    private readonly debounceMs = 200,
  ) {}

  start(): void {
    this.lastMtime = this.mtime();
    // Lớp 1: fs.watch event-driven
    this.watcher = watch(this.path, () => this.schedule());
    // Lớp 2: mtime polling fallback (NFS/FS miss fs.watch)
    setInterval(() => { if (this.mtime() !== this.lastMtime) this.schedule(); }, 1000).unref();
  }

  private mtime(): number { try { return statSync(this.path).mtimeMs; } catch { return 0; } }

  private schedule(): void {
    clearTimeout(this.debounce);                 // lớp 3: debounce gom burst
    this.debounce = setTimeout(() => this.applyFromDisk(), this.debounceMs);
  }

  private applyFromDisk(): void {
    this.lastMtime = this.mtime();
    try {
      const raw = JSON.parse(readFileSyncSafe(this.path));
      this.apply(raw);                            // validate + apply granular
    } catch (e) { console.warn("[settings] invalid, kept old:", e); }   // config hỏng → giữ cũ
  }

  stop(): void { this.watcher?.close(); }
}
// apply: (raw) => { reRegisterTools(raw.tools); resetInterval(raw.intervalMs); }  // granular
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đổi config hiệu lực ngay, không restart | ❌ Watcher CPU nhẹ (polling) + leak risk nếu không stop |
| ✅ 3 lớp watch (fs.watch + mtime + debounce) robust | ❌ Validate hỏng → giữ cũ (silent, cần log) |
| ✅ Granular apply (re-register tool, reset interval) | ❌ Race khi apply giữa chừng đang chạy tool |

## Khác các hướng gần

| | AGZ Hot-Reload Watch | AGY Stale-Cache-First | code-index mtime |
|---|---|---|---|
| Trọng tâm | Reload config khi file đổi | Cache-first + bg revalidate | Skip re-index file unchanged |
| Cơ chế | fs.watch + mtime + debounce | allowStaleCache + bg fetch | so mtime, skip nếu bằng |
| Quan hệ | Nối config lifecycle | Nối data freshness | Nối index incremental |

## Khi nào chọn

- Muốn đổi settings khi đang chạy mà không restart
- fs.watch không đủ tin cậy (NFS/some FS) → cần mtime polling fallback
- Apply granular (re-register tool, reset interval) thay vì reload whole app
- Guard: 3 lớp watch, validate trước apply, debounce gom burst, giữ cũ khi hỏng
