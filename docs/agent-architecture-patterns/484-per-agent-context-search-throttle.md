# Hướng RP: Per-Agent-Context Search Throttle — rolling-window theo agent-context, soft-cap thu hẹp, hard-cap chặn

> **Nguồn gốc:** context-mode (#769 flood-guard; "rolling-window call counter bucketed per agent-context key"; "softCapAfter → taper to 1 result"; "blockAfter → hard-block"; "concurrent subagents do not consume one another's budget")
> **Coupling:** 🟢 — FloodGuard pure module chèn vào search path (không can thiệp core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (search/MCP sẵn — chưa có per-agent-context rolling-window throttle)
> **Effort:** 1-1.5 tuần

## Nguồn gốc

**context-mode** gặp issue **#769**: `ctx_search` có throttle chống flood (1 actor spam hàng chục search → ngập context). Vấn đề: counter ban đầu là **module-global** trên MCP server process. Khi **multi-agent fan-out** (Claude Code Task/Workflow) chạy N subagent song song trên **cùng 1 MCP server process**, các call độc lập bị **cộng dồn vào 1 budget chung** → fan-out hợp lệ ("10 agent × 2 call") bị trip guard chỉ dùng cho 1 actor spam. Giải pháp: **bucket theo agent-context key** — mỗi key có **window + counter riêng**, song song độc lập; 1 actor tham lam vẫn bị throttle đúng. **Progressive throttle 2 cấp**: (1) **soft-cap** (sau N call) → kết quả thu hẹp (chỉ 1 result/query) — taper; (2) **hard-cap** (sau M call) → **chặn hẳn**. **Rolling window**: hết windowMs → counter reset (key được budget mới). Nguyên tắc: **budget là trạng thái per-agent-context, không global**. Khác **403 OM windowed-history** (window query) — RP **window throttle call rate**; khác **432 PP cache-miss-attribution** — RP **rate-limit search, không đo cache**.

## Mô tả

mya per-agent-context search throttle: (1) **Agent-context key**: mỗi agent/session có key riêng (sessionId / agentId). (2) **Per-key bucket**: `Map<key, {count, windowStart}>` — mỗi key window + counter độc lập. (3) **Rolling window**: `now - windowStart > windowMs` → reset bucket (budget mới). (4) **Progressive 2 cấp**: `count > softCapAfter` → `softCapped=true` (caller thu hẹp 1 result); `count > blockAfter` → `blocked=true` (caller từ chối search). (5) **Message**: mỗi response kèm `call #N/M in rolling window`, `softCapRemaining`, `blockRemaining`. (6) **Bounded map**: maxKeys (4096) — evict oldest-window bucket (fail-open, không false-block). (7) **Config env**: window/caps tunable. mya có search — RP thêm **FloodGuard** (pure, testable) vào search path.

## Kiến trúc

```
  ctx_search call tới MCP server
        │  (n subagent song song, cùng server process)
        ▼
  ┌─── FLOOD GUARD (per agent-context key) ─────────────────┐
  │  key = sessionId / agentId  (currentAttribution)         │
  │  bucket = map.get(key)                                   │
  │    if (now - bucket.windowStart > windowMs)              │
  │       → reset: {count:0, windowStart:now}                │
  │  bucket.count++                                          │
  │                                                          │
  │  ┌─ LEVEL 1: soft-cap ──────────────────────────────┐   │
  │  │  count > softCapAfter (vd 3)?                     │   │
  │  │    YES → softCapped=true → caller: 1 result/query │   │
  │  └───────────────────────────────────────────────────┘   │
  │  ┌─ LEVEL 2: hard-cap ──────────────────────────────┐   │
  │  │  count > blockAfter (vd 6)?                       │   │
  │  │    YES → blocked=true → caller: REFUSE search ❌  │   │
  │  └───────────────────────────────────────────────────┘   │
  │  return { count, windowStart, blocked, softCapped }      │
  └──────────────────────────┬──────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                          ▼
  softCapped: trim 1 result             blocked: trả lỗi + "retry in Ns"
  (taper dần)                           (chặn hẳn)

  ROLLING WINDOW: hết windowMs (60s) → count reset → budget mới
  PER-KEY: agent A spam (blocked) ≠ agent B (budget đầy) — không ăn cắp budget
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ search (packages/*) — MCP/web/file search (nền — RP = throttle chèn vào search path)
// ✅ MCP server — tool dispatch (nền — RP = FloodGuard trong handler)
// ✅ 403 OM windowed-history-retrieval — window query (đối chiếu — RP = window rate)
// ✅ 432 PP cache-miss-attribution — đo token (đối chiếu — RP = rate-limit call)

// ❌ THIẾU: FloodGuard (pure, per-key rolling-window counter)
// ❌ THIẾU: soft-cap (taper → 1 result) + hard-cap (refuse)
// ❌ THIẾU: throttle message (call #N/M, remaining) trên response
// ❌ THIẾU: bounded map + oldest-window eviction (fail-open)
```

## Implementation

```typescript
// packages/agent/src/search-flood-guard.ts (MỚI)
interface FloodGuardConfig {
  windowMs: number;        // rolling window (sau đây count reset)
  softCapAfter: number;    // sau đây → taper 1 result/query
  blockAfter: number;      // sau đây → hard-block
}
interface FloodDecision {
  count: number;
  windowStart: number;
  blocked: boolean;
  softCapped: boolean;
}
interface Bucket { count: number; windowStart: number; }

class FloodGuard {
  readonly #buckets = new Map<string, Bucket>();
  readonly #maxKeys: number;

  constructor(private cfg: FloodGuardConfig, maxKeys = 4096) {
    this.#maxKeys = Math.max(1, maxKeys);
  }

  // record 1 search call cho key tại now → throttle decision (pure aside from counter state)
  record(key: string, now: number = Date.now()): FloodDecision {
    let bucket = this.#buckets.get(key);
    if (!bucket || now - bucket.windowStart > this.cfg.windowMs) {
      bucket = { count: 0, windowStart: now };
      this.#buckets.set(key, bucket);
      this.#evictIfNeeded();
    }
    bucket.count++;
    return {
      count: bucket.count,
      windowStart: bucket.windowStart,
      blocked: bucket.count > this.cfg.blockAfter,
      softCapped: bucket.count > this.cfg.softCapAfter,
    };
  }

  size(): number { return this.#buckets.size; }

  // fail-open: path key vô hạn không grow map → evict oldest-window (fresh window lần sau)
  #evictIfNeeded(): void {
    if (this.#buckets.size <= this.#maxKeys) return;
    let oldestKey: string | undefined; let oldest = Infinity;
    for (const [k, b] of this.#buckets)
      if (b.windowStart < oldest) { oldest = b.windowStart; oldestKey = k; }
    if (oldestKey !== undefined) this.#buckets.delete(oldestKey);
  }
}

// chèn vào search handler
function searchHandler(fg: FloodGuard, key: string, query: string): { results: string[]; throttled: string } {
  const d = fg.record(key);
  if (d.blocked) {
    const retryMs = d.windowStart + 60_000 - Date.now();
    return { results: [], throttled: `Blocked (hard-cap). Retry in ${Math.ceil(retryMs / 1000)}s.` };
  }
  const limit = d.softCapped ? 1 : 5;                        // taper → 1 result
  const all = runSearch(query, limit);
  const note = d.softCapped
    ? `Soft-cap: 1 result/query. ${d.count} calls in window.`
    : `${d.count} calls in window.`;
  return { results: all, throttled: note };
}

// Usage:
// const fg = new FloodGuard({ windowMs: 60_000, softCapAfter: 3, blockAfter: 6 });
// agent A: searchHandler(fg, "agent-A", "foo")  // count 1-3: full (5 results)
//          searchHandler(fg, "agent-A", "bar")  // count 4: soft-cap (1 result)
//          searchHandler(fg, "agent-A", "baz")  // count 7: blocked
// agent B: searchHandler(fg, "agent-B", "x")    // count 1: full (A không ăn budget B)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống 1 actor spam search (ngập context) | ❌ Phải có agent-context key (sessionId) |
| ✅ Multi-agent fan-out không ăn cắp budget lẫn nhau | ❌ Cấu hình caps (soft/hard) cần tune |
| ✅ Progressive (taper trước, block sau) — nhẹ tay | ❌ Bounded map eviction có thể fail-open (fresh window) |
| ✅ Pure + testable (không cần MCP server) | ❌ Message overhead trên mỗi response |

## Khác các hướng gần

| | 403 Windowed-History | 432 Cache-Miss-Attribution | RP: Search-Throttle |
|---|---|---|---|
| Cái gì | Window query history | Đo cache token | **Rate-limit search call** |
| Window | Query range | ❌ | **Rolling budget per agent** |
| Hiệu ứng | Truy xuất | Attribution | **Taper → block** |

## Khi nào chọn

- Nhiều agent/subagent search song song trên cùng server (multi-agent fan-out)
- Một actor spam search ngập context (cần chống flood)
- Muốn throttle progressive (taper nhẹ trước khi block hẳn)
- Nối search path (RP = FloodGuard trong handler); guard per-key bucketing (không global — fan-out hợp lệ không trip) + rolling-window reset (hết window → budget mới) + bounded-map eviction (fail-open, không false-block) + tunable caps (env config window/soft/hard)
