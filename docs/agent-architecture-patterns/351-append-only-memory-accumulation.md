# Hướng MM: Append-Only Memory Accumulation — memory bất biến ADD-only, facts tích lũy + entity linking + temporal

> **Nguồn gốc:** mem0 (append-only memory — facts tích lũy, không ghi đè); "event sourcing" (append log, current state = replay); "immutable ledger"; "entity linking" (NER → graph node); "temporal reasoning" (fact gắn thời gian); Datomic immutable DB
> **Coupling:** 🟡 — memory store chuyển sang append-only model
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory store + graph + lifecycle sẵn — chưa có append-only no-overwrite invariant)
> **Effort:** 3-4 tuần

## Nguồn gốc

**mem0**: memory **bất biến** — mỗi fact mới **ADD** vào, không bao giờ **ghi đè** hoặc **xóa**. Khi fact đổi (VD "user lives in Hanoi" → "user moved to Saigon") → ADD fact mới + link temporal (fact cũ vẫn còn, đánh dấu `validTo`). **Entity linking**: fact liên kết entity (person, project) trong graph — "user" node + "lives_in" edge temporal. **Event sourcing**: current state = replay tất cả append (fact mới nhất = current). Nguyên tắc: **ghi lại lịch sử, không xóa** — mọi thay đổi là append + temporal edge, query hỏi "hiện tại" = fact mới nhất có `validTo = null`. Khác **lifecycle.ts** (purge/dedupe/supersede — *mutable*) — MM **bất biến** (giữ all history); khác **353 versioning** (snapshot toàn state) — MM **per-fact temporal**.

## Mô tả

mya append-only memory: memory store thành **append-only** — không `UPDATE`/`DELETE`, chỉ `INSERT`. Mỗi fact có `validFrom` + `validTo` (null = current). Khi fact đổi → INSERT fact mới + `UPDATE validTo` fact cũ (chỉ đóng interval, không xóa content). Entity linking: fact → entity node (graph.ts) + temporal edge. Query "current" = fact `validTo IS NULL`. Query "history" = tất cả fact theo `validFrom`. Nối 88 hybrid-graph (entity/edge), 264 temporal-knowledge (time-aware edge), 353 versioning (full-state snapshot). mya có lifecycle.ts (consolidate) — MM bổ sung **immutable accumulation layer** phía dưới.

## Kiến trúc

```
  NEW FACT: "user moved to Saigon"
       │
       ▼
  ┌─── APPEND-ONLY STORE ──────────────────────┐
  │                                            │
  │  1. CLOSE OLD:                             │
  │     UPDATE facts SET validTo = now         │
  │     WHERE entity='user' AND key='city'     │
  │       AND validTo IS NULL                  │
  │     (fact cũ "Hanoi" — không xóa, chỉ đóng)│
  │                                            │
  │  2. APPEND NEW:                            │
  │     INSERT (entity='user', key='city',     │
  │       value='Saigon', validFrom=now,       │
  │       validTo=NULL)                        │
  │                                            │
  │  3. ENTITY LINK:                           │
  │     edge(user) ──temporal──▶ city('Saigon')│
  └──────────────────┬─────────────────────────┘
                     │
                     ▼
  ┌─── QUERY ───────────────────────────────────┐
  │  CURRENT:  WHERE validTo IS NULL → Saigon   │
  │  HISTORY:  ORDER BY validFrom → Hanoi→Saigon│
  │  AT TIME:  WHERE validFrom ≤ T < validTo    │
  └─────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/brain-store.ts — memory store (nền — cần append-only mode)
// ✅ packages/memory/src/graph.ts — entity/edge graph (entity linking)
// ✅ packages/memory/src/lifecycle.ts — consolidate/purge (MM bổ sung immutable)
// ✅ 88 CJ hybrid-graph-vector — temporal edge (nền)
// ✅ 264 temporal-knowledge — time-aware fact (nền temporal)
// ✅ 353 MO versioning — snapshot (khác: MO full-state, MM per-fact)

// ❌ THIẾU: append-only invariant (no UPDATE/DELETE content)
// ❌ THIẾU: validFrom/validTo temporal interval per fact
// ❌ THIẾU: entity linking (fact → graph node + temporal edge)
// ❌ THIẾU: temporal query (current / history / at-time)
```

## Implementation

```typescript
// packages/memory/src/append-memory.ts (NEW)
interface AppendFact {
  id: string;
  entity: string;      // entity node (VD "user", "project:X")
  key: string;         // attribute (VD "city", "status")
  value: string;
  validFrom: number;
  validTo: number | null;  // null = current
  source: string;
}

class AppendOnlyMemory {
  private facts: AppendFact[] = [];

  // ADD new fact — close old, append new (never delete content)
  add(entity: string, key: string, value: string, source: string): void {
    const now = Date.now();
    // 1. Close existing current fact(s) — temporal interval
    for (const f of this.facts)
      if (f.entity === entity && f.key === key && f.validTo === null)
        f.validTo = now;
    // 2. Append new (immutable)
    this.facts.push({
      id: crypto.randomUUID(), entity, key, value, validFrom: now, validTo: null, source,
    });
  }

  // Query current state (validTo IS NULL = active)
  current(entity: string, key?: string): AppendFact[] {
    return this.facts.filter(f =>
      f.entity === entity && f.validTo === null && (key ? f.key === key : true));
  }

  // Query history (all facts for entity, chronological)
  history(entity: string): AppendFact[] {
    return this.facts.filter(f => f.entity === entity).sort((a, b) => a.validFrom - b.validFrom);
  }

  // Point-in-time query — what was true at time T?
  atTime(entity: string, key: string, t: number): AppendFact | undefined {
    return this.facts.find(f =>
      f.entity === entity && f.key === key && f.validFrom <= t && (f.validTo === null || t < f.validTo));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lịch sử đầy đủ — không mất fact cũ (mem0 event sourcing) | ❌ Storage growth (append-only, không xóa) |
| ✅ Point-in-time query ("user ở đâu tháng trước?") | ❌ Query phức tạp (temporal interval) |
| ✅ Audit trail tự nhiên (mọi thay đổi logged) | ❌ Dedup phức tạp (same fact re-appended) |
| ✅ Rollback dễ (close fact → reopen old) | ❌ Conflict khi 2 fact mới cùng validFrom |

## Khác các hướng gần

| | lifecycle.ts (mutable) | 353 MO Versioning | MM: Append-Only |
|---|---|---|---|
| Model | Update/delete | Full snapshot | **Per-fact temporal interval** |
| History | ❌ (purged) | ✅ snapshot | **✅ per-fact** |
| Granularity | Entry | Whole state | **Single fact** |

## Khi nào chọn

- Cần lịch sử fact theo thời gian ("đã thay đổi gì, khi nào?")
- Audit/compliance (không được xóa data)
- Entity thay đổi trạng thái (user profile, project status)
- Kết hợp 88 hybrid-graph (entity linking) + 264 temporal (edge) + 353 versioning (full snapshot); design retention (archive old facts)
