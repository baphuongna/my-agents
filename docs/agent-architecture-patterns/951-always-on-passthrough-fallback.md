# Hướng AJO: Always-On Passthrough Fallback — không nhận ra subcommand thì execute raw (passthrough) + ghi event vào tracking DB; never block, đảm bảo "always on" an toàn

> **Nguồn gốc:** rtk | **Coupling:** 🟢 — fallback safety cho CLI proxy | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có bash tool luôn raw; chưa có passthrough-event gating) | **Effort:** 0.5 tuần

## Nguồn gốc

**rtk** nếu **không nhận ra subcommand**, **execute command thô (passthrough)** và **ghi event vào tracking database** — không bao giờ block command, đảm bảo **"always on" an toàn**. Mục đích: proxy (AJL/AJM) là best-effort; khi filter/rewrite không áp dụng được (subcommand lạ, guard fail, lexer fail), **command vẫn chạy raw** + được track để phân tích sau.

Nguyên tắc: **never block** — proxy augment (giảm token/rewrite) chứ không gate; không nhận ra → passthrough raw; **track mọi passthrough** — ghi event (command, reason: "unknown-subcommand"/"guard"/"lexer-fail") vào DB để đo coverage; **fail-open** — bất kỳ lỗi nào trong filter/rewrite layer → passthrough (không crash, không block); **always on** — proxy luôn active nhưng vô hại khi không match.

## Mô tả

Với mya, pattern = **passthrough safety net cho AJL/AJM**: (1) **mya có bash tool (builtin.ts)** — luôn spawn raw, không có reducer layer → hiện vốn đã passthrough; (2) **AJO thêm explicit passthrough path** trong reducer pipeline: khi không nhận ra subcommand / guard fail / lexer fail → spawn raw + track event; (3) **track event** — `{ command, reason, at }` vào tracking (nối AJP SQLite) để đo reducer coverage; (4) **fail-open** — try { rewrite+reduce } catch { passthrough(raw) + track(lexer-fail) }; (5) **never-worse** (nối AJL) — reducer mất thông tin → passthrough raw; (6) **gate** — `RTK_DISABLED` env → passthrough toàn bộ (opt-out); (7) **coverage metric** — % command được reduce vs passthrough (nối AJP analytics).

## Kiến trúc (ASCII)

```
  LLM ──bash cmd──► [REDUCER PIPELINE (AJL + AJM)]
                       │
                       ▼ nhận ra subcommand? guard OK? lexer OK?
                       │
                ┌──────┴──────┐
              YES             NO (unknown subcommand / guard fail / lexer fail)
                │              │
                ▼              ▼ FAIL-OPEN
          REDUCE output    PASSTHROUGH RAW (spawn /bin/bash -c nguyên bản)
                │              │
                └──────┬───────┘
                       ▼ TRACK EVENT (nối AJP)
                       { command, reason: "reduced"|"unknown"|"guard"|"lexer-fail", at }
                       │
                       ▼ NEVER BLOCK — always on (RTK_DISABLED → passthrough toàn bộ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools builtin.ts — bash tool (spawn /bin/bash -c raw) — vốn đã
//   passthrough (nền execution — AJO là explicit hóa path này)
// ✅ packages/core telemetry.ts — TelemetrySink (nền track event)
// ✅ packages/core exit.ts — NativeResult (fail-open pattern — no process exit)
// ✅ source/rtk src/core/runner.rs — emit_guarded, never_worse (Rust reference)
// ✅ packages/core redact.ts — secret filter (nền guard)

// ❌ THIẾU: explicit passthrough path trong reducer pipeline + track reason
// ❌ THIẾU: fail-open try/catch wrap reducer/rewrite
// ❌ THIẾU: RTK_DISABLED opt-out gate + coverage metric (nối AJP)
```

## Implementation

```typescript
// packages/tools/src/passthrough.ts (NEW) — safety net cho AJL/AJM
import { rewriteCommand, shouldPassthrough } from "./cmd-rewrite.js";
import { reduceCli } from "./cli-reducer.js";

export type PassthroughReason = "unknown" | "guard" | "lexer-fail" | "disabled";

export interface TrackEvent {
  command: string; reason: "reduced" | PassthroughReason; at: number;
}

/** Always-on: try reduce, fail-open passthrough — never block. */
export function resolveOutput(
  rawStdout: string,
  cmd: string,
  onTrack: (e: TrackEvent) => void,
  now: number,
): string {
  if (process.env.RTK_DISABLED) {                  // opt-out gate
    onTrack({ command: cmd, reason: "disabled", at: now });
    return rawStdout;                              // passthrough toàn bộ
  }
  if (shouldPassthrough(cmd)) {                    // guard (AJM) → raw
    onTrack({ command: cmd, reason: "guard", at: now });
    return rawStdout;
  }
  try {
    const reduced = reduceCli(rawStdout, { maxLines: 40, keepTail: true });
    onTrack({ command: cmd, reason: "reduced", at: now });
    return reduced;
  } catch {                                        // FAIL-OPEN
    onTrack({ command: cmd, reason: "lexer-fail", at: now });
    return rawStdout;                              // never block
  }
}
// bash tool: sau child close → resolveOutput(stdout, cmd, track, now).
// track → AJP SQLite (coverage metric: % reduced vs passthrough).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Never block — command luôn chạy (safety) | ❌ Passthrough không tiết kiệm token (fallback) |
| ✅ Fail-open — lỗi reducer không crash agent | ❌ Track event phình — cần retention (nối AJP) |
| ✅ Coverage metric — đo % reducer hiệu quả | ❌ RTK_DISABLED phải rõ — tránh vô hiệu nhầm |
| ✅ Nối AJL (never-worse) + AJM (guard) + AJP (track) | ❌ Phải wrap mọi reducer path bằng try/catch |

## Khác các hướng gần

| | AJO Passthrough Fallback | AJL Token CLI Proxy | AJP Tracking Analytics |
|---|---|---|---|
| Trọng tâm | Safety net always-on | 4-strategy reduction | Đo savings + coverage |
| Cơ chế | fail-open passthrough + track | filter/group/truncate/dedup | SQLite + retention + aggregate |
| Quan hệ | Fallback khi AJL/AJM fail | Động cơ tiết kiệm | Nhận track event từ AJO |

## Khi nào chọn

- Reducer/rewrite layer (AJL/AJM) thêm — cần safety net never-block
- Quan tâm fail-open — lỗi layer không crash agent
- Muốn đo coverage reducer (nối AJP)
- Guard: try/catch wrap mọi reducer path, RTK_DISABLED opt-out rõ, track reason phân loại, retention cho event (nối AJP), never block
