# Hướng OW: Knowledge Kind Typology — phân biệt take/fact/belief/bet/hunch, query+criticality khác

> **Nguồn gốc:** gbrain (knowledge kind taxonomy); "take / fact / belief / bet / hunch distinction"; "epistemic kind classification"; "different query + criticality per kind"; "uncertainty-aware knowledge representation"
> **Coupling:** 🟡 — thêm knowledge-kind classifier + per-kind query/criticality
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (confidence-scoring + memory-store sẵn — chưa có epistemic-kind typology)
> **Effort:** 3 tuần

## Nguồn gốc

**gbrain** phân knowledge thành **5 kind** khác nhau về **nguồn gốc + độ chắc chắn**: (1) **Fact** — verified,客观 ("API trả 200"). (2) **Take** — opinion/distillation ("codebase dùng pattern X tốt"). (3) **Belief** — assumption chưa verify ("user có vẻ thích X"). (4) **Bet** — dự đoán có rủi ro ("chức năng Y sẽ cần tháng sau"). (5) **Hunch** — linh cảm mờ, low-confidence ("có vẻ module Z sắp break"). Mỗi kind có **criticality + query treatment** khác: fact → trusted; belief → flagged; hunch → low-priority. Nguyên tắc: **không phải mọi knowledge đều như nhau** — typology theo *epistemic kind* giúp query đúng độ tin. Khác **352 MN confidence-scoring** — OW là **categorical kind** (không phải numeric score); khác **411 OU hot-cold** — OW phân theo **loại tri thức** không phải nhiệt độ.

## Mô tả

mya knowledge kind typology: (1) **Classify** mỗi knowledge entry → kind (fact/take/belief/bet/hunch). (2) **Per-kind query**: filter/rank theo kind (vd query chỉ lấy facts). (3) **Per-kind criticality**: fact high-trust, belief flagged, hunch low-priority. mya có `352 MN confidence` — OW thêm **categorical kind typology** + **per-kind treatment**.

## Kiến trúc

```
  ┌─── KNOWLEDGE KIND TYPOLOGY ────────────────────────┐
  │                                                     │
  │  KIND     │ SOURCE        │ TRUST  │ CRITICALITY    │
  │  ──────── │ ───────────── │ ────── │ ────────────── │
  │  FACT     │ verified obs  │ HIGH   │ trusted, flag ✅│
  │  TAKE     │ distillation  │ MED    │ useful, note   │
  │  BELIEF   │ assumption    │ LOW    │ flagged ⚠️      │
  │  BET      │ prediction    │ RISK   │ risky, monitor │
  │  HUNCH    │ gut feeling   │ V.LOW  │ low-priority   │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  QUERY: "auth module ổn định không?"
        │
        ▼
  ┌─── PER-KIND QUERY (filter + rank) ─────────────────┐
  │  FACT:  "auth.test.ts pass 50/50"     → trusted ✅  │
  │  TAKE:  "auth module ổn định 2 tuần"  → useful      │
  │  BELIEF: "có vẻ auth sắp refactor"    → flagged ⚠️  │
  │  HUNCH: "linh cảm auth sẽ break"      → low-priority│
  │                                                     │
  │  → LLM thấy FACT tin cậy + BELIEF flagged           │
  │    → quyết định cân nhắc đúng độ tin                │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 352 MN confidence-scoring — numeric score (nền — OW = categorical kind trên score)
// ✅ 355 MQ provenance — source trace (nền — OW kind dựa source)
// ✅ 411 OU hot-cold-tiers — tier (nền — OW orthogonal: kind vs temperature)
// ✅ 224 HP knowledge-editing — edit facts (nền — OW = fact subset)

// ❌ THIẾU: knowledge-kind classifier (entry → fact/take/belief/bet/hunch)
// ❌ THIẾU: per-kind query filter + rank
// ❌ THIẾU: per-kind criticality (trust/flag/low-priority)
```

## Implementation

