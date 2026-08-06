# Hướng XU: Watchlist Heartbeat — data/watchlist.json + watchlist check cho heartbeat: chỉ báo khi account quan trọng đăng gì đáng chú ý, không báo tweet routine

> **Nguồn gốc:** x-research-skill (`data/watchlist.json` + watchlist check) | **Coupling:** 🟢 — thêm watchlist filter vào heartbeat/cron notify | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có cron + channels notify — chưa có watchlist filter) | **Effort:** 1-2 tuần

## Nguồn gốc

**x-research-skill** chạy **heartbeat** định kỳ (cron) kiểm hoạt động account trên watchlist, nhưng **không spam** — chỉ báo khi account quan trọng đăng gì **đáng chú ý**, bỏ qua tweet routine (chào hỏi, retweet trivia, small talk). Cơ chế: `data/watchlist.json` khai báo account + **relevance rules** (keyword, loại content, min-importance). Heartbeat poll → filter qua relevance rules → chỉ notify khi pass threshold. Nguyên tắc: **signal > noise — watchlist kèm relevance gate, không báo mọi activity**.

## Mô tả

mya watchlist heartbeat: cron job poll nguồn (RSS, API, channel) cho account trong `watchlist.json` → filter qua **relevance gate** (keyword match + content-type + importance score) → chỉ notify channel khi **pass threshold** (đáng chú ý). Tweet/activity routine → drop (silent). Account quan trọng đăng insight/breaking → notify. mya có packages/cron (heartbeat runner) + packages/channels (notify: matrix, whatsapp) — XU thêm **watchlist config** + **relevance gate** + **threshold filter**.

## Kiến trúc

```
  ┌─── data/watchlist.json ────────────────────────────────┐
  │  [ { account: "@ai_researcher",                          │
  │      keywords: ["paper","benchmark","release"],          │
  │      types: ["insight","breaking"],                      │
  │      minImportance: 0.6 } ]                              │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── HEARTBEAT (cron poll) ──────────────────────────────┐
  │  poll source → activities[]                              │
  │  for each activity: match watchlist account?             │
  │    → relevance gate: keyword? type? importance ≥ min?    │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── THRESHOLD FILTER ───────────────────────────────────┐
  │  pass → NOTIFY channel (matrix/whatsapp)                 │
  │  fail (routine tweet) → DROP (silent)                    │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron — cron runner / heartbeat (nền — XU poll ở đây)
// ✅ packages/channels — notify (matrix/whatsapp, nền — XU sink)
// ✅ packages/cron scan.ts — cron scan (nền — XU filter analog)
// ✅ packages/tools fetch.ts — fetch tool (nền — XU poll source)

// ❌ THIẾU: watchlist config (data/watchlist.json schema)
// ❌ THIẾU: relevance gate (keyword/type/importance filter)
// ❌ THIẾU: threshold notify (pass → channel, fail → silent)
```

## Implementation

```typescript
// packages/cron/src/watchlist-heartbeat.ts (MỚI)
import { readFile } from "node:fs/promises";

interface WatchEntry {
  account: string;
  keywords?: string[];
  types?: string[];
  minImportance?: number;
}

interface Activity {
  account: string;
  text: string;
  type: string;          // "insight" | "breaking" | "routine" | ...
  importance: number;    // 0..1
  url: string;
}

async function loadWatchlist(path: string): Promise<WatchEntry[]> {
  return JSON.parse(await readFile(path, "utf8")) as WatchEntry[];
}

function relevanceScore(a: Activity, entry: WatchEntry): number {
  let score = 0;
  const kwHits = (entry.keywords ?? []).filter((k) => a.text.toLowerCase().includes(k.toLowerCase())).length;
  score += kwHits * 0.3;                                  // keyword match
  if (entry.types?.includes(a.type)) score += 0.3;        // type match
  score += a.importance * 0.4;                            // importance
  return Math.min(1, score);
}

interface NotifySink { send(msg: string): Promise<void> }

async function heartbeat(
  watchlistPath: string,
  poll: () => Promise<Activity[]>,
  sink: NotifySink,
): Promise<{ notified: number; dropped: number }> {
  const entries = await loadWatchlist(watchlistPath);
  const byAccount = new Map(entries.map((e) => [e.account, e]));
  const activities = await poll();
  let notified = 0, dropped = 0;
  for (const a of activities) {
    const entry = byAccount.get(a.account);
    if (!entry) { dropped++; continue; } // account không trong watchlist
    const score = relevanceScore(a, entry);
    if (score >= (entry.minImportance ?? 0.6)) { await sink.send(`🔔 ${a.account} [${a.type}]: ${a.text}\n${a.url}`); notified++; }
    else dropped++; // routine tweet → silent
  }
  return { notified, dropped };
}

// Usage:
// const r = await heartbeat("data/watchlist.json", pollFeed, matrixSink);
// → notified 2 (insight), dropped 47 (routine) — không spam
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Signal > noise (chỉ báo đáng chú ý, không spam) | ❌ Miss risk (relevance gate sai → drop insight quan trọng) |
| ✅ Watchlist scoped (chỉ account quan trọng) | ❌ Keyword brittle (synonym/không keyword → miss) |
| ✅ Configurable (minImportance per account) | ❌ Importance subjective (LLM score? heuristic?) |
| ✅ Heartbeat cheap (filter trước notify) | ❌ Poll cost (cron poll API rate limit) |

## Khác các hướng gần

| | Notify-all | Cron digest | XU: Watchlist Heartbeat |
|---|---|---|---|
| Scope | mọi activity | tổng hợp | **watchlist + relevance gate** |
| Noise | cao (spam) | thấp (gộp) | **thấp (chỉ signal)** |
| Latency | real-time | batch | **near-real (cron)** |

## Khi nào chọn

- Cần theo dõi account quan trọng (researcher, competitor) nhưng không spam routine
- Muốn signal > noise (chỉ notify insight/breaking, drop tweet routine)
- Có cron + channel notify sẵn — thêm watchlist filter
- Nối packages/cron + packages/channels (matrix/whatsapp) + packages/tools fetch.ts; guard relevance-tuning (calibrate keyword/importance — test false negative), poll-rate-limit (cron không spam API — backoff), và watchlist-schema-version (data/watchlist.json migrate khi schema đổi); XU = watchlist heartbeat, kết hợp 637 XM security-scan-gate (scan watchlist source trust) + packages/cron scan.ts (heartbeat safety scan)
