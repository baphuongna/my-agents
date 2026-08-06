# Hướng AGY: Stale-Cache-First Render — render cached state ngay lập tức (allowStaleCache) rồi fetch fresh background rồi re-render, không await fetch trong session_start/model_select vì block handler khác

> **Nguồn gốc:** pi-sub | **Coupling:** 🟡 — bind vào session lifecycle handler | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có memory cache + spill, nhưng KHÔNG có stale-while-revalidate render pattern) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-sub** render **cached state ngay lập tức** (cờ `allowStaleCache`) thay vì `await` fetch — sau đó **fetch fresh background** rồi **re-render** khi xong. Lý do: trong handler `session_start`/`model_select`, nếu `await` fetch (đọc disk, gọi API) thì **block các handler khác** (event queue tắc). Pattern **stale-while-revalidate**: (1) vẽ cache cũ ngay (user thấy gì đó tức thì), (2) fetch nền, (3) re-render khi fresh — UI phản hồi nhanh, không tắc event loop.

Nguyên tắc: **cache-first render** (user thấy gì đó tức thì); **fetch background** (không await trong handler nhạy); **re-render khi fresh** (SWR); **không block event queue** (handler return nhanh).

## Mô tả

Với mya, packages/memory có cache + spill, packages/agent có session, nhưng **chưa có** rõ pattern **stale-while-revalidate render**: render cache cũ ngay trong `session_start`/`model_select` rồi fetch nền. Pattern này tăng độ phản hồi UI khi handler phải đọc dữ liệu chậm (disk/API) — không tắc event queue.

## Kiến trúc (ASCII)

```
  session_start / model_select handler
        │
        ├─ allowStaleCache? ──► render(cache) ngay lập tức (UI phản hồi tức thì)
        │                          (không await)
        │
        └─ fetch fresh BACKGROUND ─► khi xong → re-render(fresh)
                                    (không block handler khác)
  ── handler return nhanh → event queue không tắc
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory/src/backends.ts — InMemoryBackend (cache tier)
// ✅ packages/core/src/spill.ts — spill/overflow handling
// ✅ packages/agent/src/sdk.ts — session lifecycle
// ⚠️ KHÔNG có stale-while-revalidate render (cache-first + bg revalidate)
// ❌ KHÔNG có allowStaleCache flag trong session_start/model_select handler
```

## Implementation

```typescript
// packages/core/src/stale-cache.ts (NEW)
export class StaleCacheRenderer<T> {
  constructor(
    private cache: T | undefined,
    private readonly render: (state: T, fresh: boolean) => void,
    private readonly fetch: () => Promise<T>,
  ) {}

  /** Render cache ngay (nếu có), fetch background, re-render khi fresh. */
  async swr(): Promise<void> {
    if (this.cache !== undefined) this.render(this.cache, false);   // stale, tức thì
    try {
      const fresh = await this.fetch();                            // background, KHÔNG block
      this.cache = fresh;
      this.render(fresh, true);                                    // re-render fresh
    } catch { /* giữ cache cũ, log — không crash UI */ }
  }
}

// Hook session_start/model_select:
//   renderer.swr();  // KHÔNG await — handler return ngay, event queue không tắc
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ UI phản hồi tức thì (cache-first) | ❌ Render 2 lần (stale rồi fresh) — flicker nhẹ |
| ✅ Không block event queue (handler return nhanh) | ❌ Cache stale có thể sai thoáng (revalidate sau) |
| ✅ SWR — tươi cuối cùng | ❌ Cache miss (lần đầu) vẫn phải chờ fetch |

## Khác các hướng gần

| | AGY Stale-Cache-First | AGL Render Coalesce | AGZ Hot-Reload-Watch |
|---|---|---|---|
| Trọng tâm | Cache-first + bg revalidate | Gộp vẽ thành 1 frame | Reload config khi file đổi |
| Cơ chế | allowStaleCache + bg fetch | 1 timer + editor-defer | fs.watch + mtime + debounce |
| Quan hệ | Nối data freshness | Nối render loop | Nối config lifecycle |

## Khi nào chọn

- Handler phải đọc dữ liệu chậm (disk/API) nhưng cần return nhanh
- Muốn UI phản hồi tức thì (render cache cũ trước)
- Event queue bị block vì await fetch trong handler nhạy
- Guard: cache-first render, bg fetch không await, re-render fresh, giữ cache khi fetch fail