```typescript
// packages/agent/src/memory/knowledge-kind.ts (MỚI)
type KnowledgeKind = 'fact' | 'take' | 'belief' | 'bet' | 'hunch';

interface KnowledgeEntry {
  text: string;
  kind: KnowledgeKind;
  confidence: number;
  evidence?: string;
}

const KIND_META: Record<KnowledgeKind, { trust: number; label: string; flag: string }> = {
  fact:   { trust: 1.0, label: '✅ FACT',    flag: 'trusted' },
  take:   { trust: 0.7, label: '📖 TAKE',    flag: 'useful' },
  belief: { trust: 0.4, label: '⚠️ BELIEF',  flag: 'flagged' },
  bet:    { trust: 0.3, label: '🎲 BET',     flag: 'risky' },
  hunch:  { trust: 0.1, label: '💭 HUNCH',   flag: 'low-priority' },
};

class KnowledgeKindStore {
  private entries: KnowledgeEntry[] = [];

  add(entry: KnowledgeEntry): void {
    this.entries.push(entry);
  }

  // Classify text → kind (simple heuristic; real uses LLM)
  classify(text: string): KnowledgeKind {
    if (/verified|pass \d+\/\d+|returns?\s+\d{3}|measured|tested/i.test(text)) return 'fact';
    if (/seems like|likely|probably|appears/i.test(text)) return 'belief';
    if (/will|predict|expect|bet|risk/i.test(text)) return 'bet';
    if (/gut|hunch|feel like|intuition/i.test(text)) return 'hunch';
    return 'take';  // default distillation
  }

  // Query with per-kind filter + rank
  query(filter: string, kinds?: KnowledgeKind[]): { entry: KnowledgeEntry; meta: typeof KIND_META[KnowledgeKind] }[] {
    const allowed = kinds ?? ['fact', 'take', 'belief', 'bet', 'hunch'];
    return this.entries
      .filter(e => e.text.includes(filter) && allowed.includes(e.kind))
      .sort((a, b) => KIND_META[b.kind].trust - KIND_META[a.kind].trust)  // high-trust first
      .map(e => ({ entry: e, meta: KIND_META[e.kind] }));
  }
}

// Usage:
// const store = new KnowledgeKindStore();
// store.add({ text: 'auth.test.ts pass 50/50', kind: 'fact', confidence: 0.95 });
// store.add({ text: 'có vẻ auth sắp refactor', kind: 'belief', confidence: 0.4 });
// const results = store.query('auth', ['fact', 'belief']);
//   → FACT (trusted) first, BELIEF (flagged) second
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân biệt độ tin (fact vs hunch rõ) | ❌ Classifier miss (text mơ hồ → kind sai) |
| ✅ Query per-kind (chỉ fact, hoặc include belief) | ❌ Kind overlap (fact ↔ take ranh giới mờ) |
| ✅ Criticality rõ (trust/flag/low-priority) | ❌ 5 kind overhead (phức tạp hơn 1 score) |
| ✅ Nối 352 MN (numeric + categorical) | ❌ LLM classify cost (gọi LLM mỗi entry) |

## Khác các hướng gần

| | 352 MN Confidence | 411 OU Hot-Cold | 355 MQ Provenance | OW: Knowledge-Kind |
|---|---|---|---|---|
| Cái gì | Numeric score | Temperature tier | Source trace | **Categorical kind** |
| Axis | 0-1 | hot/cold | origin | **fact/take/belief/bet/hunch** |
| Query | Rank score | Hot first | Filter source | **Filter + rank kind** |
| Criticality | ❌ (number) | ❌ | ❌ | ✅ trust/flag |

## Khi nào chọn

- Cần phân biệt fact verified vs guess/hunch
- Query cần filter theo độ tin (chỉ facts, exclude hunches)
- Muốn LLM biết criticality (trust fact, flag belief)
- Nối 352 MN confidence-scoring (numeric base) + 355 MQ provenance (kind from source) + 411 OU hot-cold (orthogonal axis); guard classifier accuracy (LLM + heuristic) + kind overlap
