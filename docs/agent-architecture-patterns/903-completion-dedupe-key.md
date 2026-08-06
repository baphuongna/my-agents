# Hướng AHS: Completion-Dedupe-Key — completion notification dedupe bằng key ưu tiên `id:` rồi fallback tuple `sessionId+agent+timestamp+taskIndex+totalTasks+success`; chống double-notify khi nhiều watcher cùng nhận một completion

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟢 — notify dedup | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có durable-ack classification + dedup infra; chưa có completion dedupe-key) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-subagents** completion notification được **dedupe** bằng key ưu tiên **`id:`** (nếu completion có explicit id) rồi fallback đến tuple `sessionId+agent+timestamp+taskIndex+totalTasks+success` — chống double-notify khi nhiều watcher cùng nhận một completion. Nguyên tắc: **explicit id wins** — nếu nguồn cung id ổn định, dùng nó; **tuple fallback** — khi không có id, kết hợp các trường ổn định thành fingerprint; **idempotent notify** — notify completion phải safe-to-repeat, watcher thấy duplicate sẽ skip.

## Mô tả

Với mya, pattern = **completion dedupe trong notify path**: (1) mya đã có **durable-ack.ts** (packages/core) — completion delivery classification (terminal/retry/deliver) — đúng ngữ cảnh completion; (2) mya có dedup infra trong loop/spill; (3) AHS thêm **dedupe-key function**: `completion.id ? "id:" + id : tuple(sessionId, agent, timestamp, taskIndex, totalTasks, success)`; (4) **seen-set** (in-memory + bounded) — trước notify, check key đã seen → skip; (5) áp dụng khi nhiều watcher (intercom broker, UI, parent agent) cùng nhận completion.

## Kiến trúc (ASCII)

```
  COMPLETION { id?, sessionId, agent, timestamp, taskIndex, totalTasks, success }
    │
    ▼
  DEDUPE-KEY
    ├─ id có giá trị? ──► key = "id:" + id      (ưu tiên — ổn định nhất)
    └─ không?         ──► key = tuple(sessionId|agent|timestamp|taskIndex|
                                      totalTasks|success)   (fingerprint)
    │
    ▼
  SEEN-SET (bounded LRU)
    ├─ key đã seen? ──► SKIP (double-notify — nhiều watcher cùng nhận)
    └─ chưa?        ──► NOTIFY + mark seen
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core durable-ack.ts — completion delivery classification
//   (terminal/retry/deliver — ngữ cảnh completion lifecycle)
// ✅ packages/core loop.ts / spill.ts — dedup infra (seen-set pattern)
// ✅ packages/intercom reply-tracker.ts — track reply (nền idempotent notify)
// ✅ packages/core time.ts — nowWallclock (timestamp source)

// ❌ THIẾU: completion dedupe-key function (id: ưu tiên + tuple fallback)
// ❌ THIẾU: seen-set bounded trong notify path
```

## Implementation

```typescript
// packages/core/src/completion-dedupe.ts (NEW)
export interface Completion {
  id?: string;
  sessionId: string; agent: string; timestamp: number;
  taskIndex: number; totalTasks: number; success: boolean;
}

/** Key ưu tiên id: rồi fallback tuple — ổn định + fingerprint. */
export function dedupeKey(c: Completion): string {
  if (c.id && c.id.length > 0) return `id:${c.id}`;
  return `t:${c.sessionId}|${c.agent}|${c.timestamp}|${c.taskIndex}|${c.totalTasks}|${c.success}`;
}

/** Bounded seen-set — skip double-notify. */
export class CompletionDeduper {
  private readonly seen = new Map<string, number>(); // key → evictAt
  constructor(private readonly ttlMs: number = 300_000, private readonly max = 10_000) {}
  /** true nếu lần đầu (notify), false nếu duplicate (skip). */
  checkAndMark(c: Completion, now: number): boolean {
    const k = dedupeKey(c);
    // evict expired
    if (this.seen.size >= this.max) {
      for (const [ek, at] of this.seen) if (at <= now) this.seen.delete(ek);
    }
    if (this.seen.has(k)) return false;       // duplicate
    this.seen.set(k, now + this.ttlMs);
    return true;                               // first — notify
  }
}
// Notify path (intercom/UI/parent): const first = deduper.checkAndMark(c, now);
// if (!first) return; // skip double-notify
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống double-notify khi nhiều watcher | ❌ Seen-set cần bound + TTL (memory) |
| ✅ id: ưu tiên — ổn định khi nguồn cung | ❌ Tuple fallback có thể collision hiếm |
| ✅ Idempotent notify — safe-to-repeat | ❌ TTL quá ngắn → re-notify sau expire |
| ✅ Nối durable-ack sẵn | ❌ id phải stable — id random mỗi lần = vô dụng |

## Khác các hướng gần

| | AHS Completion-Dedupe-Key | AHR Stale-Run-Reconciler | AIA Group-Join-Consolidated-Notify |
|---|---|---|---|
| Trọng tâm | Dedupe 1 completion | Sửa orphan run | Gộp nhiều completion |
| Cơ chế | id: + tuple key + seen-set | PID-liveness + grace | Batch 30s + straggler |
| Quan hệ | Trong notify (1 event) | Trước notify (lifecycle) | Trong notify (N event) |

## Khi nào chọn

- Nhiều watcher cùng nhận completion → double-notify
- Nguồn completion có thể cung explicit id ổn định
- Muốn idempotent notify (safe-to-repeat)
- Guard: id ưu tiên khi stable, tuple fallback fingerprint, seen-set bounded + TTL, id phải deterministic
