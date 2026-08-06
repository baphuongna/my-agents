# Hướng AJP: SQLite Tracking Analytics — mọi command execution ghi SQLite (input/output tokens, savings %, exec time), retention 90 ngày, aggregation theo ngày/tuần/tháng, export JSON/CSV, `rtk gain`

> **Nguồn gốc:** rtk | **Coupling:** 🟡 — analytics persistence | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có TelemetrySink + cost; chưa có SQLite tracking + retention + aggregate) | **Effort:** 1.5 tuần

## Nguồn gốc

**rtk** mọi **command execution** được **record vào SQLite** (`~/.local/share/rtk/tracking.db`) với **input/output tokens, savings %, exec time**; **retention 90 ngày** tự dọn, **aggregation API** theo **ngày/tuần/tháng**, **export JSON/CSV**, `rtk gain` hiển thị **analytics**. Mục đích: đo lường tiết kiệm token của reducer (AJL) để chứng minh ROI + optimize.

Nguyên tắc: **record mọi execution** — input token (raw), output token (reduced), saved, savings_pct, exec_time_ms, command name; **SQLite durable** — không in-memory (TelemetrySink bounded); **retention auto** — 90 ngày tự purge (không phình); **aggregation** — daily/weekly/monthly rollup + top-10 command by saved; **export** — JSON/CSV cho dashboard; **`gain` view** — summary (total saved, avg %, top commands, 30-day activity).

## Mô tả

Với mya, pattern = **command-tracking SQLite + analytics**: (1) **mya có TelemetrySink (telemetry.ts)** — bounded rolling window projection, in-memory — nền event có nhưng không durable; (2) **mya có cost.ts** — computeCost + TokenUsage — nền token accounting; (3) **AJP thêm SQLite store** — packages có natives (Rust SQLite sẵn) hoặc better-sqlite3; record mỗi bash execution (nối AJO track event → AJP row); (4) **schema** — `executions(id, cmd, input_tokens, output_tokens, saved_tokens, savings_pct, exec_ms, at, project)`; (5) **retention 90 ngày** — cron/interval purge `WHERE at < now-90d`; (6) **aggregation** — daily/weekly/monthly rollup table + top-10 by saved; (7) **export** — JSON/CSV; (8) **`mya gain`** — summary view. Tham chiếu: source/rtk src/core/tracking.rs (Tracker, CommandRecord, GainSummary, DayStats, retention 90).

## Kiến trúc (ASCII)

```
  bash execution ──► [TRACK EVENT (AJO)]
                        │ { cmd, input_tokens, output_tokens, saved, savings_pct, exec_ms }
                        ▼
                   SQLite TRACKING DB  (~/.local/share/mya/tracking.db)
                   executions(id, cmd, in_tok, out_tok, saved, pct, exec_ms, at, project)
                        │
            ┌───────────┼───────────────┐
            ▼           ▼               ▼
      RETENTION     AGGREGATION      EXPORT
      purge at<now-90d  daily/weekly/  JSON/CSV
      (cron 90 ngày)   monthly rollup  (dashboard)
                        │
                        ▼ `mya gain` — SUMMARY
                        total saved | avg % | top-10 cmd | 30-day activity
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core telemetry.ts — TelemetrySink (bounded window projection —
//   nền event, nhưng in-memory không durable)
// ✅ packages/core cost.ts — computeCost, TokenUsage, Cost (nền token accounting)
// ✅ packages/core loop.ts — token usage per turn (nền input)
// ✅ packages/cron — cron scheduler (nền retention interval)
// ✅ packages/natives — Rust SQLite (nền durable store — dùng cho tracking)
// ✅ source/rtk src/core/tracking.rs — Tracker, CommandRecord, GainSummary,
//   DayStats, retention 90 (Rust reference — port TS hoặc gọi native)

// ❌ THIẾU: SQLite tracking store (durable — không chỉ TelemetrySink)
// ❌ THIẾU: retention 90 ngày auto-purge
// ❌ THIẾU: aggregation daily/weekly/monthly + export + `mya gain` view
```

## Implementation

