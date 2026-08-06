# Hướng PP: Agent Prompt Cache-Miss Attribution — quy gán cacheRead/cacheWrite token vào session stats, biết miss

> **Nguồn gốc:** pi (core/cost.ts — cacheRead 50% input, types.ts cacheRead field; ai/pi-ai-bridge.ts — usage.cacheRead); pi-session-manager (trace.ts — cache_read/cache_write aggregate, extractUsage); "prompt cache attribution"; "cache hit/miss tracking"; "token cost attribution"; "cacheRead billing"
> **Coupling:** 🟢 — thêm cacheRead/cacheWrite tracking vào session stats + cost computation
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cacheRead field + cost.ts 50% rule sẵn — chưa có miss detection + per-session attribution trong mya agent)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**pi** (`packages/core/src/cost.ts`, `types.ts`, `packages/ai/src/pi-ai-bridge.ts`) track **prompt cache** trong usage: `cacheRead` (token đọc từ cache — billed 50% input) và `cacheWrite` (token ghi vào cache). `pi-ai-bridge.ts` extract `usage.cacheRead` từ provider response → propagate vào session. `pi-session-manager/trace.ts` (`extractUsage`) aggregate `cache_read` + `cache_write` per model + per session → `SessionTraceAnalytics.total_tokens.cache_read`. Nguyên tắc attribution: **cacheRead = cache HIT** (prefix reused — cheap), **cacheWrite = cache MISS** (new prefix written — expensive first time). Nếu `cacheRead` cao + `cacheWrite` thấp → **cache hiệu quả** (prefix stable). Nếu `cacheWrite` cao + `cacheRead` thấp → **cache miss** (prefix unstable — đổi system prompt/tools mỗi turn). Agent biết mình **đang cache hit hay miss** → optimize prompt stability (90 prompt-caching). Khác **90 prompt-caching** (caching strategy) — PP là **attribution/tracking** (biết hit/miss).

## Mô tả

mya agent prompt cache-miss attribution: mỗi LLM response → **attribute cacheRead/cacheWrite** vào session stats — (1) **Extract**: `usage.cacheRead` + `usage.cacheWrite` từ provider response (pi-ai-bridge). (2) **Aggregate**: per-turn + per-session + per-model — `totalTokens.cache_read` + `totalTokens.cache_write`. (3) **Cost**: `cacheRead` billed 50% input (cheaper), `cacheWrite` billed full (expensive first write). (4) **Miss detection**: ratio `cacheWrite / (cacheRead + cacheWrite)` — cao = miss (prefix unstable), thấp = hit (prefix stable). Agent biết **cache hiệu quả hay không** → adjust prompt stability (stable system prompt, stable tool order). mya có cost.ts + types — PP thêm **per-session attribution + miss detection + ratio reporting**.

## Kiến trúc

```
  LLM RESPONSE (provider → session):
  {
    usage: {
      input: 1000,        ← fresh tokens (not cached)
      output: 500,
      cacheRead: 8000,    ← cache HIT (prefix reused — 50% input cost)
      cacheWrite: 2000,   ← cache MISS (new prefix written — full cost)
    }
  }
        │
        ▼
  ┌─── EXTRACT (pi-ai-bridge) ───────────────────────────┐
  │  usage.cacheRead → 8000                                │
  │  usage.cacheWrite → 2000                               │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── AGGREGATE (per session + per model) ──────────────┐
  │  totalTokens: {                                        │
  │    input: 1000, output: 500,                           │
  │    cache_read: 8000,   ← cumulative HIT                │
  │    cache_write: 2000,  ← cumulative MISS               │
  │    total: 11500                                        │
  │  }                                                     │
  │  costByModel: {                                        │
  │    "gpt-4o": {                                         │
  │      cache_read: $0.006  (8000 × $1.5/1M × 0.5)        │
  │      cache_write: $0.009 (2000 × $4.5/1M)              │
  │    }                                                   │
  │  }                                                     │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── MISS DETECTION ───────────────────────────────────┐
  │  cacheRatio = cacheRead / (cacheRead + cacheWrite)     │
  │  = 8000 / 10000 = 0.80 → 80% HIT (efficient ✅)        │
  │                                                         │
  │  if ratio < 0.3 → MISS HEAVY (prefix unstable)         │
  │    → agent should stabilize prompt (90 prompt-caching) │
  │  if ratio > 0.7 → HIT HEAVY (prefix stable ✅)         │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/cost.ts — cacheRead 50% input billing (nền — PP = attribution on top)
// ✅ packages/core/src/types.ts — cacheRead field in Usage (nền)
// ✅ packages/ai/src/pi-ai-bridge.ts — usage.cacheRead extraction (nền)
// ✅ 90 prompt-caching — caching strategy (nền — PP = tracking/attribution)

// ❌ THIẾU: per-session cacheRead/cacheWrite aggregate (cumulative tracking)
// ❌ THIẾU: miss detection (cacheWrite/(cacheRead+cacheWrite) ratio)
// ❌ THIẾU: ratio reporting (agent knows cache efficiency)
// ❌ THIẾU: cost attribution per model (cache_read/cache_write separate cost)
```

