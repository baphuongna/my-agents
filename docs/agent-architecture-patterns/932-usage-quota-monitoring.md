# Hướng AIV: Usage Quota Monitoring — Exa usage theo dõi trong file JSON với MONTHLY_LIMIT/WARNING_THRESHOLD; ActivityMonitor ghi từng API/fetch với rate-limit window

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟢 — monitoring thuần, không đụng provider | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có RateLimiter gateway; chưa có monthly quota file) | **Effort:** 1 tuần

## Nguồn gốc

**pi-web-access** theo dõi **Exa usage** trong `~/.pi/exa-usage.json` với **MONTHLY_LIMIT 1000** và **WARNING_THRESHOLD 800**; **ActivityMonitor** ghi từng API/fetch với **rate-limit window 60s/10 calls**. Mục đích: **extension tự bảo vệ quota trước khi provider chặn** — đếm usage lũy kế theo tháng, cảnh báo sớm ở ngưỡng 80%, và rate-limit calls trong cửa sổ thời gian — không để provider 429 và giết toàn bộ tool.

Nguyên tắc: **quota phải tự theo dõi phía client (persisted file), không trông chờ provider báo** — provider chỉ chặn khi vượt, client phải biết trước; **monitoring hai lớp** — monthly budget (lũy kế dài hạn) + rate window (cửa sổ ngắn hạn); **action phân cấp** — warning (báo user), limit (chặn mềm/fallback), provider block (đã quá muộn — tránh).

## Mô tả

Với mya, pattern = **usage monitor cho external API calls**: (1) **UsageMonitor mới** — persisted JSON (`~/.mya/usage/<provider>.json`): đếm `{ yearMonth, calls }`, MONTHLY_LIMIT + WARNING_THRESHOLD per-provider; (2) **ActivityMonitor** — ring buffer calls trong 60s, max 10 calls/window (nối gateway `RateLimiter` token-bucket có sẵn — `channel-identity.ts`); (3) **kiểm tra trước khi gọi** — provider call đi qua `monitor.canCall()`: vượt monthly → chặn + báo; trong warning → log cảnh báo; vượt window → delay/queue; (4) **ghi sau khi gọi** — thành công hay fail đều ghi (fail cũng tiêu quota nếu provider tính); (5) **áp cho mọi external provider** — Exa/Tavily (web search chain `packages/tools/src/web/search`), Replicate (video-gen), image-gen — mỗi provider config riêng. Nối telemetry (core/telemetry) + audit để trace quota decisions.

## Kiến trúc (ASCII)

```
  PROVIDER CALL (Exa/Tavily/Replicate...)
    │
    ▼ USAGE MONITOR (persisted ~/.mya/usage/<provider>.json)
    ├─ monthly: { yearMonth, calls } vs MONTHLY_LIMIT (1000)
    │    ├─ > WARNING_THRESHOLD (800) ──► cảnh báo (vẫn cho gọi)
    │    └─ > LIMIT ──► CHẶN + báo (fallback provider khác)
    ▼ ACTIVITY MONITOR (60s window / 10 calls)
    ├─ vượt window ──► delay/queue (không 429)
    └─ trong window ──► gọi
    ▼
    GHI SAU KHI GỌI (calls+1 — thành công hay fail đều ghi)
  (không trông chờ provider chặn — client biết trước)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway channel-identity.ts — RateLimiter token-bucket + getRateLimiter
//   (nền ActivityMonitor window — per-platform config có sẵn)
// ✅ packages/tools web/search — provider chain (Exa/Tavily/...) — nơi áp monitor
// ✅ packages/core telemetry.ts — TelemetrySink (nền trace quota decisions)
// ✅ packages/audit — AuditLog (nền log quota blocks)
// ✅ packages/memory sqlite-db.ts — better-sqlite3 pattern (nền persist nếu muốn DB)

// ❌ THIẾU: persisted monthly usage file (~/.mya/usage/<provider>.json)
// ❌ THIẾU: MONTHLY_LIMIT + WARNING_THRESHOLD per-provider
// ❌ THIẾU: pre-call check (canCall) + post-call record (ghi cả fail)
```

