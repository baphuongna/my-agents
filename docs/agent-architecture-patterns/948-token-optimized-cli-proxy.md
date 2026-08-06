# Hướng AJL: Token-Optimized CLI Proxy — Rust proxy giữa LLM và system commands với 4 chiến lược lọc (filtering / grouping / truncation / dedup), tiết kiệm 60-90% token

> **Nguồn gốc:** rtk | **Coupling:** 🟡 — tool output pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có bash tool + compressors; chưa có CLI proxy 4-strategy) | **Effort:** 2 tuần

## Nguồn gốc

**rtk** là **Rust proxy** đứng giữa LLM và **system commands** với **4 chiến lược lọc**: **filtering** (bỏ noise/boilerplate), **grouping** (gom theo dir/error type), **truncation** (giữ context liên quan), **deduplication** (gộp log lặp kèm counter). Tiết kiệm **60-90% token** — output CLI dài (npm/git/docker) giảm xuống vài dòng thiết yếu cho agent.

Nguyên tắc: **proxy đứng giữa** — LLM gọi command, proxy intercept → lọc → trả output tinh gọn; **4 chiến lược kết hợp** — filtering (line-level noise), grouping (cấu trúc lại theo dir/error), truncation (cap dòng/giữ tail/head), dedup (log lặp → "× N"); **deterministic không LLM** — parse cấu trúc đã biết, nhanh rẻ tái lặp; **never worse** — nếu lọc làm mất thông tin → fallback raw (guard).

## Mô tả

Với mya, pattern = **CLI output reducer proxy cho bash tool**: (1) **mya có bash tool (builtin.ts)** — spawn `/bin/bash -c`, trả raw stdout/stderr — nền execution có; (2) **mya có compressors (prompts/compress.ts)** — generic entropy compression — gần nhưng chưa per-command; (3) **AJL thêm reducer layer**: bash tool chạy xong → reducer pipeline (filtering → grouping → truncation → dedup) trước khi trả agent; (4) **filtering** — strip boilerplate (progress bar, blank lines, deprecation noise); (5) **grouping** — gom dòng theo dir/error type (npm warn grouped); (6) **truncation** — cap max_lines + giữ tail (error thường cuối); (7) **dedup** — log lặp → "line × N"; (8) **never-worse guard** — output lọc ≥ thông tin raw (nếu không, fallback raw); (9) **token accounting** — đo input/output token (nối AJP tracking). Reducer có thể dùng rtk native (source/rtk filter.rs/truncate.rs) hoặc TS port.

## Kiến trúc (ASCII)

```
  LLM ──bash cmd──► [CLI PROXY]
                       │
                       ▼ EXECUTE raw (/bin/bash -c) ──► raw stdout/stderr
                       │
                       ▼ 4-STRATEGY PIPELINE
                       ├─ 1. FILTERING   — strip noise/boilerplate/progress
                       ├─ 2. GROUPING    — gom theo dir/error type
                       ├─ 3. TRUNCATION  — cap max_lines, giữ tail (error cuối)
                       └─ 4. DEDUP       — log lặp → "line × N"
                       │
                       ▼ NEVER-WORSE GUARD — lọc mất thông tin? → fallback raw
                       │
                       ▼ trả agent (output tinh gọn, -60-90% token)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools builtin.ts — bash tool (spawn /bin/bash -c, raw stdout/stderr,
//   durationMs, timedOut) (nền execution)
// ✅ packages/prompts compress.ts — compressors (generic entropy — nền gần)
// ✅ packages/core cost.ts — computeCost, TokenUsage (nền token accounting)
// ✅ packages/core telemetry.ts — TelemetrySink (nền event)
// ✅ source/rtk src/core/filter.rs — FilterStrategy (NoFilter/Minimal/Aggressive)
//   + src/core/truncate.rs (cap) (Rust reference — port sang TS hoặc gọi native)

// ❌ THIẾU: 4-strategy reducer pipeline trên bash output
// ❌ THIẾU: never-worse guard (fallback raw khi lọc mất thông tin)
// ❌ THIẾU: dedup counter + grouping by dir/error
```

## Implementation

```typescript
// packages/tools/src/cli-reducer.ts (NEW)
export interface ReduceOpts {
  maxLines: number;        // truncation cap
  keepTail: boolean;       // error thường cuối
}

/** 4-strategy pipeline — never worse: thông tin lọc ≥ raw. */
export function reduceCli(raw: string, o: ReduceOpts): string {
  let out = raw;
  // 1. FILTERING — strip noise (progress bar, blank, deprecation).
  out = out.split("\n").filter((l) => !/^\s*$| Progress |deprecat/i.test(l)).join("\n");
  // 2. GROUPING — gom dòng trùng prefix (dir/error type).
  const groups = new Map<string, string[]>();
  for (const l of out.split("\n")) {
    const key = l.split(/\s+/)[0] ?? "?";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }
  // 3. DEDUP — log lặp → "line × N".
  const lines = [...groups.values()].flat();
  const deduped = lines.length > 1 ? dedupWithCount(lines) : lines;
  // 4. TRUNCATION — cap, giữ tail.
  const arr = o.keepTail ? deduped.slice(-o.maxLines) : deduped.slice(0, o.maxLines);
  return neverWorse(raw, arr.join("\n"));  // guard: fallback raw nếu mất thông tin
}
function dedupWithCount(lines: string[]): string[] {
  const c = new Map<string, number>();
  for (const l of lines) c.set(l, (c.get(l) ?? 0) + 1);
  return [...c.entries()].map(([l, n]) => (n > 1 ? `${l}  ×${n}` : l));
}
// neverWorse: nếu reduceCli output ngắn hơn đáng kể nhưng thiếu keyword (error/
//   fail) có trong raw → trả raw. bash tool: resolve(reduceCli(stdout, opts)).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ -60-90% token — output dài → vài dòng thiết yếu | ❌ Reducer có thể mất thông tin — cần never-worse guard |
| ✅ Deterministic, nhanh, rẻ (không LLM) | ❌ Per-command reducer cần maintain (git/npm/docker riêng) |
| ✅ Nối bash tool (có sẵn execution) | ❌ Grouping/dedup heuristic — sai cấu trúc → gộp nhầm |
| ✅ Nối AJP tracking (đo savings) | ❌ Rust port hoặc native bridge — thêm dependency |

## Khác các hướng gần

| | AJL Token CLI Proxy | AJP Tracking Analytics | NA Det. Reducers |
|---|---|---|---|
| Trọng tâm | 4-strategy lọc output | Đo savings per-command | Per-command structured reducer |
| Cơ chế | filter/group/truncate/dedup | SQLite + retention + aggregate | git/npm/docker parser |
| Quan hệ | Tiết kiệm token (động cơ) | Đo lường tiết kiệm | Một chiến lược (filtering nâng cao) |

## Khi nào chọn

- Bash tool trả output dài nuốt token — muốn giảm 60-90%
- Muốn deterministic (không LLM) — nhanh rẻ tái lặp
- Đã có compressors generic — muốn per-command structured reducer
- Guard: never-worse (fallback raw khi mất thông tin), keepTail cho error, dedup counter, đo savings (nối AJP)
