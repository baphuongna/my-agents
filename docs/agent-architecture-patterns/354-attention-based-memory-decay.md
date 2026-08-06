# Hướng MP: Attention-Based Memory Decay — decay Ebbinghaus, truy cập nhiều mạnh lên, evict theo importance

> **Nguồn gốc:** agentmemory (Ebbinghaus forgetting curve + importance-weighted eviction); "spaced repetition" (Anki — revisiting strengthens memory); "attention as memory"; "importance scoring"; "recency × frequency × relevance"; "LRU with importance boost"
> **Coupling:** 🟡 — thêm access tracking + importance scoring vào memory lifecycle
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (lifecycle.ts Ebbinghaus decay + weibull.ts + retention sẵn — chưa có access boost + importance eviction)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Ebbinghaus forgetting curve**: memory strength **suy giảm** exponentially theo thời gian nếu không truy cập lại (`S = e^(-t/s)`). **Spaced repetition** (Anki): mỗi lần **truy cập lại** → strength **tăng** (reconsolidation) + decay chậm hơn. **agentmemory**: mỗi entry có `importance` (user-labeled hoặc auto) — eviction ưu tiên purge entry **low-importance + stale** (không accessed lâu). Công thức: `effective_strength = base_decay × importance × access_boost`. Nguyên tắc: **memory dùng nhiều thì mạnh, không dùng thì yếu** — truy access = attention, importance = weight. Khác **352 MN confidence** (corroboration score) — MP là **decay × access × importance**; khác **weibull.ts** (static per-type curve) — MP **dynamic** (access thay đổi curve).

## Mô tả

mya attention-based decay: mỗi memory entry track `accessCount` + `lastAccessed`. Mỗi retrieval → `accessCount++` → **boost strength** (reconsolidation). Decay theo Ebbinghaus (lifecycle.ts DECAY_RATE=0.9) + Weibull per-type (weibull.ts) + **access multiplier** (truy cập nhiều → chậm decay). Eviction: sort by `effective_strength = decay(t) × importance × (1 + log(accessCount))` → purge bottom N. Nối lifecycle.ts (decay engine sẵn), weibull.ts (per-type curve), 352 MN confidence (importance input). Anki insight: **spacing effect** — truy cập đều > truy cập dồn.

## Kiến trúc

```
  MEMORY ENTRY:
   strength = decay(t) × importance × access_boost
                 │              │              │
                 │              │              └─ (1 + log(accessCount))
                 │              └─ user-labeled or auto (0-1)
                 └─ e^(-t/s) — Ebbinghaus / Weibull per-type

  EACH RETRIEVAL:
   accessCount++  ──▶  access_boost ↑  ──▶  strength ↑ (reconsolidation)
   lastAccessed = now  ──▶  decay resets

  EVICTION (lifecycle.ts tick):
   sort entries by effective_strength ASC
   purge bottom N (low importance + stale + rarely accessed)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/lifecycle.ts — Ebbinghaus decay (DECAY_RATE=0.9) + purge (nền)
// ✅ packages/memory/src/weibull.ts — per-type Weibull decay curve (nền per-type)
// ✅ packages/memory/src/retrieve.ts — retrieval (track access = natural)
// ✅ 352 MN confidence — confidence score (importance input cho MP)
// ✅ packages/memory/src/dream-cycle.ts — offline decay (tick trigger)

// ❌ THIẾU: access tracking (accessCount + lastAccessed per entry)
// ❌ THIẾU: access boost (retrieval → strengthen — spaced repetition)
// ❌ THIẾU: importance weighting (effective_strength formula)
// ❌ THIẾU: importance-aware eviction (purge low-strength, not just old)
```

## Implementation

```typescript
// packages/memory/src/attention-decay.ts (NEW)
import { WEIBULL_PARAMS } from "./weibull.js";

interface DecayableMemory {
  id: string;
  type: keyof typeof WEIBULL_PARAMS;  // profile/preference/event/...
  importance: number;                  // 0-1 (user-labeled or auto)
  accessCount: number;
  lastAccessed: number;
  createdAt: number;
}

const MS_PER_HOUR = 3_600_000;

class AttentionDecay {
  // Effective strength = Weibull decay × importance × access boost
  strength(entry: DecayableMemory, now = Date.now()): number {
    const hoursSinceAccess = (now - entry.lastAccessed) / MS_PER_HOUR;
    const params = WEIBULL_PARAMS[entry.type];
    // Weibull survival: S(t) = exp(-(t/eta)^k)
    const decay = Math.exp(-Math.pow(hoursSinceAccess / params.eta, params.k));
    const accessBoost = 1 + Math.log2(1 + entry.accessCount); // spaced repetition effect
    return decay * entry.importance * accessBoost;
  }

  // Record access — boost strength (reconsolidation)
  touch(entry: DecayableMemory): void {
    entry.accessCount++;
    entry.lastAccessed = Date.now();
  }

  // Eviction — purge low-strength entries (importance-aware, not just old)
  evict(entries: DecayableMemory[], maxKeep: number): DecayableMemory[] {
    const now = Date.now();
    const ranked = entries
      .map(e => ({ entry: e, strength: this.strength(e, now) }))
      .sort((a, b) => a.strength - b.strength); // weakest first
    return ranked.slice(0, ranked.length - maxKeep).map(r => r.entry); // purge weakest
  }

  // Is entry worth keeping? (threshold)
  isStale(entry: DecayableMemory, threshold = 0.05, now = Date.now()): boolean {
    return this.strength(entry, now) < threshold;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Memory quan trọng sống lâu (importance × access) (Anki) | ❌ Access tracking overhead (update mỗi retrieval) |
| ✅ Rarely-used decay tự nhiên (Ebbinghaus) | ❌ Importance labeling cần heuristic/LLM |
| ✅ Eviction thông minh (không chỉ FIFO/old) | ❌ Boost có thể giữ junk (accessed nhiều nhưng sai) |
| ✅ Nối weibull.ts (per-type) + lifecycle.ts | ❌ Log access can inflate junk (need coalesce) |

## Khác các hướng gần

| | 352 MN Confidence | weibull.ts (static) | MP: Attention Decay |
|---|---|---|---|
| Cái gì | Score theo corroboration | Static decay curve | **Decay × access × importance** |
| Access boost | ❌ | ❌ | **✅ spaced repetition** |
| Eviction | State | Time only | **Effective strength** |

## Khi nào chọn

- Memory lớn — cần eviction thông minh (không chỉ oldest)
- Facts dùng lại thường (muốn chúng mạnh hơn — spaced repetition)
- Muốn Anki-like memory (truy cập = strengthen)
- Kết hợp lifecycle.ts (decay engine) + weibull.ts (per-type curve) + 352 MN confidence (importance input); coalesce rapid access (avoid boost spam)
