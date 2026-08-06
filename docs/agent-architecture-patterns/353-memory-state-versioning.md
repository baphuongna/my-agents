# Hướng MO: Memory State Versioning — Git-snapshot toàn bộ memory state, rollback/diff

> **Nguồn gốc:** agentmemory (snapshot toàn memory state); "git for memory"; "state checkpoint"; "event sourcing snapshot"; "memory rollback"; Datomic/XTDB immutable + time-travel; "memory migration safety net"
> **Coupling:** 🟡 — thêm snapshot/checkpoint layer vào memory store
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (brain-store + SQLite sẵn — chưa có full-state snapshot/rollback)
> **Effort:** 2-3 tuần

## Nguồn gốc

**agentmemory**: snapshot **toàn bộ memory state** tại mốc thời gian — như git commit cho memory. Khi consolidation/supersede gây regression → **rollback** về snapshot trước. **Diff** giữa 2 snapshot: "consolidation thay đổi gì?" — fact nào bị merge/xóa/thêm. **Datomic/XTDB**: immutable DB + time-travel query — state tại bất kỳ thời điểm nào. Nguyên tắc: **memory thay đổi là nguy hiểm** (consolidate sai → mất fact) → snapshot trước mỗi destructive operation, rollback nếu sai. Khác **351 MM append-only** (per-fact temporal) — MO snapshot **toàn state**; khác **333 data-versioning** (dataset) — MO **agent memory**; khác **366 seamless-compaction** (compact context) — MO snapshot **persistent memory**.

## Mô tả

mya memory state versioning: trước mỗi consolidation (lifecycle.ts), dream-cycle, hoặc batch update → **snapshot** toàn memory state (SQLite dump / content-addressed hash). Nếu regression phát hiện → **rollback** về snapshot. **Diff** tool: so sánh 2 snapshot — fact thêm/xóa/đổi. mya có brain-sqlite-store.ts (SQLite) — MO thêm **snapshot/restore/diff** layer. Nối lifecycle.ts (destructive op → cần snapshot trước), dream-cycle.ts (offline consolidation → snapshot), 333 data-versioning (pattern). Snapshot = cheap (SQLite file copy / content hash).

## Kiến trúc

```
  BEFORE CONSOLIDATION (lifecycle.ts / dream-cycle)
       │
       ▼
  ┌─── SNAPSHOT ────────────────────────────────┐
  │                                             │
  │  hash = sha256(serialize(all memory))       │
  │  store: snapshot(hash) → SQLite dump file   │
  │  tag: "pre-consolidation-2026-08-06"        │
  │                                             │
  └──────────────────┬──────────────────────────┘
                     │
                     ▼  consolidation runs (merge/dedupe/purge)
  ┌─── VERIFY ──────────────────────────────────┐
  │                                             │
  │  Regression? (lost important fact?)         │
  │    ┌─────┴─────┐                           │
  │    │ OK         │ REGRESSION                │
  │    └─────┬─────┘                           │
  └──────────┼─────────────────────────────────┘
             │                    │
        COMMIT (keep)        ROLLBACK → restore snapshot(hash)
                                    │
                             DIFF: snapshot ↔ current
                             (fact nào bị xóa/đổi?)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/brain-sqlite-store.ts — SQLite storage (nền — dumpable)
// ✅ packages/memory/src/lifecycle.ts — consolidation (destructive → cần snapshot)
// ✅ packages/memory/src/dream-cycle.ts — offline consolidation (snapshot before)
// ✅ 333 LU data-versioning — dataset versioning (pattern — MO cho memory)
// ✅ 155 right-to-be-forgotten — selective delete (rollback complement)

// ❌ THIẾU: snapshot/restore (full memory state dump + hash)
// ❌ THIẾU: snapshot registry (hash → file, tagged)
// ❌ THIẾU: diff tool (compare 2 snapshots — added/removed/changed)
// ❌ THIẾU: rollback (restore SQLite dump)
```

## Implementation

```typescript
// packages/memory/src/memory-versioning.ts (NEW)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

interface Snapshot {
  hash: string;
  tag: string;
  timestamp: number;
  size: number;
}

class MemoryVersioning {
  constructor(private dbPath: string, private snapshots = new Map<string, Snapshot>()) {}

  // Snapshot — copy SQLite db + hash
  snapshot(tag: string): Snapshot {
    const data = readFileSync(this.dbPath);
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
    const snapPath = `${this.dbPath}.snap-${hash}`;
    if (!existsSync(snapPath)) copyFileSync(this.dbPath, snapPath); // dedup identical
    const entry: Snapshot = { hash, tag, timestamp: Date.now(), size: data.length };
    this.snapshots.set(hash, entry);
    return entry;
  }

  // Rollback — restore from snapshot
  rollback(hash: string): void {
    const snap = this.snapshots.get(hash);
    if (!snap) throw new Error(`snapshot ${hash} not found`);
    copyFileSync(`${this.dbPath}.snap-${hash}`, this.dbPath); // restore
  }

  // Diff — what changed between two snapshots?
  diff(oldHash: string, newHash: string): { added: string[]; removed: string[]; changed: string[] } {
    const oldFacts = this.loadFacts(oldHash);
    const newFacts = this.loadFacts(newHash);
    const oldIds = new Set(oldFacts.keys());
    const newIds = new Set(newFacts.keys());
    return {
      added: [...newIds].filter(id => !oldIds.has(id)),
      removed: [...oldIds].filter(id => !newIds.has(id)),
      changed: [...newIds].filter(id => oldIds.has(id) && oldFacts.get(id) !== newFacts.get(id)),
    };
  }

  list(): Snapshot[] { return [...this.snapshots.values()].sort((a, b) => b.timestamp - a.timestamp); }

  private loadFacts(hash: string): Map<string, string> {
    // parse SQLite dump → fact id → content (simplified)
    return new Map();
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rollback safety (consolidation sai → restore) (agentmemory) | ❌ Snapshot storage (SQLite copy mỗi mốc) |
| ✅ Diff — "consolidation đổi gì?" (audit) | ❌ Snapshot accumulation (retention policy) |
| ✅ Migration safety net (schema change → snapshot) | ❌ Rollback granularity (full state, không partial) |
| ✅ Content-hash dedup (identical snapshot free) | ❌ SQLite hot-restore (may need restart) |

## Khác các hướng gần

| | 351 MM Append-Only | 333 LU Data Versioning | MO: Memory Versioning |
|---|---|---|---|
| Cái gì | Per-fact temporal | Dataset snapshot | **Full memory snapshot** |
| Granularity | Single fact | Dataset | **Entire memory store** |
| Rollback | Reopen fact | Dataset restore | **Full state restore** |

## Khi nào chọn

- Consolidation/dream-cycle có thể gây regression (mất fact)
- Migration/schema change cần safety net
- Muốn audit "memory đổi gì sau consolidation?"
- Kết hợp lifecycle.ts (snapshot trước consolidate) + dream-cycle (snapshot trước) + 333 data-versioning (pattern); design snapshot retention (keep N recent)
