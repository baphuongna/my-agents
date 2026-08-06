# Hướng AGW: Terminal Native Progress OSC — pi-status dùng Ghostty OSC 9;4 native progress bar + focus reporting OSC 1004, ghi thẳng /dev/tty; keepalive duy trì trạng thái, clear khi user focus lại

> **Nguồn gốc:** piolium | **Coupling:** 🔴 — bind vào terminal protocol cụ thể (Ghostty OSC) | **Agent-agnostic:** ✅ (terminal infra thuần) | **Code sẵn:** ❌ (mya dùng TUI ink, KHÔNG có native OSC progress/focus) | **Effort:** 1 tuần

## Nguồn gốc

**piolium** (Ghostty terminal) hỗ trợ **OSC 9;4** — **native progress bar** render bởi terminal itself (không phải TUI vẽ character). pi-status gửi escape sequence `\x1b]9;4;<value>\x07` (value: `0`=clear, `1`=error, `2`=indeterminate, `3-100`=percent) **thẳng vào `/dev/tty`** (bypass stdout pipe — kể cả khi output redirect). Kết hợp **OSC 1004** focus reporting (terminal báo khi window focus gain/loss). **Keepalive interval** duy trì trạng thái progress (terminal reset khi mất focus); **clear khi user focus lại** (không để progress bar kẹt).

Nguyên tắc: **native terminal feature** (OSC escape, không TUI vẽ); **ghi /dev/tty bypass pipe** (output redirect không mất); **keepalive duy trì** (terminal reset); **clear on focus** (UX sạch, không kẹt bar).

## Mô tả

Với mya, TUI dùng **Ink** (React CLI renderer) vẽ character — **chưa có** layer **native terminal OSC**: (1) **OSC 9;4 progress bar** (delegated render cho terminal), (2) **OSC 1004 focus reporting**, (3) **ghi /dev/tty** (bypass stdout pipe). Pattern này quan trọng cho terminal hiện đại (Ghostty/Kitty/iTerm) — native progress bar mượt hơn TUI vẽ, focus reporting cho reactive UI.

## Kiến trúc (ASCII)

```
  agent progress (tokens / task %)
        │
        ▼
  OSC 9;4 native progress bar  →  \x1b]9;4;<value>\x07  ghi /dev/tty
        │   value: 0=clear,1=error,2=indeterminate,3-100=percent
        ▼
  OSC 1004 focus reporting  →  terminal báo focus gain/loss
        │   keepalive interval duy trì progress (terminal reset khi unfocus)
        ▼
  user focus lại → clear progress (không kẹt bar)
  ── ghi /dev/tty: bypass stdout pipe (output redirect không mất native bar)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/runtimes/*.ts — TUI ink renderer (character-based)
// ✅ packages/core/src/telemetry.ts — telemetry/progress data
// ❌ KHÔNG có native terminal OSC (9;4 progress, 1004 focus reporting)
// ❌ KHÔNG có /dev/tty bypass (hiện ghi stdout, bị pipe redirect nuốt)
```

## Implementation

```typescript
// packages/print/src/native-osc.ts (NEW)
import { openSync, writeSync, closeSync } from "node:fs";

/** Ghi escape thẳng /dev/tty — bypass stdout pipe (output redirect không mất). */
function writeToTty(seq: string): void {
  try {
    const fd = openSync("/dev/tty", "w");
    writeSync(fd, seq);
    closeSync(fd);
  } catch { /* không có tty (CI) → noop, không crash */ }
}

/** OSC 9;4 native progress bar (Ghostty/Kitty). */
export function nativeProgress(value: number | "indeterminate" | "error" | "clear"): void {
  const v = value === "indeterminate" ? 2 : value === "error" ? 1 : value === "clear" ? 0 : Math.max(3, Math.min(100, value));
  writeToTty(`\x1b]9;4;${v}\x07`);
}

/** OSC 1004 focus reporting enable/disable. */
export function enableFocusReporting(on: boolean): void {
  writeToTty(on ? "\x1b[?1004h" : "\x1b[?1004l");
}

/** Keepalive: duy trì progress (terminal reset khi unfocus); clear on focus. */
export class NativeProgressKeepalive {
  private timer?: NodeJS.Timeout;
  constructor(private readonly value: number, private readonly intervalMs = 1000) {}
  start(): void {
    nativeProgress(this.value);
    this.timer = setInterval(() => nativeProgress(this.value), this.intervalMs);
  }
  /** User focus lại → clear (không kẹt bar). */
  onFocusGain(): void { clearInterval(this.timer); nativeProgress("clear"); }
  stop(): void { clearInterval(this.timer); nativeProgress("clear"); }
}
// Hook: agent progress → keepalive.start(); focus event → onFocusGain().
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Native progress bar mượt (terminal render) | ❌ Coupling terminal cụ thể (Ghostty OSC, 🔴) |
| ✅ /dev/tty bypass — output redirect không mất | ❌ OSC không hỗ trợ → noop (cần detect capability) |
| ✅ Focus reporting → reactive UI | ❌ Keepalive polling tốn nhẹ CPU |

## Khác các hướng gần

| | AGW Native OSC | AHF Unicode-Block | AHE Threshold-Color |
|---|---|---|---|
| Trọng tâm | Terminal native progress | TUI vẽ unicode block | Màu progress theo ngưỡng |
| Cơ chế | OSC 9;4 /dev/tty | █▏▎▍ partial blocks | pct → color segment |
| Quan hệ | Nối terminal protocol | Nối TUI visual | Nối progress visual |

## Khi nào chọn

- Terminal hiện đại (Ghostty/Kitty) hỗ trợ OSC — native progress mượt hơn TUI
- Cần progress bar sống qua output redirect (ghi /dev/tty)
- Muốn focus reporting reactive (UI phản ứng focus)
- Guard: detect capability, noop khi OSC không hỗ trợ, clear on focus, keepalive duy trì
