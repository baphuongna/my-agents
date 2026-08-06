# Hướng RW: Cache-Invalidation-Aware Compression — định giá nén theo chi phí vô hiệu hóa prefix cache provider

> **Nguồn gốc:** headroom (chopratejas; cache_stabilization; drift_detector; "cache hot zone (system/tools/early_messages) never modified"; "compression append-only: only live zone rewritten"; "moving a cache breakpoint never invalidates cached prefix"; cache_drift_observed; "client relocates cache_control every turn")
> **Coupling:** 🟡 — thêm cache-invalid-aware policy vào compression dispatcher (can thiệp quyết định nén)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (361 MW cache-prefix-preserving + 432 PP cache-miss sẵn — chưa có cache-hot-zone hash + drift-gated compression)
> **Effort:** 2-3 tuần

## Nguồn gốc

**headroom** là layer nén context giữa agent và LLM. Bài học cốt lõi: **nén sai chỗ = vô hiệu hóa prefix cache** (provider cache system+tools+history; sửa 1 byte prefix → cache miss → tính lại toàn bộ → đắt). Nguyên tắc **cache-invalidation-aware**: (1) chia context thành **cache hot zone** (system, tools, early_messages — tiền tố ổn định đã cache) và **live zone** (user message mới nhất, tool output gần nhất — thay đổi mỗi turn). (2) **Hot zone KHÔNG bao giờ sửa** — nén chỉ **append-only** trên live zone. (3) **Drift detector**: hash structural (SHA-256 canonical: system/tools/3 early messages) per session; khi request kế tiếp disagree → `cache_drift_observed` (prefix bị rekey → cache miss). (4) **cache_control strip**: client dịch `cache_control` breakpoint mỗi turn — đây là placement metadata, **không thay đổi structure** → strip khỏi hash (moving breakpoint không invalid prefix). (5) **Cost-aware**: nén hot zone = phá cache (đắt) > tiết kiệm token; chỉ nén live zone (append-only). Khác **361 MW cache-prefix-preserving** (freeze prefix khi nén) — RW **hash + detect drift + gate compression**; khác **432 PP cache-miss-attribution** (đo cacheRead/Write) — RW **tránh miss bằng cách không nén hot zone**.

## Mô tả

mya cache-invalidation-aware compression: (1) **Hot/Live split**: chia context — hot zone (system+tools+early msgs, đã cache) vs live zone (user msg/tool output mới). (2) **Append-only compress**: chỉ nén live zone, hot zone **byte-identical** (cache hit giữ). (3) **Drift detector**: hash canonical (system/tools/3 early msgs, strip cache_control, sort keys) per session; track LRU; disagreement → `cache_drift`. (4) **Cost-aware gate**: trước khi nén block → check có nằm hot zone? YES → skip (giữ cache), NO → nén. (5) **cache_control strip**: khi hash, bỏ cache_control marker (placement, không structure). mya có 361 MW (prefix-preserving) + 432 PP (miss attribution) — RW thêm **drift detector** + **cost-gated compression** (định giá chi phí miss).

## Kiến trúc

```
  INBOUND REQUEST (agent → LLM)
  ┌──────────────────────────────────────────────────┐
  │  system prompt  ─┐                                │
  │  tools           ├─ CACHE HOT ZONE (prefix ổn định)│  ← KHÔNG sửa (cache hit)
  │  early msgs (3) ─┘   đã cache ở provider KV        │
  │  ... user msg mới    ─ LIVE ZONE (thay đổi/turn) ─ │  ← nén OK (append-only)
  │  ... tool output gần  ─ LIVE ZONE ───────────────  │
  └──────────────────────────┬───────────────────────┘
                             ▼
  ┌─── DRIFT DETECTOR (pure observer — never mutate body) ───┐
  │  hash = SHA-256(canonical(system) || canonical(tools)    │
  │                  || canonical(early_msgs))               │
  │    canonical: sort keys, strip cache_control markers     │
  │  prev = LRU.get(sessionKey)                              │
  │  if prev && hash ≠ prev → cache_drift_observed (prefix   │
  │    rekeyed → miss)                                       │
  │  LRU.set(sessionKey, hash)                               │
  └──────────────────────────┬──────────────────────────────┘
                             ▼
  ┌─── COMPRESSION DISPATCHER (cost-aware gate) ─────────────┐
  │  for each block:                                         │
  │    in hot zone?  → SKIP (byte-identical → cache hit)     │
  │    in live zone? → COMPRESS (append-only, không phá cache)│
  │  kết quả: tiết kiệm token (live nén)                     │
  │           KHÔNG vô hiệu hóa prefix cache (hot nguyên)    │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 361 MW cache-prefix-preserving-compression — freeze prefix (nền — RW = drift detector + cost gate)
// ✅ 432 PP cache-miss-attribution — đo cacheRead/Write (nền — RW = tránh miss bằng skip hot zone)
// ✅ 100 CV prompt-compression — compressor (cho live zone)
// ✅ 359 MU content-type-aware — compressor (cho live zone)

// ❌ THIẾU: hot/live zone split (system/tools/early = hot, user/tool-output = live)
// ❌ THIẾU: drift detector (canonical hash per session, LRU, cache_drift_observed)
// ❌ THIẾU: cost-aware compression gate (nén chỉ live, skip hot)
// ❌ THIẾU: cache_control strip trong hash (placement, không structure)
```

