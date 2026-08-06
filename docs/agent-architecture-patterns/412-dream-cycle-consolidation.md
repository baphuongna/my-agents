# Hướng OV: Dream Cycle Consolidation — vòng định kỳ: tưới facts, build KG, giảm tải cold layers

> **Nguồn gốc:** gbrain (dream cycle); "periodic offline consolidation"; "irrigate facts → build knowledge graph"; "reduce cold layer load"; "background memory consolidation cycle"
> **Coupling:** 🟡 — thêm scheduled consolidation meta-loop (offline background)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (scheduled-agents + memory-store sẵn — chưa có dream-cycle consolidation)
> **Effort:** 3-4 tuần

## Nguồn gốc

**gbrain** có **dream cycle** — vòng định kỳ chạy **offline (background)** để **consolidate** memory: (1) **Irrigate facts** — review raw events → extract/confirm facts → "tưới" (strengthen) fact tin cậy. (2) **Build KG** — từ facts → build/update knowledge graph (entity relation). (3) **Reduce cold layers** — compress/dedupe cold tier (→ 411 OU), evict stale → giảm tải. Nguyên tắc: **memory cần "ngủ" để consolidate** — như não người ngủ để củng cố ký ức. Chạy định kỳ (mỗi N giờ / idle). Khác **411 OU hot-cold-tiers** — OV là **consolidation meta-loop** (drive promotion); khác **148 scheduled-agents** — OV là **memory consolidation** (không phải task agent).

## Mô tả

mya dream cycle consolidation: (1) **Schedule** — chạy định kỳ (idle / mỗi N giờ). (2) **Irrigate** — scan events → extract/confirm facts → strengthen confidence. (3) **Build KG** — facts → entity-relation graph update. (4) **Reduce cold** — compress/dedupe cold tier → giảm tải. (5) **Report** — log consolidation stats. mya có `148 scheduled-agents` + `411 OU tiers` — OV thêm **dream-cycle consolidation**.

## Kiến trúc

```
  ┌─── DREAM CYCLE (scheduled / idle trigger) ─────────┐
  │  every N hours OR agent idle                        │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 1: IRRIGATE FACTS ────────────────────────┐
  │  scan raw events (hot tier):                        │
  │    · event: "auth.test.ts pass 50/50" (x5 lần)      │
  │    → IRRIGATE: strengthen fact "auth.test.ts ổn định"│
  │    · event: "user hỏi về OAuth" (x3 lần)            │
  │    → IRRIGATE: strengthen fact "user quan tâm OAuth" │
  │  (facts có nhiều event → confidence tăng)            │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 2: BUILD KNOWLEDGE GRAPH ─────────────────┐
  │  facts → entity-relation:                           │
  │    [auth.test.ts] ──tests──► [auth module]          │
  │    [auth module] ──uses──► [OAuth2]                 │
  │    [user] ──interested-in──► [OAuth2]               │
  │  (graph update — relation mới / strengthen)         │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 3: REDUCE COLD LAYERS ────────────────────┐
  │  cold tier: compress / dedupe / evict               │
  │    · merge "auth ổn định" x3 → 1 take               │
  │    · evict stale (no access > 30 ngày)              │
  │  → cold tier nhẹ hơn, query nhanh hơn               │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
              CONSOLIDATION COMPLETE (report stats)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 148 scheduled-agents — periodic agents (nền — OV = scheduled consolidation)
// ✅ 411 OU hot-cold-tiers — tier structure (nền — OV consolidates tiers)
// ✅ 348 MJ AST-KG — knowledge graph (nền — OV builds KG)
// ✅ 312 KZ retention-policy — evict (nền — OV reduces cold)
// ✅ 406 OP near-dup-gc — dedup (nền — OV dedup cold)

// ❌ THIẾU: dream-cycle scheduler (periodic / idle trigger)
// ❌ THIẾU: fact irrigation (strengthen confidence from events)
// ❌ THIẾU: KG build from facts (entity-relation update)
// ❌ THIẾU: cold reduction (compress/dedupe/evict)
```

