# Hướng LB: Knowledge Conflict Merge — giải xung đột khi gộp facts mâu thuẫn

> **Nguồn gốc:** "Truth maintenance systems" (Doyle 1979); belief revision (AGM 1985); "multi-source knowledge fusion"; entity resolution / record linkage; CRDT merge; "temporal freshness"
> **Coupling:** 🟡 — chạm memory store + ingest pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory + embed dedup sẵn — thiếu conflict detection + resolution policy + provenance)
> **Effort:** 3-4 tuần

## Nguồn gốc

Belief revision (AGM 1985): framework cập nhật belief khi gặp info mới mâu thuẫn — **keep consistency**. Truth maintenance systems (Doyle): track *why* a fact is believed + auto-retract khi dependency bị bác. Knowledge fusion: gộp facts từ nhiều nguồn → xung đột → giải bằng **provenance** (nguồn đáng tin hơn), **freshness** (mới hơn wins), **vote** (đa số). Record linkage: hai record về cùng entity nhưng khác giá trị → merge. CRDT: merge không xung đột (last-write-wins / prefer). Cốt lõi: **không ghi đổng blindly** — khi fact mới mâu thuẫn fact cũ, cần chính sách giải (provenance / freshness / vote / ask).

## Mô tả

mya conflict merge: khi ingest fact mới (LA 313) → phát hiện mâu thuẫn với KB hiện có → resolve theo policy. Detection: cùng subject/entity nhưng predicate khác (entity A: "version=2" vs "version=3"). Resolution: (1) **freshness** — newer timestamp wins; (2) **provenance** — higher-trust source wins; (3) **vote** — đa số; (4) **flag** — không tự giải, đánh dấu conflict để user/agent quyết. Lưu provenance (source, time, confidence) cho mỗi fact → audit. Nối LA (313) incremental-kb, 165 dedup (gần object = merge, khác giá trị = conflict).

## Kiến trúc

```
  NEW FACT: "project uses TypeScript 5.3"
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  CONFLICT DETECT (entity match + predicate diff)     │
  │  existing: "project uses TypeScript 5.0"             │
  │  same subject "project TS version", DIFFERENT value  │
  └──────────────────┬───────────────────────────────────┘
                     │ conflict!
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌────────────────────────────┐  ┌─────────────────────┐
  │ AUTO-RESOLVE POLICIES      │  │ FLAG (human/agent)  │
  │ · freshness: newer wins    │  │ store both + mark   │
  │ · provenance: trust wins   │  │ "CONFLICT" → ask    │
  │ · vote: majority wins      │  │ later (328)         │
  └────────────┬───────────────┘  └─────────────────────┘
               ▼
  ┌──────────────────────────────────────────────────────┐
  │  MERGE + PROVENANCE                                  │
  │  fact { value, source, time, confidence, superseded }│
  │  old fact → marked superseded (not deleted — audit)  │
  └──────────────────────────────────────────────────────┘
```

```
mya: memory + embed dedup sẵn — thiếu conflict detect + resolution policy + provenance track
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 165 memory-dedup — detect same object (near embed)
// ✅ LA (313) incremental-kb — ingest pipeline (documented)
// ✅ packages/memory — fact store (sẵn)

// ❌ THIẾU: conflict detection (same entity, different value)
// ❌ THIẾU: resolution policy (freshness / provenance / vote / flag)
// ❌ THIẾU: provenance (source, time, confidence per fact)
// ❌ THIẾU: supersede tracking (old fact not deleted — audit)
```

## Implementation

```typescript
// packages/memory/src/conflict.ts (NEW)
interface Fact {
  id: string;
  subject: string;    // entity key
  predicate: string;  // attribute
  value: string;
  source: string;
  timestamp: number;
  confidence: number;
  supersededBy?: string;
}

type Resolution = "freshness" | "provenance" | "vote" | "flag";

export class ConflictResolver {
  constructor(private policy: Resolution) {}

  resolve(existing: Fact, incoming: Fact): { winner: Fact; loser: Fact } | { conflict: true } {
    if (existing.subject !== incoming.subject || existing.predicate !== incoming.predicate) {
      return { winner: incoming, loser: existing }; // not a conflict, both kept
    }
    // Same subject+predicate, different value → conflict
    switch (this.policy) {
      case "freshness":
        return incoming.timestamp >= existing.timestamp
          ? { winner: incoming, loser: existing }
          : { winner: existing, loser: incoming };
      case "provenance":
        return incoming.confidence > existing.confidence
          ? { winner: incoming, loser: existing }
          : { winner: existing, loser: incoming };
      case "flag":
        return { conflict: true }; // mark — ask later (328 deferred-questions)
      default:
        return { conflict: true };
    }
  }

  merge(existing: Fact, incoming: Fact): Fact[] {
    const result = this.resolve(existing, incoming);
    if ("conflict" in result) {
      // store both, flag conflict
      return [{ ...incoming, id: incoming.id }, { ...existing }];
    }
    // mark loser superseded (keep for audit — do NOT delete)
    result.loser.supersededBy = result.winner.id;
    return [result.winner, result.loser];
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ KB consistent (AGM belief revision) | ❌ Conflict detection cost (entity match) |
| ✅ Provenance — audit được (source, time) | ❌ Policy chọn sai → mất fact đúng |
| ✅ Không mất dữ liệu (supersede, không xóa) | ❌ Flag accumulation (unresolved conflicts pile) |
| ✅ Trust-based merge (provenance ranking) | ❌ Provenance metadata overhead |

## Khác các hướng gần

| | 165 Dedup | LA (313) Incremental KB | LB: Conflict Merge |
|---|---|---|---|
| Khi trùng | Merge (giống nhau) | Add hoặc merge | **Khác giá trị → resolve** |
| Policy | Cosine merge | Dedup-on-insert | **Freshness/provenance/vote/flag** |
| Audit | ❌ | Version tag | **✅ supersede + provenance** |

## Khi nào chọn

- KB nhận facts từ nhiều nguồn (agent, user, doc) — dễ mâu thuẫn
- Cần consistency (AGM) — không giữ belief mâu thuẫn
- Cần audit (ai ghi gì, khi nào, override gì)
- Nối LA (313) incremental-kb + 165 dedup + 328 deferred-questions (flag conflicts)