## Implementation

```typescript
// packages/agent/src/cache-attribution.ts (MỚI)
interface Usage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface SessionCacheStats {
  totalCacheRead: number;    // cumulative HIT tokens
  totalCacheWrite: number;   // cumulative MISS tokens
  perModel: Map<string, { cacheRead: number; cacheWrite: number; costSaved: number }>;
  history: Array<{ turn: number; cacheRead: number; cacheWrite: number; ratio: number }>;
}

class CacheAttribution {
  private stats: SessionCacheStats = {
    totalCacheRead: 0,
    totalCacheWrite: 0,
    perModel: new Map(),
    history: [],
  };
  private turn = 0;

  // Record usage from LLM response
  record(usage: Usage, model: string, inputCostPer1M: number): void {
    this.turn++;
    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;

    this.stats.totalCacheRead += cacheRead;
    this.stats.totalCacheWrite += cacheWrite;

    // Per-model tracking
    const modelStats = this.stats.perModel.get(model) ?? { cacheRead: 0, cacheWrite: 0, costSaved: 0 };
    modelStats.cacheRead += cacheRead;
    modelStats.cacheWrite += cacheWrite;
    // Cost saved: cacheRead billed 50% vs full input → saved 50% of input cost
    modelStats.costSaved += (cacheRead / 1_000_000) * inputCostPer1M * 0.5;
    this.stats.perModel.set(model, modelStats);

    // History (per-turn ratio)
    const ratio = cacheRead + cacheWrite > 0
      ? cacheRead / (cacheRead + cacheWrite)
      : 0;
    this.stats.history.push({ turn: this.turn, cacheRead, cacheWrite, ratio });
  }

  // Cache efficiency ratio (0-1): high = good (mostly hits)
  getCacheHitRatio(): number {
    const total = this.stats.totalCacheRead + this.stats.totalCacheWrite;
    return total > 0 ? this.stats.totalCacheRead / total : 0;
  }

  // Is cache efficient? (> 0.7 = stable prefix, < 0.3 = unstable)
  isCacheEfficient(): boolean {
    return this.getCacheHitRatio() > 0.7;
  }

  // Report for agent self-awareness
  report(): string {
    const ratio = this.getCacheHitRatio();
    const pct = Math.round(ratio * 100);
    if (ratio > 0.7) return `Cache efficient (${pct}% hit) — prefix stable ✅`;
    if (ratio < 0.3) return `Cache inefficient (${pct}% hit) — prefix unstable, stabilize prompt (see #90)`;
    return `Cache moderate (${pct}% hit)`;
  }

  // Cost saved by caching (vs no-cache)
  getTotalCostSaved(): number {
    return [...this.stats.perModel.values()].reduce((sum, m) => sum + m.costSaved, 0);
  }
}

// Usage:
// attribution.record(usage, "gpt-4o", 2.50);
// console.log(attribution.report()); // "Cache efficient (80% hit)"
// if (!attribution.isCacheEfficient()) → stabilize prompt (90 prompt-caching)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cache visibility (agent biết hit/miss ratio — self-aware) | ❌ Provider inconsistency (cacheRead/cacheWrite không phải provider nào cũng report) |
| ✅ Cost saving tracking (biết tiết kiệm bao nhiêu nhờ cache) | ❌ Attribution granularity (per-turn ratio có thể noisy) |
| ✅ Miss detection (ratio thấp → alert stabilize prompt) | ❌ Cold start (turn đầu luôn miss — ratio thấp ban đầu) |
| ✅ Per-model breakdown (biết model nào cache tốt hơn) | ❌ Cache invalidation (prefix đổi nhẹ → full miss, ratio spike) |

## Khác các hướng gần

| | 90 Prompt-Caching | PP: Cache-Miss-Attribution |
|---|---|---|
| Cái gì | Caching strategy | **Tracking + attribution** |
| Hit/miss | Optimizes for hit | **Measures hit/miss** |
| Ratio | ❌ | ✅ cacheRead/(cacheRead+cacheWrite) |
| Feedback | ❌ | ✅ agent self-adjusts |

## Khi nào chọn

- Muốn agent biết cache hiệu quả (hit ratio — self-aware optimization)
- Muốn track cost saving (cacheRead billed cheaper → biết tiết kiệm)
- Muốn miss detection (ratio thấp → alert stabilize prompt)
- Nối 90 prompt-caching (PP = measurement layer, 90 = strategy layer) + cost.ts (PP = cache attribution on cost); guard provider inconsistency (not all providers report cacheRead — fallback unknown)
