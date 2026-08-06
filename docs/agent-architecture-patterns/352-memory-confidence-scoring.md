# Hướng MN: Memory Confidence Scoring — điểm tin cậy + vòng đời cho từng memory entry

> **Nguồn gốc:** agentmemory (confidence + lifecycle per memory); Karpathy "LLM wiki" (every memory has confidence, decays if uncorroborated); "Bayesian belief updating"; "evidence accumulation"; "corroboration gating"
> **Coupling:** 🟡 — thêm confidence field + lifecycle state machine vào memory entry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (lifecycle.ts + weibull.ts + conflict.ts sẵn — chưa có per-entry confidence + state machine)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Karpathy "LLM wiki"**: mỗi memory entry có **confidence score** (0-1) — mức độ chắc chắn. Confidence **tăng** khi corroborated (thấy lại, xác nhận bởi source khác), **giảm** khi stale (không gặp lại) hoặc **contradicted** (fact mới mâu thuẫn). **agentmemory**: mỗi entry qua **vòng đời** states: `tentative → corroborated → established → stale → archived`. Corroboration gating: chỉ khi 2+ source xác nhận → promoted lên `established`. Nguyên tắc: **memory không tin mù** — mỗi entry có độ chắc chắn + trạng thái, agent biết "fact này chắc bao nhiêu?". Khác **354 decay** (strength theo thời gian) — MN là **confidence theo corroboration**; khác **352** (self — MN chính là 352); khác **349 gap-analysis** (report gap) — MN **score** từng entry.

## Mô tả

mya memory confidence scoring: mỗi memory entry có `confidence` (0-1) + `lifecycleState` (tentative/corroborated/established/stale/archived). (1) **New observation** → confidence khởi đầu thấp (tentative). (2) **Corroborated** (thấy lại/source khác) → confidence tăng, promote state. (3) **Contradicted** → confidence giảm. (4) **Stale** (không corroborate lâu) → decay → archive. Retrieval ưu tiên entry high-confidence. Nối lifecycle.ts (decay/purge sẵn), weibull.ts (per-type decay), conflict.ts (contradiction → reduce). Karpathy insight: wiki-like — "cần trích nguồn cho claim" = corroboration.

## Kiến trúc

```
  NEW OBSERVATION → confidence: 0.3 (TENTATIVE)
        │
        │  CORROBORATED (source 2 thấy lại)
        ▼
  confidence: 0.6 (CORROBORATED) ── again ──▶ 0.85 (ESTABLISHED)
        │                                          │
        │  CONTRADICTED (fact mới mâu thuẫn)        │ STALE (no corroboration)
        ▼                                          ▼
  confidence: 0.3                              confidence ↓ → ARCHIVED
        │
        ▼
  RETRIEVAL: rank by confidence — established > corroborated > tentative
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/lifecycle.ts — decay/purge/consolidate (nền lifecycle)
// ✅ packages/memory/src/weibull.ts — per-type Weibull decay (nền decay curve)
// ✅ packages/memory/src/conflict.ts — contradiction detection (reduce confidence)
// ✅ packages/memory/src/grounding.ts — grounding (source alignment)
// ✅ 354 MP decay — strength theo thời gian (MN là confidence theo corroboration)
// ✅ 349 MK gap-analysis — report (MN là score per-entry)

// ❌ THIẾU: confidence field (0-1) per memory entry
// ❌ THIẾU: lifecycle state machine (tentative→corroborated→established→stale→archived)
// ❌ THIẾU: corroboration gating (2+ source → promote)
// ❌ THIẾU: retrieval rank by confidence
```

## Implementation

```typescript
// packages/memory/src/confidence.ts (NEW)
type MemoryState = 'tentative' | 'corroborated' | 'established' | 'stale' | 'archived';

interface ScoredMemory {
  id: string;
  content: string;
  confidence: number;     // 0-1
  state: MemoryState;
  sources: Set<string>;   // corroboration sources
  lastCorroborated: number;
}

class ConfidenceManager {
  private thresholdEstablished = 0.75;
  private staleDays = 30;

  // New observation — tentative, low confidence
  record(entry: ScoredMemory): void { entry.confidence = 0.3; entry.state = 'tentative'; }

  // Corroborate — source confirms again → boost
  corroborate(entry: ScoredMemory, source: string): void {
    if (!entry.sources.has(source)) {
      entry.sources.add(source);
      entry.confidence = Math.min(1, entry.confidence + 0.3);
      entry.lastCorroborated = Date.now();
    }
    if (entry.confidence >= this.thresholdEstablished && entry.sources.size >= 2)
      entry.state = 'established';
    else if (entry.sources.size >= 1)
      entry.state = 'corroborated';
  }

  // Contradict — new conflicting fact → reduce
  contradict(entry: ScoredMemory): void {
    entry.confidence = Math.max(0, entry.confidence - 0.4);
    if (entry.confidence < 0.2) entry.state = 'stale';
  }

  // Tick — decay stale entries (nối weibull.ts)
  tick(entries: ScoredMemory[]): void {
    const staleMs = this.staleDays * 86_400_000;
    for (const e of entries) {
      if (Date.now() - e.lastCorroborated > staleMs) {
        e.confidence *= 0.7;  // decay (nối weibull per-type)
        if (e.confidence < 0.1) e.state = 'archived';
      }
    }
  }

  // Retrieve — rank by confidence (established first)
  rank(entries: ScoredMemory[], limit: number): ScoredMemory[] {
    return entries.filter(e => e.state !== 'archived')
      .sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent biết độ chắc mỗi fact (Karpathy wiki) | ❌ Confidence tuning (thresholds) |
| ✅ Corroboration → trust build (Bayesian) | ❌ False corroboration (same source twice) |
| ✅ Contradiction → trust reduce (conflict.ts) | ❌ Stale decay có thể mất fact đúng |
| ✅ Retrieval ưu tiên high-confidence | ❌ State machine complexity |

## Khác các hướng gần

| | 354 MP Decay | lifecycle.ts | 349 MK Gap Analysis | MN: Confidence |
|---|---|---|---|---|
| Cái gì | Strength ↓ thời gian | Purge/consolidate | Report gap | **Score per-entry** |
| Corroborate | ❌ | ❌ | ❌ | **✅ boost** |
| State machine | ❌ | ❌ | ❌ | **✅ tentative→established** |

## Khi nào chọn

- Memory có facts từ nhiều nguồn (cần corroboration)
- Muốn agent biết "độ chắc" mỗi fact (không tin mù)
- Facts có thể stale/contradict (project info đổi)
- Kết hợp lifecycle.ts (purge) + weibull.ts (decay curve) + conflict.ts (contradict) + 354 decay; tune corroboration thresholds
