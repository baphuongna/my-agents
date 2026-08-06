# Hướng AEX: Terminal Focus Recap — DECSET ?1004 focus reporting: mất focus draft recap nền, regain focus hiện widget

> **Nguồn gốc:** pi-extensions2 | **Coupling:** 🟢 — terminal integration, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn turn_end event; thiếu focus-aware rendering) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions2** (session-recap/index.ts): dùng **DECSET ?1004 focus reporting** (escape sequence terminal báo focus in/out): **mất focus** → **draft recap nền** (không vẽ lên terminal đang bận); **regain focus** → **hiện widget trên editor** (recap vừa draft xong); **fallback idle 45s sau turn_end** nếu terminal **không hỗ trợ focus event** (một số terminal/TMUX không gửi focus report).

Giá trị: (1) **không phá màn hình khi user đang ở app khác** — draft trong bộ nhớ, chỉ vẽ khi terminal focus lại; (2) **recap đúng lúc** — user quay lại thấy tóm tắt turn vừa xong (không bị trễ/faded); (3) **progressive enhancement** — terminal hỗ trợ focus event → UX tốt; không hỗ trợ → fallback timer vẫn hoạt động (không mất chức năng cốt lõi).

## Mô tả

Với mya, pattern = **focus-aware terminal rendering** cho recap/status UI: (1) **enable focus report** — gửi `\x1b[?1004h` lúc session start (tắt `\x1b[?1004l` khi exit) — mya print transport (packages/print) là nơi quản lý escape sequence; (2) **listener** — parse `\x1b[I` (focus in) / `\x1b[O` (focus out) từ stdin; (3) **state machine** — `turn_end` → nếu focus-in: render recap ngay; focus-out: lưu `pendingRecap`, **không vẽ**; focus-in: render pending; không có focus event trong 45s (fallback): render luôn; (4) **an toàn** — gửi escape sequence phải qua strip-ANSI an toàn (không để tool output giả mạo focus event — validate stdin chỉ từ terminal, nối AEY raw-paste xử lý escape nhập). Đây là pattern **environment-aware UI**: tận dụng khả năng terminal khi có, degrade êm khi không.

## Kiến trúc (ASCII)

```
  SESSION START ──► \x1b[?1004h (bật focus reporting)
    │
    ▼ LOOP
  turn_end ──► recap event (packages/core loop — đã có turn boundary)
    │
    ├─ focus IN (\x1b[I) ──► RENDER recap widget ngay
    ├─ focus OUT (\x1b[O) ──► draft PENDING (không vẽ lên terminal đang bận)
    │                          └─ focus IN lại ──► RENDER pending
    └─ idle 45s (không focus event — terminal không hỗ trợ)
          ──► RENDER luôn (fallback — chức năng vẫn chạy)
    │
    ▼ SESSION EXIT ──► \x1b[?1004l (tắt)
  (validate escape từ stdin — chống giả mạo focus event)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/agents-panel.ts — panel/widget render (nền vẽ recap)
// ✅ packages/core/src/loop.ts — turn_end (ranh giới turn — điểm draft recap)
// ✅ packages/print/src/bg-runner.ts — background session (recap path khác)
// ✅ packages/core/src/types.ts — RuntimeEvent (event stream — recap source)
// ✅ packages/intercom/src/ui — widget UI pattern (compose/session-list)

// ❌ THIẾU: focus reporting enable/disable (\x1b[?1004h/l)
// ❌ THIẾU: focus event listener + state machine (pending/rendered)
// ❌ THIẾU: fallback idle 45s + validate escape stdin
```

## Implementation

```typescript
// packages/print/src/focus-recap.ts (NEW)
export type FocusState = "in" | "out" | "unsupported";

export class FocusRecap {
  private pending: string | null = null;
  private state: FocusState = "unsupported";
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private write: (s: string) => void,           // stdout — gửi escape
    private render: (recap: string) => void,      // vẽ widget
    private onData: (cb: (chunk: string) => void) => void,  // stdin
  ) {}

  enable(): void {
    this.write("\x1b[?1004h");                    // bật focus reporting
    this.onData((chunk) => {
      for (const seq of chunk.match(/\x1b\[[IO]/g) ?? []) {
        if (seq === "\x1b[I") this.onFocusIn();   // focus in
        else this.onFocusOut();                   // focus out
      }
    });
  }

  /** turn_end: có recap — focus in thì render, out thì draft nền. */
  scheduleRecap(text: string): void {
    this.pending = text;
    if (this.state === "in") this.renderNow();
    else {
      // Fallback: idle 45s không focus event → render luôn.
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(() => this.renderNow(), 45_000);
    }
  }

  private onFocusOut(): void { this.state = "out"; }        // không vẽ
  private onFocusIn(): void {
    this.state = "in";
    clearTimeout(this.fallbackTimer);
    if (this.pending) this.renderNow();                     // quay lại → hiện widget
  }
  private renderNow(): void {
    if (!this.pending) return;
    this.render(this.pending);
    this.pending = null;
  }
  disable(): void { this.write("\x1b[?1004l"); }            // tắt khi exit
}
// Chống giả mạo: chỉ parse escape từ stdin terminal (không từ tool output)
// Nối AEY: xử lý escape nhập thô (paste bracket) tách khỏi focus event
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không vẽ lên terminal khi user đang ở app khác | ❌ Một số terminal/TMUX không gửi focus event (phải fallback) |
| ✅ Recap hiện đúng lúc user quay lại | ❌ Escape sequence dễ bị giả mạo từ input lạ (cần validate) |
| ✅ Progressive enhancement — không mất chức năng cốt lõi | ❌ 45s fallback có thể vẽ sai lúc (user vẫn đang bận) |
| ✅ turn_end event đã có — chỉ thêm lớp focus | ❌ Focus state mất sync nếu terminal reset (cần re-enable) |

## Khác các hướng gần

| | AEX Focus Recap | AEY Raw Paste | AEZ Tab Status |
|---|---|---|---|
| Trọng tâm | Vẽ recap đúng lúc focus | Nhận paste text thuần | Trạng thái session |
| Cơ chế | DECSET ?1004 + fallback timer | Paste bracket escape | Event + watchdog |
| Quan hệ | Cùng lớp escape handling (AEY) | Xử lý escape nhập | Trạng thái khác (tab) |

## Khi nào chọn

- Recap/notification UI trong terminal — không muốn vẽ khi user vắng mặt
- Terminal hiện đại hỗ trợ focus reporting (xterm, kitty, wezterm…)
- Đã có turn_end event + panel render — thêm lớp focus
- Cần fallback êm cho terminal không hỗ trợ (không mất tính năng)