## Implementation

```typescript
// packages/tools/src/web/usage-monitor.ts (NEW)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nowWallclock } from "@my-agent/core";

interface UsageState { yearMonth: string; calls: number }
const LIMITS: Record<string, { monthly: number; warn: number; windowMs: number; windowMax: number }> = {
  exa:       { monthly: 1000, warn: 800, windowMs: 60_000, windowMax: 10 },
  tavily:    { monthly: 1000, warn: 800, windowMs: 60_000, windowMax: 10 },
  replicate: { monthly: 200,  warn: 160, windowMs: 120_000, windowMax: 5 },
};
const DEFAULT_LIMIT = { monthly: 1000, warn: 800, windowMs: 60_000, windowMax: 10 };

export class UsageMonitor {
  private calls: number[] = [];   // timestamps trong window (ActivityMonitor)
  constructor(private readonly provider: string) {}
  private file(): string {
    return join(homedir(), ".mya", "usage", `${this.provider}.json`);
  }
  private load(): UsageState {
    try {
      const raw = JSON.parse(readFileSync(this.file(), "utf8")) as UsageState;
      const month = new Date(nowWallclock()).toISOString().slice(0, 7);
      return raw.yearMonth === month ? raw : { yearMonth: month, calls: 0 };  // tháng mới reset
    } catch { return { yearMonth: new Date(nowWallclock()).toISOString().slice(0, 7), calls: 0 }; }
  }
  /** Pre-call check: "ok" | "warning" | "blocked" — chặn trước khi provider 429. */
  canCall(): "ok" | "warning" | "blocked" {
    const l = LIMITS[this.provider] ?? DEFAULT_LIMIT;
    const state = this.load();
    if (state.calls >= l.monthly) return "blocked";            // monthly limit
    const now = nowWallclock();
    const recent = this.calls.filter((t) => now - t < l.windowMs);
    if (recent.length >= l.windowMax) return "blocked";        // window limit
    return state.calls >= l.warn ? "warning" : "ok";
  }
  /** Post-call record — thành công hay fail đều ghi (provider tính cả fail). */
  record(): void {
    const l = LIMITS[this.provider] ?? DEFAULT_LIMIT;
    const now = nowWallclock();
    this.calls = [...this.calls.filter((t) => now - t < l.windowMs), now];
    const state = this.load();
    state.calls++;
    writeFileSync(this.file(), JSON.stringify(state), "utf8");
  }
}
// provider chain: trước search/extract → canCall(); "blocked" → fallback provider
// hoặc lỗi rõ; "warning" → log; sau call → record().
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự bảo vệ quota — không để provider chặn bất ngờ | ❌ File JSON mỗi provider — cần sync nếu multi-process |
| ✅ Hai lớp monitoring (monthly + window) | ❌ Provider có quota riêng khác — config phải đúng |
| ✅ Persist qua restart — không mất đếm tháng | ❌ Ghi fail cũng tính — user có thể bất ngờ vì fail count |
| ✅ Nối RateLimiter token-bucket có sẵn | ❌ Reset tháng dựa trên clock — timezone cần rõ |

## Khác các hướng gần

| | AIV Usage Quota | AIQ Lifetime Usage | AJP Tracking Analytics |
|---|---|---|---|
| Trọng tâm | Bảo vệ quota provider | Đếm đúng usage turn | Analytics command |
| Cơ chế | File monthly + window | Accumulator từ events | SQLite tracking |
| Quan hệ | Người tiêu thụ usage | Số liệu gốc | Người tiêu thụ usage |

## Khi nào chọn

- Tool gọi external API có quota (search/video/image gen) — tránh bị chặn giữa task
- Muốn cảnh báo sớm (80% monthly) trước khi provider chặn cứng
- Đã có RateLimiter gateway — thêm monthly persisted layer
- Guard: pre-check + post-record cả fail, tháng mới reset, window per-provider