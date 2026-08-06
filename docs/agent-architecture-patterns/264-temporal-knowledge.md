# Hướng JD: Temporal Knowledge — fact gắn thời gian, biết khi nào đúng

> **Nguồn gốc:** "Temporal Knowledge Graphs" (TKG); Time-Aware RAG; YAGO/DBpedia temporal; "TimeML"; Wikidata time-qualified facts; "BiTemporality" (Martin Fowler)
> **Coupling:** 🟡 — chạm memory store + RAG retrieval
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory store + core.time sẵn — thiếu time-qualified facts + validity range)
> **Effort:** 3-4 tuần

## Nguồn gốc

Temporal knowledge: **mỗi fact gắn khoảng thời gian valid** — "Obama là tổng thống [2009-2017]", không phải fact vĩnh viễn. Temporal Knowledge Graphs (TKG): edge có `valid_from`/`valid_to`. TimeML: markup language cho thời gian trong text. YAGO: time-qualified facts. Fowler "BiTemporality": 2 trục thời gian — (1) **valid time** (khi fact đúng thực tế), (2) **transaction time** (khi fact được ghi vào DB). Ví dụ: "lương employee là X valid từ 1/1, ghi vào DB 3/1" — valid-time ≠ transaction-time. Time-aware RAG: retrieval xét thời gian — hỏi "CEO của Apple năm 2010?" → fact có valid range chứa 2010.

## Mô tả

mya temporal knowledge: mỗi fact trong memory có `validFrom`/`validTo` + `recordedAt`. Khi agent retrieve fact → lọc theo thời gian truy vấn. Fact hết hạn (validTo < now) → flag stale, không tin mù. Ví dụ: "API key endpoint là X [valid: 2024-01 → 2024-06]" — sau 06/2024 fact stale. Nối core.time (single time helper) — tất cả timestamp qua core.time (testable). Nối HV (230) event-sourcing: event = temporal fact, replay rebuild state-at-time. Nối 224 knowledge-editing: edit = close old fact (validTo), open new (validFrom).

## Kiến trúc

```
  MEMORY STORE (time-qualified facts)
  ┌──────────────────────────────────────────────────────┐
  │ fact              │ validFrom  │ validTo   │ recorded │
  │ "CEO: Tim Cook"   │ 2011-08     │ ∞         │ 2011-08  │
  │ "API: v2"         │ 2024-01     │ 2024-06   │ 2024-01  │
  │ "API: v3"         │ 2024-06     │ ∞         │ 2024-06  │ ← 224 edit
  │ "price: $99"      │ 2024-03     │ 2024-09   │ 2024-03  │
  └──────────────────────────────────────────────────────┘
  QUERY: "API version in March 2024?"
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  TIME-AWARE RETRIEVAL: validFrom<=T AND validTo>T    │
  │  → "API: v2" (01→06) ✓ | NOT v3 (starts 06)          │
  └──────────────────────────────────────────────────────┘

  FACT EXPIRED? (validTo < now) → flag stale → re-verify
```

```
mya: memory store + core.time sẵn — thiếu: validFrom/validTo columns + time-aware retrieval + stale detection
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ memory store — fact storage (sẵn)
// ✅ core.time / natives.time — single time helper (sẵn)
// ✅ 224 knowledge-editing — update facts (documented)
// ✅ HV (230) event-sourcing — event = temporal (documented)
// ✅ 136 time-travel-debug — replay to point T (documented)

// ❌ THIẾU: validFrom/validTo on facts (time qualification)
// ❌ THIẾU: time-aware retrieval (filter by query time)
// ❌ THIẾU: stale detection (fact past validTo → flag)
// ❌ THIẾU: bi-temporal (valid-time vs transaction-time)
```

## Implementation

```typescript
// packages/memory/src/temporal.ts (NEW)
import { core } from "@my-agent/core"; // single time helper

interface TemporalFact {
  id: string;
  fact: string;
  validFrom: number;  // valid-time start
  validTo: number;    // valid-time end (∞ = Infinity)
  recordedAt: number; // transaction-time
  source?: string;
}

export class TemporalMemory {
  constructor(private db: Database) {}

  // Record fact with validity range (uses core.time — testable)
  record(fact: string, validFrom?: number, validTo = Infinity): void {
    const now = core.time.now();
    this.db.prepare(
      "INSERT INTO t_facts (id, fact, validFrom, validTo, recordedAt) VALUES (?,?,?,?,?)"
    ).run(crypto.randomUUID(), fact, validFrom ?? now, validTo, now);
  }

  // Edit = close old fact + open new (224 knowledge-editing)
  supersede(oldId: string, newFact: string): void {
    const now = core.time.now();
    this.db.prepare("UPDATE t_facts SET validTo=? WHERE id=?").run(now, oldId); // close old
    this.record(newFact, now); // open new from now
  }

  // Time-aware retrieval: facts valid AT query time
  query(topic: string, atTime?: number): TemporalFact[] {
    const t = atTime ?? core.time.now();
    return this.db.prepare(
      `SELECT * FROM t_facts WHERE fact LIKE ? AND validFrom <= ? AND validTo > ? ORDER BY recordedAt DESC`
    ).all(`%${topic}%`, t, t) as TemporalFact[];
  }

  // Detect stale facts (past validTo)
  stale(): TemporalFact[] {
    const now = core.time.now();
    return this.db.prepare("SELECT * FROM t_facts WHERE validTo < ? AND validTo != ?")
      .all(now, Infinity) as TemporalFact[];
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fact đúng theo thời gian (TKG — không tin fact cũ) | ❌ Storage overhead (validFrom/validTo per fact) |
| ✅ Bi-temporal (Fowler — valid vs transaction time) | ❌ Stale detection + re-verify cost |
| ✅ Time-aware RAG — query theo mốc thời gian | ❌ Fact expiry logic complexity |
| ✅ Nối 224 edit (supersede) + 136 time-travel | ❌ ∞ sentinel handling |

## Khác các hướng gần

| | Memory Store (current) | 224 Knowledge-Edit | JD: Temporal Knowledge |
|---|---|---|---|
| Thời gian | ❌ (fact vĩnh viễn) | ❌ (overwrite) | **✅ validFrom/validTo** |
| Query | keyword | keyword | **time-filtered** |
| Stale | ❌ | ❌ | ✅ detect |

## Khi nào chọn

- Fact thay đổi theo thời gian (price, API, personnel, policy)
- Cần trả lời "X lúc nào" (time-aware query)
- Fact có thể stale → cần flag/re-verify
- Nối core.time + 224 edit + HV (230) event-store + 136 time-travel
