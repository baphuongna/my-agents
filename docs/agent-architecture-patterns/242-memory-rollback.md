# Hướng IH: Memory Rollback — snapshot/undo cho bộ nhớ agent

> **Nguồn gốc:** Git snapshot/checkout; database MVCC + time-travel (Snowflake, Dolt); "undo/redo" pattern; ZFS/btrfs snapshots; checkpoint-restart (73 durable execution)
> **Coupling:** 🟡 — snapshot layer trên memory store, agent loop đổi nhẹ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory brain-store + lifecycle sẵn — thiếu snapshot/restore + undo log)
> **Effort:** 2-3 tuần

## Nguồn gốc

Memory rollback — "undo" cho bộ nhớ agent — gốc từ: (1) **database MVCC** (Snowflake time-travel query, Dolt versioned DB) — mọi phiên bản state được giữ, query "state tại thời điểm T"; (2) **Git** — commit/snapshot, checkout về point cũ; (3) **checkpoint-restart** trong durable execution (73) — snapshot state định kỳ → crash recovery rollback. Cho agent: agent học/sửa memory liên tục — đôi khi sửa sai (fact sai, ghi nhầm, poisoning). Rollback: snapshot memory định kỳ → khi phát hiện sai (anomaly 236, hoặc user report) → restore snapshot sạch trước khi hỏng. Khác "redo" — rollback chỉ lui, không forward.

Khác **136 time-travel-debugging** (inspect state cũ — *chỉ xem*) — IH *restore* (thực sự hoàn nguyên memory). Khác **230 event-sourcing** (HV — replay event rebuild state) — IH snapshot-based (nhanh hơn, không cần replay toàn bộ). Khác **169 self-healing** (tự sửa) — IH *undo* (quay về bản sạch). Nối **236 anomaly** (IB — phát hiện memory sai → trigger rollback), **73 durable-execution** (checkpoint nền tảng), **165 hierarchical-memory**.

## Mô tả

mya memory rollback: (1) **snapshot** — định kỳ (mỗi N turn, hoặc trước action rủi ro) lưu memory state (packages/memory brain-sqlite-store) vào snapshot table; (2) **restore** — khi phát hiện memory hỏng (anomaly 236, user report, poisoning detection) → rollback về snapshot sạch gần nhất; (3) **undo log** — ghi delta giữa snapshot (chỉ cần undo, không cần full snapshot mỗi lần). mya đã có brain-sqlite-store + lifecycle (decay/consolidate) — IH thêm snapshot/restore + undo log trên đó.

## Kiến trúc

```
  AGENT TURNS (ghi/sửa memory liên tục)
   turn 1: add fact "v2 stable"
   turn 2: add fact "tests pass"
   turn 3: add fact "deploy approved"  ← SNAPSHOT S1 ✓
   turn 4: add fact "DELETE ALL"  ← ANOMALY! poisoning (236 IB)
   turn 5: memory hỏng
        │
        │  phát hiện: anomaly score 0.97 (236)
        ▼
  ┌──────────────────────────────────────────────┐
  │  ROLLBACK ENGINE                               │
  │                                               │
  │  ① find last clean snapshot: S1 (turn 3)      │
  │  ② RESTORE: memory = S1 state                 │
  │     · "DELETE ALL" fact removed               │
  │     · facts turn 1-3 preserved                │
  │  ③ AUDIT rollback event (198)                 │
  │  ④ alert operator (227)                       │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
              memory SẠCH → agent tiếp tục từ điểm an toàn
```

```
mya: brain-sqlite-store + lifecycle sẵn — thiếu snapshot/restore + undo log + rollback trigger
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/brain-sqlite-store.ts — SQLite memory store (snapshot candidate)
// ✅ packages/memory/src/lifecycle.ts — decay/consolidate/purge (mutates state)
// ✅ 73 durable-execution — checkpoint-restart (pattern nền tảng)
// ✅ 136 time-travel-debugging — inspect old state (chỉ xem — IH thêm restore)
// ✅ 230 event-sourcing (HV) — event replay (alternative rollback method)
// ✅ 236 behavior-anomaly (IB) — trigger rollback khi phát hiện poisoning

// ❌ THIẾU: snapshot mechanism (periodic memory state save)
// ❌ THIẾU: restore/rollback (revert memory to clean snapshot)
// ❌ THIẾU: undo log (delta between snapshots — efficient rollback)
// ❌ THIẾU: rollback trigger (anomaly 236 / user report / poisoning detect)
```

## Implementation

```typescript
// packages/memory/src/rollback.ts (NEW)
interface MemorySnapshot {
  id: string;
  turnId: string;
  takenAt: number;
  factCount: number;
}

class MemoryRollback {
  constructor(private store: BrainSQLiteStore) {}

  // Periodic snapshot (call before risky action, or every N turns)
  async snapshot(turnId: string): Promise<string> {
    const snapId = crypto.randomUUID();
    // Copy current memory state → snapshot table (or write undo log delta)
    this.store.db.prepare(
      "INSERT INTO memory_snapshots (id, turnId, takenAt, state) VALUES (?,?,?,?)"
    ).run(snapId, turnId, nowWallclock(), this.store.serialize());
    return snapId;
  }

  // Restore: revert memory to a clean snapshot
  async restore(snapId: string): Promise<void> {
    const snap = this.store.db.prepare("SELECT state FROM memory_snapshots WHERE id=?").get(snapId);
    this.store.deserialize(snap.state);  // overwrite current memory
    this.audit({ type: "memory.rollback", snapId, reason: "anomaly/poisoning" });
  }

  // Find last clean snapshot before anomaly detected
  async lastClean(maxTurn: string): Promise<string | null> {
    const row = this.store.db.prepare(
      "SELECT id FROM memory_snapshots WHERE turnId <= ? AND clean=1 ORDER BY takenAt DESC LIMIT 1"
    ).get(maxTurn);
    return row?.id ?? null;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Undo memory sai (poisoning, ghi nhầm) — restore sạch | ❌ Storage growth (snapshot accumulate) |
| ✅ Nhanh hơn event-replay (snapshot = direct restore) | ❌ Lost progress (facts sau snapshot bị mất) |
| ✅ Crash recovery (nối 73 durable-execution) | ❌ Snapshot overhead (serialize mỗi N turn) |
| ✅ Nối 236 anomaly (auto-rollback khi poisoning) | ❌ When to snapshot? (too often = slow, too rare = data loss) |

## Khác các hướng gần

| | 136 Time-Travel Debug | 230 Event Sourcing (HV) | IH: Memory Rollback |
|---|---|---|---|
| Mục | Inspect state cũ | Rebuild from events | **Restore (thực sự undo)** |
| Cách | Query point T | Replay all events | **Snapshot overwrite** |
| Speed | Fast (query) | Slow (replay) | **Fast (direct restore)** |

## Khi nào chọn

- Agent tự ghi/sửa memory → rủi ro poisoning hoặc sai
- Cần undo khi phát hiện memory hỏng (nối 236 anomaly)
- Crash recovery — restore về checkpoint sạch
- OK với snapshot storage overhead
