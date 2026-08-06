# Hướng OU: Hot-Cold Epistemic Tiers — tầng hot extracted-events → cold takes, query ưu tiên nóng

> **Nguồn gốc:** gbrain (hot/cold epistemic layers); "hot extracted events → cold distilled takes"; "recency-tiered knowledge retrieval"; "epistemic temperature tiers"; "prioritize fresh signal over stale opinion"
> **Coupling:** 🟡 — thêm tiered-epistemic store + recency-priority query
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (hierarchical-memory + decay sẵn — chưa có epistemic hot/cold tier distinction)
> **Effort:** 3 tuần

## Nguồn gốc

**gbrain** phân knowledge thành **2 tầng epistemic**: (1) **Hot** — *extracted events* (raw observation mới, high-fidelity, gần đây: "user vừa nói X", "tool vừa fail Y"). (2) **Cold** — *takes* (opinion/distillation tổng hợp từ nhiều event: "user có xu hướng Z"). Hot = **fact gần, tin cậy cao**; Cold = **opinion xa, tổng hợp, cần verify**. Query **ưu tiên hot** (recency + fidelity) — chỉ fallback cold khi hot trống. Nguyên tắc: **sự kiện tươi > ý kiến cũ** — tier theo *epistemic temperature* (không chỉ thời gian). Khác **165 FI hierarchical** — OU là **epistemic tier** (event vs take); khác **354 MP attention-decay** — OU phân theo **loại tri thức** không chỉ access frequency.

## Mô tả

mya hot-cold epistemic tiers: (1) **Hot store** — extracted events (raw, recent, high-fidelity). (2) **Cold store** — distilled takes (opinion, older, summarized). (3) **Query priority**: search hot trước → nếu đủ → return; nếu hot trống/thiếu → fallback cold. (4) **Promotion**: hot event cũ → promote cold take (consolidation). mya có `165 FI hierarchical` + `354 MP decay` — OU thêm **epistemic-tier distinction** + **priority query**.

## Kiến trúc

```
  ┌─── HOT TIER (extracted events) ────────────────────┐
  │  · "user vừa hỏi về auth bug"        (ts: now-2m)  │
  │  · "tool read_file fail ENOENT"      (ts: now-5m)  │
  │  · "test auth.test.ts pass 50/50"    (ts: now-10m) │
  │  HIGH FIDELITY · RECENT · RAW FACT                   │
  └───────────────────────┬─────────────────────────────┘
                          │
                          │  (old events → promote to cold)
                          ▼
  ┌─── COLD TIER (distilled takes) ────────────────────┐
  │  · "user thường hỏi về auth module"  (distilled)   │
  │  · "auth.test.ts ổn định 2 tuần"     (summarized)  │
  │  · "codebase dùng OAuth2"            (belief)       │
  │  LOWER FIDELITY · OLDER · OPINION/BELIEF            │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── QUERY (priority: hot first) ────────────────────┐
  │  search "auth bug":                                 │
  │    1. HOT → "user vừa hỏi về auth bug" (HIT)        │
  │    2. (hot đủ → return, skip cold)                  │
  │                                                     │
  │  search "codebase architecture":                    │
  │    1. HOT → (empty / stale)                         │
  │    2. COLD → "codebase dùng OAuth2" (fallback HIT)  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 165 FI hierarchical-memory — tier structure (nền — OU = epistemic tiers)
// ✅ 354 MP attention-decay — decay old (nền — OU promotion hot→cold)
// ✅ 356 MR time-aware-retrieval — recency rank (nền — OU priority)
// ✅ 358 execution-trace-world-modeling — events (nền — OU hot source)

// ❌ THIẾU: epistemic tier distinction (hot event vs cold take)
// ❌ THIẾU: priority query (hot first → cold fallback)
// ❌ THIẾU: promotion pipeline (old hot → cold distilled)
```

## Implementation

```typescript
// packages/agent/src/memory/epistemic-tiers.ts (MỚI)
interface EpistemicEntry {
  text: string;
  timestamp: number;
  kind: 'event' | 'take';
  fidelity: number;  // 0-1, event=high, take=lower
}

class HotColdTiers {
  private hot: EpistemicEntry[] = [];   // events — recent, raw
  private cold: EpistemicEntry[] = [];  // takes — distilled, older

  // Add event → hot tier
  addEvent(text: string): void {
    this.hot.push({ text, timestamp: Date.now(), kind: 'event', fidelity: 0.95 });
  }

  // Query: hot first, cold fallback
  search(query: string): EpistemicEntry[] {
    const hotHits = this.hot.filter(e => e.text.includes(query));
    if (hotHits.length >= 3) return hotHits;  // hot enough → return
    // fallback: add cold
    const coldHits = this.cold.filter(e => e.text.includes(query));
    return [...hotHits, ...coldHits];
  }

  // Promotion: old hot events → distill → cold takes
  promote(maxHotAgeMs = 3_600_000, distill: (events: EpistemicEntry[]) => string): void {
    const cutoff = Date.now() - maxHotAgeMs;
    const stale = this.hot.filter(e => e.timestamp < cutoff);
    if (stale.length === 0) return;
    const take = distill(stale);  // summarize events → take
    this.cold.push({ text: take, timestamp: Date.now(), kind: 'take', fidelity: 0.6 });
    this.hot = this.hot.filter(e => e.timestamp >= cutoff);  // evict promoted
  }
}

// Usage:
// const tiers = new HotColdTiers();
// tiers.addEvent('user vừa hỏi về auth bug');
// tiers.promote(3600_000, distillLLM);  // old events → cold take
// const results = tiers.search('auth');  // hot first → cold fallback
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fact tươi ưu tiên (high-fidelity, gần) | ❌ Hot store phình (nếu không promote đều) |
| ✅ Cold fallback (take khi hot trống) | ❌ Distill quality (LLM tóm tắt sai → cold rác) |
| ✅ Epistemic rõ (event vs take) | ❌ Promotion tuning (khi nào hot→cold) |
| ✅ Nối 354 MP (decay) + 358 events | ❌ Tier boundary mơ hồ (event vs take overlap) |

## Khác các hướng gần

| | 165 FI Hierarchical | 354 MP Attention-Decay | 356 MR Time-Aware | OU: Hot-Cold-Tiers |
|---|---|---|---|---|
| Cái gì | Memory phân cấp | Decay theo access | Rank theo time | **Epistemic event/take** |
| Tier | working/episodic/... | importance | recency | **hot/cold temperature** |
| Query | Search | Evict | Re-rank | **Hot first → cold** |
| Distill | ❌ | ❌ | ❌ | ✅ promote |

## Khi nào chọn

- Cần phân biệt fact tươi (event) vs ý kiến cũ (take)
- Query ưu tiên recency + fidelity (fact gần tin hơn)
- Có pipeline distill (event cũ → take tổng hợp)
- Nối 354 MP attention-decay (evict) + 358 execution-trace (event source) + 412 OV dream-cycle (promotion trigger); guard distill quality + promotion tuning
