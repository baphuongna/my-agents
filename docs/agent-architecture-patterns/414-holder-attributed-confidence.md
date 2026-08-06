# Hướng OX: Holder Attributed Confidence — take gắn holder + emotional estimation, query theo confidence

> **Nguồn gốc:** gbrain (holder-attributed takes); "take carries holder identity + emotional estimation"; "attributed confidence per holder"; "query by holder confidence level"; "subjective confidence attribution"
> **Coupling:** 🟡 — thêm holder-attribute + emotional-estimation field trên knowledge entries
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (confidence-scoring + provenance sẵn — chưa có holder + emotional attribution)
> **Effort:** 2-3 tuần

## Nguồn gốc

**gbrain** mỗi **take** (opinion) gắn **holder** (ai nêu take — user, agent, team) + **emotional estimation** (mức độ cảm xúc/certain: "rất chắc" / "hơi nghi"). Take không khách quan — **confidence phụ thuộc holder**. Vd user A nói "auth ổn" với confidence cao, agent nói "auth sắp break" với confidence thấp. Query theo **holder + confidence**: "cho take về auth từ user A, confidence cao". Nguyên tắc: **opinion có chủ** — không merge takes từ holders khác nhau ngầm; confidence là **subjective attribution** không phải客观 metric. Khác **352 MN confidence** — OX là **holder-attributed** (không phải global); khác **417 PA per-identity** — OX là **per-take holder** (không phải per-store partition).

## Mô tả

mya holder attributed confidence: (1) **Holder field** — mỗi take gắn holder (user/agent/team id). (2) **Emotional estimation** — mức cảm xúc/certainty (high/med/low). (3) **Query by holder+confidence** — filter take theo holder + confidence threshold. (4) **No silent merge** — takes từ holders khác nhau giữ riêng. mya có `352 MN confidence` + `355 MQ provenance` — OX thêm **holder** + **emotional estimation**.

## Kiến trúc

```
  TAKE STORE (holder-attributed):
  ┌──────────────────────────────────────────────────────┐
  │  take              │ holder   │ emotion │ confidence │
  │  ───────────────── │ ──────── │ ─────── │ ────────── │
  │  "auth ổn định"    │ user-A   │ 😤 HIGH │ 0.9        │
  │  "auth sắp break"  │ agent    │ 😟 LOW  │ 0.3        │
  │  "refactor cần thiết"│ team-1 │ 🙂 MED  │ 0.6        │
  └──────────────────────┬───────────────────────────────┘
                          │
                          ▼
  QUERY: "take về auth, confidence cao, từ user-A"
        │
        ▼
  ┌─── FILTER: holder=user-A, confidence ≥ 0.7 ────────┐
  │  → "auth ổn định" (holder-A, conf 0.9, emotion HIGH)│
  │                                                     │
  │  (agent's "auth sắp break" EXCLUDED — different     │
  │   holder, low confidence)                           │
  │  → không merge take holders khác nhau ngầm          │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 352 MN confidence-scoring — numeric confidence (nền — OX = holder-attributed version)
// ✅ 355 MQ provenance — source trace (nền — OX holder = provenance actor)
// ✅ 149 delegated-agent-identity — identity (nền — OX holder = identity)
// ✅ 413 OW knowledge-kind — take subset (nền — OX = take + holder)

// ❌ THIẾU: holder field trên take (who said it)
// ❌ THIẕU: emotional estimation (certainty level)
// ❌ THIẕU: query by holder + confidence filter
// ❌ THIẕU: no-silent-merge guard (holders kept separate)
```

## Implementation

```typescript
// packages/agent/src/memory/holder-attributed.ts (MỚI)
type Emotion = 'high' | 'med' | 'low';  // certainty estimation

interface AttributedTake {
  text: string;
  holder: string;          // user-A / agent / team-1
  emotion: Emotion;        // subjective certainty
  confidence: number;      // 0-1
  timestamp: number;
}

const EMOTION_WEIGHT: Record<Emotion, number> = { high: 0.9, med: 0.6, low: 0.3 };

class HolderAttributedStore {
  private takes: AttributedTake[] = [];

  add(take: AttributedTake): void {
    // confidence derived partly from emotion if not explicit
    if (take.confidence === undefined) take.confidence = EMOTION_WEIGHT[take.emotion];
    this.takes.push(take);
  }

  // Query by holder + confidence threshold
  query(
    filter: string,
    opts: { holder?: string; minConfidence?: number } = {},
  ): AttributedTake[] {
    const { holder, minConfidence = 0 } = opts;
    return this.takes
      .filter(t => t.text.includes(filter))
      .filter(t => holder ? t.holder === holder : true)
      .filter(t => t.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  // All takes from a holder (no cross-holder merge)
  byHolder(holderId: string): AttributedTake[] {
    return this.takes.filter(t => t.holder === holderId);
  }

  // Conflict detection — same topic, different holders, conflicting
  conflicts(filter: string): { holders: string[]; takes: AttributedTake[] }[] {
    const matches = this.takes.filter(t => t.text.includes(filter));
    const byHolder = new Map<string, AttributedTake[]>();
    for (const t of matches) {
      if (!byHolder.has(t.holder)) byHolder.set(t.holder, []);
      byHolder.get(t.holder)!.push(t);
    }
    return [...byHolder.entries()].map(([h, ts]) => ({ holders: [h], takes: ts }));
  }
}

// Usage:
// const store = new HolderAttributedStore();
// store.add({ text: 'auth ổn định', holder: 'user-A', emotion: 'high', confidence: 0.9, timestamp: Date.now() });
// store.add({ text: 'auth sắp break', holder: 'agent', emotion: 'low', confidence: 0.3, timestamp: Date.now() });
// const hi = store.query('auth', { holder: 'user-A', minConfidence: 0.7 });
//   → ["auth ổn định"] (agent's take excluded)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Opinion có chủ (không merge ngầm holders khác nhau) | ❌ Store phình (mỗi holder take riêng) |
| ✅ Query theo holder+confidence (chính xác) | ❌ Emotional estimation subjective (khó quantify) |
| ✅ Conflict detection (holders trái nhau) | ❌ Holder ID maintenance (track identity) |
| ✅ Nối 149 identity + 352 confidence | ❌ Low-confidence noise (giữ take conf thấp → rác) |

## Khác các hướng gần

| | 352 MN Confidence | 355 MQ Provenance | 413 OW Knowledge-Kind | OX: Holder-Attributed |
|---|---|---|---|---|
| Cái gì | Numeric score | Source trace | Kind type | **Holder + emotion** |
| Subjective | ❌ global | ❌ origin | ❌ kind | ✅ per-holder |
| Merge | Implicit | ❌ | ❌ | ✅ no silent merge |
| Query | Rank score | Filter source | Filter kind | **Filter holder+conf** |

## Khi nào chọn

- Opinion cần gắn chủ (ai nói, certainty bao nhiêu)
- Muốn query theo holder + confidence (chỉ take từ user A, high-confidence)
- Tránh merge takes trái chiều từ holders khác nhau
- Nối 149 delegated-agent-identity (holder = identity) + 352 MN confidence (base) + 314 LB conflict-merge (resolve cross-holder); guard emotional subjectivity + low-confidence noise
