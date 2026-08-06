# Hướng TA: Openhuman Ambient Window-Context Capture — nền chụp cửa sổ active OCR+vision ghi memory; consent+TTL

> **Nguồn gốc:** openhuman `desktop_companion/` (`pipeline.rs`, `schemas.rs`, `types.rs`, screenshot tools), `tools/impl/browser/screenshot`, `local_cli.rs` (screenshot wrappers); "ambient capture of active window"; "OCR + vision → memory"; "consent-gated"; "TTL expiry" | **Coupling:** 🟡 — thêm ambient capture pipeline (chụp nền → OCR/vision → memory, consent + TTL gate) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có ambient capture + OCR/vision + consent/TTL gate) | **Effort:** 4-5 tuần

## Nguồn gốc

**openhuman** desktop companion chạy **ambient capture** nền: định kỳ chụp **cửa sổ active** (foreground window) → **OCR** (text) + **vision** (understand nội dung UI) → ghi vào **memory** (context agent có thể dùng: "user đang đọc doc X", "user vừa xem email Y"). Nguyên tắc cốt lõi: **consent + TTL** — (1) **consent**: chỉ chụp khi user cho phép (privacy gate, opt-in rõ), (2) **TTL**: mỗi capture có time-to-live (hết hạn → xóa, không tích lũy vô hạn). Mục đích: agent có **context ambient** (biết user đang làm gì) nhưng tôn trọng privacy. Khác **463 typed-query** (query khi cần) — TA là **passive ambient capture**; khác keylogger — TA **OCR/vision không keystroke** + consent + TTL.

## Mô tả

mya ambient window-context capture: (1) **Capture**: định kỳ chụp cửa sổ active (screenshot foreground window). (2) **OCR + vision**: extract text (OCR) + hiểu nội dung (vision model → "doc about auth", "email from boss"). (3) **Consent gate**: chỉ capture khi user opt-in (privacy, có thể pause bất cứ lúc). (4) **TTL**: mỗi memory entry có expiry (vd 1h) → tự xóa khi hết hạn. (5) **Memory write**: ghi structured (window-title, content-summary, timestamp, ttl). mya có screenshot tool + memory — TA thêm **ambient pipeline** + **OCR/vision** + **consent/TTL gate**.

## Kiến trúc

```
  USER mở cửa sổ (doc/email/editor) — foreground active
        │ (mỗi N giây, NẾU consent)
        ▼
  ┌─── CAPTURE (screenshot foreground window) ───────────┐
  │  consent? → YES (opt-in) → chụp / NO → skip            │
  └───────────────────────┬─────────────────────────────┘
                          │ (image)
                          ▼
  ┌─── OCR + VISION ─────────────────────────────────────┐
  │  OCR: extract text ("RFC 6749 OAuth 2.0")              │
  │  vision: understand ("doc about OAuth auth flow")      │
  └───────────────────────┬─────────────────────────────┘
                          │ (structured entry)
                          ▼
  ┌─── MEMORY WRITE (consent + TTL) ─────────────────────┐
  │  { window:"RFC6749.pdf", summary:"OAuth auth flow",    │
  │    ts: now, ttl: 1h }                                   │
  │  → hết TTL (1h) → auto-xóa (không tích lũy)            │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools screenshot — capture (nền — TA chụp foreground)
// ✅ packages/memory brain-store — memory write (nền — TA ghi + TTL)
// ✅ packages/ai vision — image understanding (nền — TA vision)

// ❌ THIẾU: ambient capture scheduler (định kỳ chụp nền)
// ❌ THIẾU: foreground-window detector (active window title/bounds)
// ❌ THIẾU: OCR layer (image → text)
// ❌ THIẾU: consent gate (opt-in, pause bất cứ lúc)
// ❌ THIẾU: TTL expiry (auto-xóa memory hết hạn)
```

## Implementation

```typescript
// packages/agent/src/ambient-capture.ts (MỚI)
interface CaptureEntry { window: string; summary: string; ts: number; ttlMs: number }

class AmbientCapture {
  private consent = false;
  constructor(
    private now: () => number,
    private screenshot: () => Promise<Buffer>,
    private foregroundWindow: () => Promise<string>, // title of active window
    private ocr: (img: Buffer) => Promise<string>,
    private vision: (img: Buffer) => Promise<string>,
    private writeMemory: (e: CaptureEntry) => void,
    private ttlMs: number,
  ) {}

  // consent gate (user opt-in)
  setConsent(on: boolean): void { this.consent = on; }

  // capture cycle (called periodically)
  async capture(): Promise<void> {
    if (!this.consent) return; // privacy gate
    const img = await this.screenshot();
    const window = await this.foregroundWindow();
    const text = await this.ocr(img);
    const summary = await this.vision(img);
    this.writeMemory({
      window,
      summary: `${summary}\n${text.slice(0, 200)}`,
      ts: this.now(),
      ttlMs: this.ttlMs,
    });
  }

  // TTL sweep (delete expired — call periodically)
  sweep(isExpired: (ts: number, ttlMs: number) => boolean, deleteMemory: (ts: number) => void): void {
    // brain-store iterate → delete entries where now - ts > ttlMs
  }
}

// Usage:
// capture.setConsent(true);            // user opt-in
// setInterval(() => capture.capture(), 30_000);  // ambient mỗi 30s
// setInterval(() => capture.sweep(...), 60_000); // TTL sweep
// → memory: "user reading OAuth doc" (auto-xóa sau 1h)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent có context ambient (biết user đang làm gì) | ❌ Privacy risk (cần consent rõ, dễ lạm dụng) |
| ✅ OCR+vision (hiểu nội dung, không chỉ title) | ❌ Capture cost (screenshot + OCR + vision mỗi cycle) |
| ✅ TTL (không tích lũy vô hạn, tự dọn) | ❌ Sensitive content (password/email → leak nếu memory breach) |
| ✅ Consent gate (user kiểm soát) | ❌ Foreground detect platform-specific |

## Khác các hướng gần

| | 463 Typed-Query | Keylogger | TA: Ambient-Capture |
|---|---|---|---|
| Cái gì | Query khi cần | Ghi keystroke | **Passive chụp nền → OCR/vision** |
| Mode | Active (pull) | Always | **Passive + consent + TTL** |
| Privacy | ❌ | ❌ (invasive) | **✅ consent + TTL expiry** |

## Khi nào chọn

- Agent cần context ambient (biết user đang làm gì để proactively giúp)
- User chấp nhận (consent opt-in rõ, pause được)
- Muốn OCR/vision (không keystroke) + TTL (tự dọn)
- Nối packages/tools screenshot + packages/memory brain-store (TTL) + packages/ai vision; guard privacy (consent gate bắt buộc, default off, pauseable), sensitive-content filter (redact password/email/secret trước ghi), và TTL sweep (auto-xóa, không tích lũy); TA = ambient capture, phải consent-first — đây là pattern nhạy cảm privacy, cần transparency cao
