# Hướng TG: Prewarmed Session Pool — cache + prewarm session manager, run mới dùng session ấm

> **Nguồn gốc:** openclaw `config/sessions/` (`store-cache.ts`, `sessions.cache.test.ts`, `getSerializedSessionStore`, `writeSessionStoreCache`, `getSessionStoreSnapshotCacheStats`), `tasks/task-registry.maintenance.ts`; "session config cache invalidation"; "prewarm session manager"; "warm session for new run"; "cache stats / snapshot" | **Coupling:** 🟡 — thêm prewarm pool (giữ session ấm sẵn, run mới dùng ngay) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session cache sẵn — chưa có prewarm pool + warm-session reuse) | **Effort:** 2-3 tuần

## Nguồn gốc

**openclaw** có **session cache** (`store-cache.ts` — serialized store, snapshot, cache stats) — session config được **cache + invalidate** để load nhanh. Mở rộng thành **prewarm session pool**: giữ **N session ấm** sẵn sàng (đã load config, model connection established, context primed) trong pool; khi **run mới** đến → lấy session ấm từ pool (bỏ cold-start), dùng ngay; pool **prewarm** thêm session để giữ N ấm luôn. Nguyên tắc: **session ấm = đã sẵn sàng** (config loaded, connection warm) → run mới không cold-start; pool duy trì N ấm. Khác **R Connection-Pool** (DB connection) — TG là **agent session pool**; khác **KY Warm-Pool** (model) — TG **session-level**.

## Mô tả

mya prewarmed session pool: (1) **Pool**: giữ N session ấm (loaded config, warm connection, primed context). (2) **Acquire**: run mới → lấy session ấm (no cold-start, dùng ngay). (3) **Prewarm**: pool prewarm thêm session để duy trì N ấm (background). (4) **Invalidate**: session cũ/stale → evict, prewarm thay. (5) **Cache stats**: track hit-rate (run dùng warm session) + prewarm cost. mya có session cache — TG thêm **pool manager** + **prewarmer** + **acquire/evict**.

## Kiến trúc

```
  PREWARM POOL (giữ N session ấm sẵn sàng):
  ┌─── POOL ─────────────────────────────────────────────┐
  │  [warm-1] config loaded, conn warm, context primed     │
  │  [warm-2] config loaded, conn warm, context primed     │
  │  [warm-3] config loaded, conn warm, context primed     │
  └───────────────────────┬─────────────────────────────┘
                          │ (run mới đến)
                          ▼
  ┌─── ACQUIRE (no cold-start) ──────────────────────────┐
  │  run #42 → acquire warm-1 (sẵn sàng, dùng ngay)        │
  │  pool còn [warm-2, warm-3]                             │
  └───────────────────────┬─────────────────────────────┘
                          │ (pool < N)
                          ▼
  ┌─── PREWARM (background, duy trì N ấm) ───────────────┐
  │  prewarm warm-4 (load config, establish conn, prime)   │
  │  pool → [warm-2, warm-3, warm-4]  (N=3 lại)            │
  │  stale session → evict → prewarm thay                  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent session manager — session lifecycle (nền — TG pool session)
// ✅ openclaw session cache (store-cache) — cache (nền — TG prewarm từ đây)
// ✅ R connection-pool — pool pattern (nền — TG áp dụng cho session)

// ❌ THIẾU: pool manager (giữ N warm session)
// ❌ THIẾU: prewarmer (background load config + warm conn + prime)
// ❌ THIẾU: acquire/evict (run mới lấy warm, stale evict)
// ❌ THIẾU: cache stats (hit-rate, prewarm cost)
```

## Implementation

```typescript
// packages/agent/src/prewarm-session-pool.ts (MỚI)
interface WarmSession { id: string; ready: boolean; primedAt: number }
interface SessionFactory { create(): Promise<WarmSession> }

class PrewarmSessionPool {
  private pool: WarmSession[] = [];
  constructor(
    private factory: SessionFactory,
    private size: number, // N warm sessions
  ) {}

  // fill pool to size (background prewarm)
  async prewarm(): Promise<void> {
    while (this.pool.filter(s => s.ready).length < this.size) {
      const s = await this.factory.create(); // load config, warm conn, prime context
      this.pool.push(s);
    }
  }

  // acquire warm session for new run (no cold-start)
  async acquire(): Promise<WarmSession> {
    const warm = this.pool.find(s => s.ready);
    if (warm) {
      this.pool = this.pool.filter(s => s !== warm);
      void this.prewarm(); // refill background
      return warm;
    }
    // no warm available → create on-demand (fallback)
    return this.factory.create();
  }

  // evict stale (old session, config changed)
  evict(isStale: (s: WarmSession) => boolean): void {
    this.pool = this.pool.filter(s => !isStale(s));
    void this.prewarm();
  }

  stats(): { warm: number; target: number } {
    return { warm: this.pool.filter(s => s.ready).length, target: this.size };
  }
}

// Usage:
// await pool.prewarm();              // boot: fill N warm
// const session = await pool.acquire(); // run #42 → warm (no cold-start)
// pool.evict(s => configChanged(s));   // stale → evict + prewarm
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No cold-start (run mới dùng session ấm) | ❌ Prewarm resource (giữ N session luôn ấm) |
| ✅ Pool pattern (predictable, N sẵn sàng) | ❌ Stale session (config đổi → warm cũ hỏng) |
| ✅ Evict + refill (luôn N ấm) | ❌ Warm-session leak (acquire không return) |
| ✅ Cache stats (hit-rate measure) | ❌ Memory (N session ấm tốn RAM) |

## Khác các hướng gần

| | R Connection-Pool | KY Warm-Pool | TG: Prewarm-Session-Pool |
|---|---|---|---|
| Cái gì | DB connection | Model warm | **Agent session warm pool** |
| Level | Connection | Model | **Session (config+conn+context)** |
| Cold-start | DB | Model load | **Session setup** |

## Khi nào chọn

- Nhiều run ngắn, session setup chậm (cold-start đáng kể)
- Muốn run mới dùng ngay (no wait for warmup)
- Có resource giữ N session ấm (RAM OK)
- Nối packages/agent session manager + openclaw session cache (store-cache) + R connection-pool (pattern); guard stale detection (config đổi → evict warm cũ), prewarm cost (N hợp lý, không quá nhiều), và leak prevention (acquire phải return/expire); TG = prewarmed session pool, kết hợp IP Context-Prefetch (prime context trong prewarm) + KY Warm-Pool (model warm)
