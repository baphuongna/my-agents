# Hướng HU: Distributed Locking — mutex/lease tránh 2 agent đụng tài nguyên chung

> **Nguồn gốc:** Kleppmann "How to do distributed locking" (2016, 11 cites); Redis Redlock; Martin Fowler; Redisson PRO
> **Coupling:** 🟢 — lock service tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cross-process-lock sẵn — thiếu TTL lease + fencing)
> **Effort:** 1-2 tuần

## Nguồn gốc

Distributed lock (Kleppmann 2016): "a lock in a distributed system is not like a mutex in a multi-threaded application" — nó là **lease với TTL**. Redis Redlock: acquire lock với random token + TTL, release chỉ nếu token khớp. Kleppmann critique: lock không fencing token → stale lock holder ghi sau khi lease hết hạn → corruption. Giải pháp: **fencing token** — monotonically increasing, storage reject writes với token cũ. Dùng cho: 2 agent không cùng sửa file, cron không double-fire, resource pool không over-allocate.

## Mô tả

mya distributed lock: trước khi agent sửa tài nguyên chung (file, DB row, cron job), acquire lock từ lock service. Lock có TTL (lease) — nếu agent crash, lock tự释放. Khi hoàn thành, release lock. Kleppmann fencing: mỗi lock grant kèm fencing token; storage reject operation với token cũ (stale holder). mya đã có cross-process-lock (SQLite) nhưng thiếu TTL lease + fencing token.

## Kiến trúc

```
  AGENT A muốn sửa file.ts ──► LOCK SERVICE
                                 │
                          ┌──────▼──────┐
                          │  acquire    │
                          │  token=42   │
                          │  TTL=30s    │
                          └──────┬──────┘
                                 │ granted
  AGENT B muốn sửa file.ts ──► LOCK SERVICE
                                 │
                          ┌──────▼──────┐
                          │  DENIED     │
                          │  (held by A)│
                          └─────────────┘

  AGENT A done ──► release(token=42)

  --- hoặc AGENT A crash ---

  TTL expires (30s) ──► lock auto-released
  AGENT B retries ──► acquire(token=43) ──► granted

  FENCING: storage rejects writes with token < current
  → stale holder (A crash but GC pause) can't corrupt
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/cron/src/cross-process-lock.ts — SQLite-based lock (đã có!)
// ✅ packages/cron/src/cron-catchup.test.ts — test cross-process lock
// ✅ kanban-sqlite — atomic claim (CAS pattern)

// ❌ THIẾU: TTL lease (hiện lock là forever-until-release)
// ❌ THIẾU: fencing token (stale holder protection)
// ❌ THIẾU: distributed lock service (hiện local SQLite only)
```

## Implementation

```typescript
// packages/lock/src/distributed-lock.ts (NEW)
class DistributedLock {
  constructor(private store: Redis | SQLite) {}

  async acquire(resource: string, ttlMs: number): Promise<LockHandle | null> {
    const token = this.nextToken(); // monotonic fencing token
    const key = `lock:${resource}`;
    // SET key token NX PX ttl (Redis) or INSERT ... (SQLite)
    const ok = await this.store.setNx(key, token, ttlMs);
    if (!ok) return null; // held by another agent

    // Start heartbeat to extend TTL before expiry
    const heartbeat = setInterval(() => this.extend(key, token, ttlMs), ttlMs * 0.5);

    return { resource, token, release: async () => {
      clearInterval(heartbeat);
      // Only release if we still hold it (CAS)
      await this.store.compareDel(key, token);
    }};
  }
}

// Usage: 2 agents don't collide
const lock = await locks.acquire("file:src/index.ts", 30_000);
if (!lock) { console.log("busy — try later"); return; }
try { await editFile("src/index.ts", changes); }
finally { await lock.release(); }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tránh 2 agent sửa cùng file (corruption) | ❌ Lock không như mutex (Kleppmann) — TTL needed |
| ✅ TTL auto-release khi agent crash | ❌ Fencing token complexity |
| ✅ Cron không double-fire (HA cluster) | ❌ Lock contention → throughput giảm |
| ✅ Redis Redlock proven (Redisson) | ❌ Split-brain risk (network partition) |
| ✅ cross-process-lock sẵn (1 phần) | |

## Khác các hướng gần

| | 30 (ref) Lock | HU: Distributed Lock | 229 Distributed Locking |
|---|---|---|---|
| Scope | Local (1 process) | **Cross-process, cross-node** | Same as HU |
| TTL | ❌ | ✅ lease | ✅ |
| Fencing | ❌ | ✅ | ✅ |

## Khi nào chọn

- 2+ agent chạy đồng thời, có thể đụng tài nguyên chung (file, DB, API quota)
- Cron cluster (HA — không double-fire)
- Resource pool (GPU, API rate limit) — mutual exclusion
- OK với TTL + fencing complexity
