# Hướng OY: Time-Travel Snapshot Query — hỏi trạng thái tri thức ở thời điểm T

> **Nguồn gốc:** gbrain (time-travel knowledge query); "snapshot knowledge state at time T"; "historical knowledge reconstruction"; "as-of query for memory"; "point-in-time epistemic state"
> **Coupling:** 🟡 — thêm timestamped snapshot + as-of query layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory-state-versioning + temporal-knowledge sẵn — chưa có as-of snapshot query)
> **Effort:** 3-4 tuần

## Nguồn gốc

**gbrain** hỗ trợ **time-travel query**: hỏi "tri thức ở thời điểm T là gì?" Hệ thống **reconstruct** snapshot memory state tại T — chỉ trả facts/takes **đã tồn tại** tại T (loại facts thêm sau T, restore facts xóa trước T). Vd "Tuần trước agent nghĩ gì về auth module?" → snapshot tại T=tuần-trước → facts tại thời điểm đó (chưa biết fix bug #142 vì fix sau T). Nguyên tắc: **tri thức có lịch sử** — query "as-of T" reconstruct đúng trạng thái lúc đó. Khác **353 MO state-versioning** — OY là **as-of query** (reconstruct at T); khác **264 JD temporal-knowledge** — OY reconstruct **toàn bộ state** (không chỉ fact có time).

## Mô tả

mya time-travel snapshot query: (1) **Timestamped log** — mỗi knowledge change (add/update/delete) gắn timestamp. (2) **As-of reconstruction** — query(T) → reconstruct state tại T (apply changes ≤ T). (3) **Snapshot cache** — cache reconstructed states (giảm cost). mya có `353 MO state-versioning` + `264 JD temporal` — OY thêm **as-of query** + **snapshot reconstruction**.

## Kiến trúc

```
  TIMELINE (knowledge changes, append-only log):
  ┌──────────────────────────────────────────────────────┐
  │  T1: ADD    "auth dùng OAuth2"        (fact)         │
  │  T2: ADD    "auth.test pass 30/30"    (fact)         │
  │  T3: UPDATE "auth.test pass 50/50"    (fact updated) │
  │  T4: DELETE "auth dùng session-cookie"(old, removed) │
  │  T5: ADD    "auth bug #142 fixed"     (fact)         │
  └──────────────────────┬───────────────────────────────┘
                          │
                          │ QUERY: "tri thức lúc T3?"
                          ▼
  ┌─── AS-OF RECONSTRUCTION (at T3) ────────────────────┐
  │  apply changes T1→T3:                                │
  │    "auth dùng OAuth2"        ✅ (added T1)           │
  │    "auth.test pass 50/50"    ✅ (updated T3)         │
  │    "auth dùng session-cookie" ✅ (still exists,      │
  │       deleted at T4 > T3 → exists at T3)            │
  │    "auth bug #142 fixed"     ❌ (added T5 > T3)      │
  │  → snapshot state at T3                              │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 353 MO state-versioning — snapshot/rollback (nền — OY = as-of query on versions)
// ✅ 264 JD temporal-knowledge — fact có time (nền — OY reconstruct all)
// ✅ 242 IH memory-rollback — undo (nền — OY = read-only as-of)
// ✅ 351 append-only — change log (nền — OY log source)

// ❌ THIẾU: as-of query (reconstruct state at T)
// ❌ THIẕU: timestamped change log (add/update/delete + ts)
// ❌ THIẕU: snapshot reconstruction engine (apply changes ≤ T)
// ❌ THIẕU: snapshot cache (avoid re-reconstruction)
```

## Implementation

```typescript
// packages/agent/src/memory/time-travel-query.ts (MỚI)
type ChangeOp = 'add' | 'update' | 'delete';

interface KnowledgeChange {
  key: string;       // fact id
  text: string;
  op: ChangeOp;
  ts: number;
}

class TimeTravelQuery {
  private log: KnowledgeChange[] = [];
  private cache = new Map<number, Map<string, string>>();  // T → snapshot

  record(change: KnowledgeChange): void {
    this.log.push(change);
    this.log.sort((a, b) => a.ts - b.ts);
    this.cache.clear();  // invalidate cache
  }

  // Reconstruct knowledge state at time T
  asOf(T: number): Map<string, string> {
    // check cache
    const cached = this.cache.get(T);
    if (cached) return cached;

    // apply changes ≤ T in order
    const state = new Map<string, string>();
    for (const c of this.log) {
      if (c.ts > T) break;
      switch (c.op) {
        case 'add':
        case 'update':
          state.set(c.key, c.text);
          break;
        case 'delete':
          state.delete(c.key);
          break;
      }
    }
    this.cache.set(T, state);
    return state;
  }

  // Query: what did we know about X at time T?
  queryAt(topic: string, T: number): string[] {
    const state = this.asOf(T);
    return [...state.values()].filter(text => text.includes(topic));
  }

  // Diff: what changed between T1 and T2?
  diff(T1: number, T2: number): { added: string[]; removed: string[] } {
    const s1 = this.asOf(T1);
    const s2 = this.asOf(T2);
    const added = [...s2.entries()].filter(([k]) => !s1.has(k)).map(([, v]) => v);
    const removed = [...s1.entries()].filter(([k]) => !s2.has(k)).map(([, v]) => v);
    return { added, removed };
  }
}

// Usage:
// const tt = new TimeTravelQuery();
// tt.record({ key: 'auth-oauth', text: 'auth dùng OAuth2', op: 'add', ts: T1 });
// tt.record({ key: 'bug142', text: 'auth bug #142 fixed', op: 'add', ts: T5 });
// const atT3 = tt.asOf(T3);           // snapshot before bug142
// const before = tt.queryAt('auth', T3);  // → facts about auth at T3
// const d = tt.diff(T1, T5);          // → { added: [...], removed: [...] }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Reconstruct lịch sử tri thức (as-of T) | ❌ Log phình (mỗi change = 1 entry) |
| ✅ Debug "lúc đó biết gì" (audit) | ❌ Reconstruction cost (replay ≤ T) |
| ✅ Diff giữa 2 thời điểm | ❌ Cache invalidation (new change → clear cache) |
| ✅ Nối 353 MO (versions) + 264 JD (temporal) | ❌ Storage (append-only log không compact) |

## Khác các hướng gần

| | 353 MO State-Versioning | 264 JD Temporal-Knowledge | 242 IH Memory-Rollback | OY: Time-Travel-Query |
|---|---|---|---|---|
| Cái gì | Snapshot/rollback | Fact có time | Undo | **As-of reconstruct** |
| Granularity | Full state | Per fact | Last state | **Any T** |
| Query | Version N | Time on fact | Rollback | **State at T** |
| Diff | ❌ | ❌ | ❌ | ✅ T1→T2 |

## Khi nào chọn

- Cần biết "lúc T agent biết gì" (debug/audit)
- Muốn reconstruct lịch sử tri thức (fact thêm/xóa theo time)
- Cần diff giữa 2 thời điểm
- Nối 353 MO memory-state-versioning (snapshot base) + 264 JD temporal-knowledge (fact time) + 242 IH memory-rollback; guard log growth (compact old) + reconstruction cost (snapshot cache)