## Implementation

```typescript
// packages/agent/src/memory/dream-cycle.ts (MỚI)
interface Fact {
  text: string;
  confidence: number;
  evidence: number;  // event count supporting
}

interface EntityRelation {
  from: string; to: string; relation: string; weight: number;
}

class DreamCycle {
  constructor(
    private facts: Map<string, Fact>,
    private kg: EntityRelation[],
    private cold: { text: string; lastAccess: number }[],
    private idleThresholdMs = 600_000,  // trigger if idle 10 min
  ) {}

  // Run full consolidation cycle
  consolidate(events: { text: string; ts: number }[]): { irrigated: number; kgEdges: number; evicted: number } {
    // PHASE 1: Irrigate facts
    const irrigated = this.irrigateFacts(events);
    // PHASE 2: Build KG
    const kgEdges = this.buildKG();
    // PHASE 3: Reduce cold
    const evicted = this.reduceCold();
    return { irrigated, kgEdges, evicted };
  }

  private irrigateFacts(events: { text: string; ts: number }[]): number {
    let count = 0;
    for (const ev of events) {
      // find matching fact, strengthen
      for (const fact of this.facts.values()) {
        if (ev.text.includes(fact.text.slice(0, 20))) {
          fact.evidence += 1;
          fact.confidence = Math.min(1, fact.confidence + 0.05);  // irrigate
          count++;
        }
      }
    }
    return count;
  }

  private buildKG(): number {
    // derive relations from facts (simplified)
    const before = this.kg.length;
    for (const fact of this.facts.values()) {
      // extract entities + relation (placeholder — real uses NER)
      // this.kg.push({ from, to, relation, weight: fact.confidence });
    }
    return this.kg.length - before;
  }

  private reduceCold(): number {
    const cutoff = Date.now() - 30 * 86_400_000;  // 30 days
    const before = this.cold.length;
    this.cold = this.cold.filter(c => c.lastAccess > cutoff);  // evict stale
    // dedupe (→ 406 OP)
    return before - this.cold.length;
  }
}

// Usage (scheduled via 148):
// const dream = new DreamCycle(facts, kg, cold);
// setInterval(() => dream.consolidate(recentEvents), 3_600_000);  // hourly
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Facts củng cố (confidence tăng từ evidence) | ❌ Consolidation latency (cycle chạy lâu) |
| ✅ KG tự build (relation phong phú) | ❌ Idle detection miss (chạy giữa task → gián đoạn) |
| ✅ Cold nhẹ (evict/compress → query nhanh) | ❌ Irrigation noise (event yếu → fact sai strengthen) |
| ✅ Nối 411 OU (drive promotion) + 348 KG | ❌ Resource spike (cycle dùng CPU/API) |

## Khác các hướng gần

| | 148 Scheduled-Agents | 411 OU Hot-Cold-Tiers | 312 KZ Retention | OV: Dream-Cycle |
|---|---|---|---|---|
| Cái gì | Periodic agents | Tier structure | Evict policy | **Consolidation meta-loop** |
| Trigger | Schedule | Query | Time | **Periodic + idle** |
| Irrigate | ❌ | ❌ | ❌ | ✅ strengthen facts |
| Build KG | ❌ | ❌ | ❌ | ✅ from facts |

## Khi nào chọn

- Memory tích lũy nhiều (cần consolidate định kỳ)
- Muốn facts tự củng cố (evidence → confidence)
- Cần KG tự build + cold nhẹ
- Nối 148 scheduled-agents (trigger) + 411 OU hot-cold-tiers (consolidate tiers) + 348 MJ AST-KG (KG) + 312 KZ retention (evict); guard resource spike (throttle) + idle detection (chỉ chạy khi thực sự idle)