## Implementation

```typescript
// packages/agent/src/cache-invalid-aware-compression.ts (MỚI)
import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";

interface Block { role: string; content: string; isEarly?: boolean }

// canonical hash: sort keys + strip cache_control markers (placement, không structure)
function canonicalHash(block: unknown): string {
  const canon = JSON.stringify(stripCacheControl(block), Object.keys(sortDeep(block)).sort());
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}
function stripCacheControl(b: unknown): unknown { /* remove cache_control field, keep rest */ return b; }
function sortDeep(b: unknown): unknown { return b; }

class DriftDetector {
  readonly #lru = new LRUCache<string, string>({ max: 1024 });   // sessionKey → hot-zone hash
  observe(sessionKey: string, hotZone: { system: unknown; tools: unknown; early: Block[] }): boolean {
    const hash = canonicalHash({ system: hotZone.system, tools: hotZone.tools, early: hotZone.early });
    const prev = this.#lru.get(sessionKey);
    this.#lru.set(sessionKey, hash);
    return prev !== undefined && prev !== hash;                   // true = drift (cache miss)
  }
}

class CacheInvalidAwareCompressor {
  constructor(private compress: (s: string) => string, private detector = new DriftDetector()) {}

  process(sessionKey: string, blocks: Block[], earlyCount = 3): { blocks: Block[]; drift: boolean } {
    // split hot zone (system/tools/early) vs live zone (rest)
    const early = blocks.slice(0, earlyCount);
    const live = blocks.slice(earlyCount);
    const drift = this.detector.observe(sessionKey, { system: "", tools: "", early });

    // cost-aware: hot zone SKIP (byte-identical → cache hit), live zone COMPRESS (append-only)
    const compressedLive = live.map(b => ({ ...b, content: this.compress(b.content) }));
    return { blocks: [...early, ...compressedLive], drift };
  }
}

// Usage:
// const { blocks, drift } = comp.process("sess-1", allBlocks);
// if (drift) warn("cache drift — prefix rekeyed, expect miss");
// send blocks tới LLM → hot zone cache hit + live zone nén
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cache hit giữ (hot zone byte-identical) | ❌ Phải biết hot/live boundary (system/tools/early) |
| ✅ Drift detection (biết khi prefix bị rekey → miss) | ❌ Hash overhead mỗi request (canonical + SHA-256) |
| ✅ Cost-aware (nén chỉ nơi không phá cache) | ❌ Hot zone lớn → ít block để nén |
| ✅ Nối 361 MW + 432 PP | ❌ Provider khác nhau khác hot zone rule |

## Khác các hướng gần

| | 361 Cache-Prefix-Preserving | 432 Cache-Miss-Attribution | RW: Cache-Invalid-Aware |
|---|---|---|---|
| Cái gì | Freeze prefix khi nén | Đo cacheRead/Write | **Hash + detect drift + cost-gate nén** |
| Detect miss | ❌ (chỉ tránh) | ✅ (đo) | **✅ (canonical hash drift)** |
| Nén | Skip prefix | ❌ | **Skip hot, nén live (append-only)** |

## Khi nào chọn

- Nén context nhưng sợ phá prefix cache (sửa 1 byte hot zone → miss → đắt)
- Muốn biết khi nào cache miss xảy ra (drift detection)
- Cần cost-aware: nén chỉ nơi không vô hiệu cache (live zone append-only)
- Nối 361 MW (RW = drift detector trên đó) + 432 PP (RW = tránh miss bằng skip hot) + 100 CV/359 MU (RW = live zone compressor); guard hot/live boundary (đúng system/tools/early = hot) + canonical hash (sort keys + strip cache_control — placement không structure) + drift LRU bounded (session key cardinality) + provider-specific (mỗi provider khác hot zone field)
