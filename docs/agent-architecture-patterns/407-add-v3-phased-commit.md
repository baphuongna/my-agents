# Hướng OQ: Add v3 Phased Commit — pipeline add phase: extract → dedup → entity-link + confidence gate

> **Nguồn gốc:** mem0 v3 (add pipeline phases); "extract → consolidate → update entity store"; "LLM extraction with confidence"; "entity-link confidence gate"; "phased commit memory pipeline"
> **Coupling:** 🟡 — thêm phased-commit pipeline thay thế single-step add
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory-add + entity-extraction sẵn — chưa có phased pipeline + confidence gate)
> **Effort:** 3-4 tuần

## Nguồn gốc

**mem0 v3** redesign pipeline add thành **nhiều phase** thay vì 1 bước: (1) **Extract** — LLM trích fact/entity từ raw input. (2) **Dedup** — check similarity với existing (→ 406 OP). (3) **Entity-link** — link entity mới với entity-store (resolve ambiguity: "JS" → "JavaScript"). Mỗi phase có **confidence gate**: nếu LLM extract confidence thấp → **reject** hoặc **flag for review** (không ghi memory rác). Nguyên tắc: **add memory cần validation từng phase** — không ghi mọi thứ LLM output. Khác **351 append-only** — OQ là **phased validation pipeline**; khác **406 OP near-dup-GC** — OQ là **toàn bộ pipeline** (extract + dedup + entity-link + confidence).

## Mô tả

mya add v3 phased commit: thay single-step add bằng pipeline: (1) **Extract** — LLM trích fact + entity từ input (output structured). (2) **Confidence gate** — nếu extract confidence < threshold → reject/flag. (3) **Dedup** — near-dup check (→ 406 OP) → update/link/new. (4) **Entity-link** — resolve entity → entity-store (link relation). (5) **Commit** — ghi memory + entity-link vào store. Mỗi phase atomic — fail → rollback. mya có `351 append-only` + `355 provenance` — OQ thêm **phased pipeline** + **confidence gate**.

## Kiến trúc

```
  RAW INPUT: "Anh thích sushi vì tươi, ghét cay"
        │
        ▼
  ┌─── PHASE 1: EXTRACT (LLM) ─────────────────────────┐
  │  facts:                                             │
  │    {fact: "user likes sushi", confidence: 0.92}     │
  │    {fact: "user dislikes spicy", confidence: 0.88}  │
  │  entities: [sushi, spicy]                           │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 2: CONFIDENCE GATE ───────────────────────┐
  │  fact1 conf=0.92 ≥ 0.7? → PASS                      │
  │  fact2 conf=0.88 ≥ 0.7? → PASS                      │
  │  (fact conf < 0.7 → REJECT / flag review)           │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 3: DEDUP (→ 406 OP) ──────────────────────┐
  │  fact1 nearest = "user likes sushi" sim=0.95 → UPDATE │
  │  fact2 nearest = none > 0.5 → ADD NEW               │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 4: ENTITY-LINK ───────────────────────────┐
  │  sushi → entity-store: link to "Japanese cuisine"   │
  │  spicy → new entity, link relation "dislikes"       │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── PHASE 5: COMMIT (atomic) ───────────────────────┐
  │  write memory + entity-links → store                │
  │  (any phase fail → rollback, no partial write)      │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 351 append-only-memory — memory add (nền — OQ = phased version)
// ✅ 355 MQ provenance — source trace (nền — OQ tracks phase)
// ✅ 352 MN confidence-scoring — confidence (nền — OQ gate)
// ✅ 406 OP near-dup-gc — dedup phase (nền — OQ phase 3)

// ❌ THIẾU: phased pipeline (extract → dedup → entity-link → commit)
// ❌ THIẾU: confidence gate (reject/flag low-confidence extract)
// ❌ THIẾU: entity-link resolution (entity → store link)
// ❌ THIẾU: atomic commit + rollback (phase fail → no partial)
```

## Implementation

```typescript
// packages/agent/src/memory/phased-add.ts (MỚI)
interface ExtractedFact {
  fact: string;
  confidence: number;
  entities: string[];
}

type PhaseResult = { ok: true } | { ok: false; reason: string; phase: string };

class PhasedAddPipeline {
  constructor(
    private extractLLM: (input: string) => Promise<ExtractedFact[]>,
    private dedup: (fact: string) => 'update' | 'link' | 'new',
    private entityStore: Map<string, string[]>,  // entity → related
    private minConfidence = 0.7,
  ) {}

  async add(rawInput: string): Promise<PhaseResult> {
    // PHASE 1: Extract
    const facts = await this.extractLLM(rawInput);
    if (facts.length === 0) return { ok: false, reason: 'no facts extracted', phase: 'extract' };

    // PHASE 2: Confidence gate
    const passed = facts.filter(f => f.confidence >= this.minConfidence);
    if (passed.length === 0) {
      return { ok: false, reason: 'all facts below confidence threshold', phase: 'confidence' };
    }

    // PHASE 3 + 4 + 5: Dedup → entity-link → commit (atomic)
    const staged: string[] = [];
    try {
      for (const fact of passed) {
        // PHASE 3: Dedup
        const action = this.dedup(fact.fact);
        // PHASE 4: Entity-link
        for (const entity of fact.entities) {
          if (!this.entityStore.has(entity)) this.entityStore.set(entity, []);
        }
        // PHASE 5: Stage commit
        staged.push(`${action}: ${fact.fact} [conf=${fact.confidence}]`);
      }
      // commit all (atomic — if any throw, rollback)
      staged.forEach(s => {/* write to store */});
    } catch (e) {
      // rollback staged
      return { ok: false, reason: `commit failed: ${(e as Error).message}`, phase: 'commit' };
    }

    return { ok: true };
  }
}

// Usage:
// const pipeline = new PhasedAddPipeline(extractLLM, dedupFn, entityStore, 0.7);
// const result = await pipeline.add("Anh thích sushi vì tươi");
// if (!result.ok) → log rejected phase + reason
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Memory chất lượng (confidence gate reject rác) | ❌ Pipeline overhead (5 phase mỗi add) |
| ✅ Entity-link tự động (relation phong phú) | ❌ LLM extract cost (gọi LLM mỗi add) |
| ✅ Atomic commit (fail → rollback, no partial) | ❌ Phase fail cascades (1 fail → reject all) |
| ✅ Nối 406 OP (dedup phase) + 352 MN (conf) | ❌ Cold pipeline tuning (threshold/confidence) |

## Khác các hướng gần

| | 351 Append-Only | 406 OP Near-Dup-GC | 352 MN Confidence | OQ: Add-v3-Phased |
|---|---|---|---|---|
| Cái gì | ADD-only memory | Dedup gate | Confidence score | **5-phase pipeline** |
| Phase | 1 (add) | 1 (dedup) | 1 (score) | **5 (extract→commit)** |
| Gate | ❌ | similarity | confidence | **confidence + dedup + entity** |
| Atomic | ✅ | ❌ | ❌ | ✅ rollback |

## Khi nào chọn

- Muốn memory chất lượng cao (reject low-confidence + rác)
- Cần entity-link tự động (relation giữa entities)
- Add phải atomic (không partial write khi fail)
- Nối 406 OP near-dup-gc (phase 3) + 352 MN confidence-scoring (phase 2 gate) + 355 MQ provenance (phase trace); guard LLM cost (batch extract) + pipeline latency