```typescript
// packages/core/src/tracking-store.ts (NEW) — port rtk tracking.rs
export interface CommandRecord {
  cmd: string; inputTokens: number; outputTokens: number;
  savedTokens: number; savingsPct: number; execMs: number; at: number; project?: string;
}
export interface GainSummary {
  totalInput: number; totalOutput: number; totalSaved: number;
  avgSavingsPct: number;
  topBySaved: Array<{ cmd: string; count: number; saved: number; avgPct: number }>;
}

export class TrackingStore {
  constructor(private db: { exec: (sql: string, p?: unknown[]) => void; all: <T>(sql: string, p?: unknown[]) => T[] }) {
    db.exec(`CREATE TABLE IF NOT EXISTS executions(
      id INTEGER PRIMARY KEY, cmd TEXT, in_tok INT, out_tok INT,
      saved INT, pct REAL, exec_ms INT, at INT, project TEXT)`);
  }
  record(r: CommandRecord): void {
    this.db.exec(
      `INSERT INTO executions(cmd,in_tok,out_tok,saved,pct,exec_ms,at,project) VALUES(?,?,?,?,?,?,?,?)`,
      [r.cmd, r.inputTokens, r.outputTokens, r.savedTokens, r.savingsPct, r.execMs, r.at, r.project ?? null]);
  }
  /** Retention — purge > 90 ngày. */
  prune(now: number, days = 90): number {
    const before = this.db.all<{ c: number }>(`SELECT COUNT(*) c FROM executions`)[0]?.c ?? 0;
    this.db.exec(`DELETE FROM executions WHERE at < ?`, [now - days * 86400_000]);
    const after = this.db.all<{ c: number }>(`SELECT COUNT(*) c FROM executions`)[0]?.c ?? 0;
    return before - after;
  }
  /** Gain summary — total saved + avg % + top-10 by saved. */
  gain(): GainSummary {
    const r = this.db.all<{ ti: number; to: number; ts: number; ap: number }>(
      `SELECT SUM(in_tok) ti, SUM(out_tok) "to", SUM(saved) ts, AVG(pct) ap FROM executions`)[0];
    const top = this.db.all<{ cmd: string; count: number; saved: number; avgPct: number }>(
      `SELECT cmd, COUNT(*) count, SUM(saved) saved, AVG(pct) avgPct
       FROM executions GROUP BY cmd ORDER BY saved DESC LIMIT 10`);
    return {
      totalInput: r?.ti ?? 0, totalOutput: r?.to ?? 0, totalSaved: r?.ts ?? 0,
      avgSavingsPct: r?.ap ?? 0, topBySaved: top,
    };
  }
}
// bash tool (nối AJO): sau resolveOutput → trackingStore.record({...}).
// cron: trackingStore.prune(now, 90) mỗi ngày. `mya gain`: print trackingStore.gain().
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đo ROI reducer (nối AJL) — chứng minh tiết kiệm | ❌ SQLite I/O mỗi execution — overhead nhỏ |
| ✅ Durable (không chỉ in-memory TelemetrySink) | ❌ DB phình nếu quên retention — cần cron 90d |
| ✅ Aggregation + export cho dashboard | ❌ Privacy — command log có thể nhạy cảm |
| ✅ `mya gain` summary view | ❌ Token counter phải chính xác (input vs output) |

## Khác các hướng gần

| | AJP Tracking Analytics | AJO Passthrough Fallback | AJL Token CLI Proxy |
|---|---|---|---|
| Trọng tâm | Đo lường tiết kiệm | Safety net always-on | 4-strategy reduction |
| Cơ chế | SQLite + retention + aggregate | fail-open passthrough + track | filter/group/truncate/dedup |
| Quan hệ | Nhận event từ AJO | Track reason → AJP | Động cơ (đo savings của AJL) |

## Khi nào chọn

- Reducer (AJL) active — muốn đo ROI tiết kiệm token
- Muốn durable analytics (không chỉ TelemetrySink in-memory)
- Quan tâm top-command savings + export dashboard
- Guard: retention 90 ngày auto (cron), token counter chính xác (input vs output), privacy (command có thể redact), DB path ổn định (~/.local/share/mya/tracking.db)
