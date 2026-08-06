# Hướng AEY: Raw Paste Bracketed Mode — bắt cặp escape `\x1b[200~/201~` để nhận paste dạng text thuần

> **Nguồn gốc:** pi-extensions2 | **Coupling:** 🟢 — terminal input handling | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn strip-ANSI trong output-compress; thiếu paste parser) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions2** (raw-paste/index.ts): bắt cặp **escape sequence paste bracket** `\x1b[200~` (bắt đầu paste) / `\x1b[201~` (kết thúc paste) để **nhận paste dạng text thuần** — **normalize CRLF→LF** — thay vì **mất nội dung trong `[paste #1 +21 lines]`** (một số terminal/TUI khi paste nhiều dòng chỉ hiển thị placeholder gom dòng, agent không đọc được nội dung thật).

Giá trị: (1) **đọc được paste thật** — user paste 50 dòng config → agent nhận đủ text (không phải "[paste #1 +21 lines]"); (2) **chuẩn hóa** — CRLF→LF (paste từ Windows/email) → text sạch, khớp với file LF; (3) **phân biệt paste với gõ tay** — escape bracket cho biết ranh giới paste — không lẫn với typing từng ký tự (mỗi ký tự là một event riêng).

## Mô tả

Với mya, pattern = **paste bracket parser trong input path**: (1) **enable bracketed paste** — gửi `\x1b[?2004h` lúc session start (tắt khi exit) — terminal bọc mọi paste vào `\x1b[200~ … \x1b[201~`; (2) **parser state machine** — stdin stream: ngoài paste → gom ký tự thường; gặp `\x1b[200~` → vào trạng thái paste (gom mọi thứ tới `\x1b[201~`); (3) **normalize** — CRLF→LF, strip ký tự điều khiển ngoài lề (nối AEM-style hygiene — paste là untrusted input); (4) **emit** — paste hoàn chỉnh thành 1 event (không phải từng ký tự) — agent nhận đúng khối; (5) **an toàn** — escape khác (AEX focus `\x1b[I/O`, AEY cũng phải phân biệt với paste bracket) — parser phải đúng thứ tự: bracket trước, focus sau. Đây là pattern **input boundary parsing**: ranh giới do terminal đánh dấu, agent parse đúng khối thay vì đoán.

## Kiến trúc (ASCII)

```
  USER PASTE (nhiều dòng — từ clipboard)
    │
    ▼ TERMINAL (bracketed paste ENABLED: \x1b[?2004h)
  \x1b[200~  (bắt đầu)
  dòng 1\r\n
  dòng 2\r\n
  \x1b[201~  (kết thúc)
    │
    ▼ PASTE PARSER (state machine trên stdin)
  ├─ gặp \x1b[200~ ──► mode PASTE (gom mọi thứ)
  ├─ gặp \x1b[201~ ──► mode NORMAL — emit khối paste
  └─ ngoài paste ──► ký tự thường (từng phím)
    │
    ▼ NORMALIZE: CRLF→LF · strip control chars (untrusted input)
    ▼ EMIT 1 event paste hoàn chỉnh (agent đọc đủ text)
  (không còn "[paste #1 +21 lines]" — không mất nội dung)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/output-compress.ts — strip ANSI escape sequences
//   (nền xử lý escape — dùng lại cho input path)
// ✅ packages/print — transport (nơi quản lý escape sequence session)
// ✅ packages/intercom/src/ui — input surface (nơi nhận text)
// ✅ packages/core/src/loop.ts — vòng nhận user input (điểm emit paste)
// ✅ packages/print/src/focus-recap.ts (AEX) — cùng lớp escape parsing

// ❌ THIẾU: bracketed paste enable/disable (\x1b[?2004h/l)
// ❌ THIẾU: paste parser state machine (\x1b[200~/201~)
// ❌ THIẾU: normalize CRLF→LF + strip control chars trước khi emit
```

## Implementation

```typescript
// packages/print/src/raw-paste.ts (NEW)
export type PasteState = "normal" | "pasting";

export class RawPasteParser {
  private state: PasteState = "normal";
  private buffer: string[] = [];

  constructor(
    private emit: (paste: string) => void,      // 1 event cho cả khối paste
    private write: (s: string) => void,         // stdout — gửi escape
  ) {}

  enable(): void { this.write("\x1b[?2004h"); } // bật bracketed paste
  disable(): void { this.write("\x1b[?2004l"); }

  /** Feed từng chunk stdin — state machine phân biệt paste vs gõ tay. */
  feed(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      if (this.state === "normal" && chunk.startsWith("\x1b[200~", i)) {
        this.state = "pasting";
        this.buffer = [];
        i += 5;                                 // nhảy qua marker
        continue;
      }
      if (this.state === "pasting" && chunk.startsWith("\x1b[201~", i)) {
        this.state = "normal";
        this.emit(normalizePaste(this.buffer.join("")));  // CRLF→LF
        this.buffer = [];
        i += 5;
        continue;
      }
      if (this.state === "pasting") this.buffer.push(chunk[i]!);
    }
  }
}

/** Normalize paste: CRLF→LF + strip control chars (paste = untrusted). */
export function normalizePaste(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")   // Windows/old-Mac
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // control chars (trừ \n \t)
}
// Thứ tự parse: bracket (AEY) trước focus (AEX) — không lẫn escape
// Enable lúc start + disable lúc exit — cùng chỗ với \x1b[?1004h/l
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đọc được paste thật — không mất nội dung | ❌ Terminal không hỗ trợ bracketed paste → paste vỡ (cần fallback) |
| ✅ CRLF→LF — paste từ Windows/email sạch | ❌ Buffer paste lớn → tốn RAM (cần cap) |
| ✅ Phân biệt paste vs gõ tay — ranh giới rõ | ❌ Escape giả mạo từ input lạ (cần validate thứ tự) |
| ✅ 1 event cho cả khối — agent nhận đúng ngữ cảnh | ❌ Paste có escape hợp lệ bị strip nhầm (chính sách control chars) |

## Khác các hướng gần

| | AEY Raw Paste | AEX Focus Recap | AEM Inline Escaping |
|---|---|---|---|
| Trọng tâm | Nhận paste text thuần | Vẽ recap đúng lúc | Chống XSS embed |
| Cơ chế | Paste bracket + normalize | DECSET ?1004 + fallback | escape `<>&` |
| Quan hệ | Cùng lớp escape (AEX) | Cùng input path | Khác miền (render) |

## Khi nào chọn

- User hay paste khối lớn (config, code, log) vào terminal agent
- Terminal hỗ trợ bracketed paste (xterm, kitty, wezterm, tmux 3.x)
- Đã có strip-ANSI + input path — thêm paste parser
- Cần normalize CRLF→LF để paste khớp với file LF trong workspace