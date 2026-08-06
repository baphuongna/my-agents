# Hướng SN: Session HTML Export — CLI --export transcript session thành HTML tĩnh ANSI→HTML

> **Nguồn gốc:** pi-coding-agent (session export); "CLI --export transcript to HTML"; "ANSI escape to HTML conversion"; "static shareable session HTML"; "terminal session archive"
> **Coupling:** 🟢 — thêm export command + ANSI→HTML converter (read session, không đổi core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session store JSONL + CLI sẵn — chưa có ANSI→HTML converter + export renderer)
> **Effort:** 1-2 tuần

## Nguồn gốc

**pi-coding-agent** CLI flag `--export`: chuyển **transcript session** (JSONL — messages, tool calls, tool results) thành **HTML tĩnh** — shareable, viewable trong browser, **không cần agent running**. Đặc biệt: **ANSI escape codes** (màu terminal, bold, cursor) → **HTML** (span style, color) để render đúng như terminal. Nguyên tắc: **session = artifact** — export ra file độc lập (self-contained HTML), share được (gửi đồng nghiệp, đính issue), archive được. ANSI→HTML là phần kỹ thuật chính (escape `\x1b[31m` → `<span style="color:red">`). Khác session-log đọc trong TUI — SN là **static export** (không interactive, chỉ xem).

## Mô tả

mya session HTML export: (1) **CLI flag**: `mya --export <session-id> --out report.html`. (2) **Load session**: đọc session JSONL (435 entry format — header, messages, tool calls/results). (3) **ANSI→HTML**: convert escape codes (color, bold, underline) → HTML span/style. (4) **Render**: template HTML — message bubbles (user/assistant/tool), code blocks, tool call/result cards, timestamp. (5) **Self-contained**: HTML inline CSS (không external dep) → mở trực tiếp browser, share file độc lập. (6) **Archive**: file HTML lưu được, reopen bất cứ lúc nào. mya có session store JSONL + CLI — SN thêm **ANSI→HTML converter** + **HTML template renderer**.

## Kiến trúc

```
  CLI: mya --export <session-id> --out report.html
        │
        ▼
  ┌─── LOAD SESSION (JSONL) ────────────────────────────┐
  │  entries: header, user msg, assistant msg + toolCall, │
  │           toolResult (435 entry format)               │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── ANSI → HTML CONVERT ─────────────────────────────┐
  │  "\x1b[31merror\x1b[0m" → '<span style="color:red">  │
  │                            error</span>'              │
  │  "\x1b[1mbold\x1b[0m"   → '<b>bold</b>'              │
  │  (color/bold/underline/cursor → HTML span/style)      │
  └───────────────┬─────────────────────────────────────┘
                  │
                  ▼
  ┌─── RENDER HTML TEMPLATE ────────────────────────────┐
  │  <html><style inline>...</style>                     │
  │    <div class="msg user">...user text...</div>        │
  │    <div class="msg assistant">...reply...             │
  │      <div class="toolCall">edit(x.ts)</div>           │
  │      <div class="toolResult">✓ applied</div>          │
  │    </div>                                             │
  │  </html>  (self-contained, inline CSS)                │
  └───────────────┬─────────────────────────────────────┘
                  │ write
                  ▼
  report.html → mở browser / share / archive
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session store — JSONL (435 format) (nền — SN load + render)
// ✅ CLI — command parsing (nền — SN thêm --export flag)
// ✅ print/render — terminal output (nền — SN ANSI→HTML)

// ❌ THIẾU: ANSI→HTML converter (escape → span/style)
// ❌ THIẾU: HTML template renderer (messages/tool → bubbles)
// ❌ THIẾU: --export CLI flag + self-contained inline CSS
```

## Implementation

```typescript
// packages/agent/src/session-html-export.ts (MỚI)
import { writeFileSync, readFileSync } from 'node:fs';

const ANSI_COLORS: Record<number, string> = {
  31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan',
};

class SessionHtmlExport {
  // ANSI escape → HTML
  ansiToHtml(s: string): string {
    let out = s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // escape HTML
      .replace(/\x1b\[(\d+)m/g, (_, code) => { // color
        const c = ANSI_COLORS[Number(code)];
        return c ? `<span style="color:${c}">` : '</span>';
      })
      .replace(/\x1b\[1m/g, '<b>').replace(/\x1b\[22m/g, '</b>') // bold
      .replace(/\x1b\[4m/g, '<u>').replace(/\x1b\[24m/g, '</u>'); // underline
    return out;
  }

  // render session JSONL → self-contained HTML
  export(jsonlPath: string, outPath: string): void {
    const entries = readFileSync(jsonlPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const body = entries.map((e: any) => {
      if (e.type === 'message') {
        const role = e.message?.role ?? 'unknown';
        const content = this.ansiToHtml(typeof e.message?.content === 'string' ? e.message.content : JSON.stringify(e.message?.content ?? ''));
        return `<div class="msg ${role}"><span class="role">${role}</span>${content}</div>`;
      }
      return '';
    }).join('\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:monospace;max-width:900px;margin:2rem auto}
      .msg{padding:.5rem;margin:.3rem 0;border-radius:4px}
      .user{background:#eef}.assistant{background:#efe}
      .role{font-weight:bold;margin-right:.5rem;text-transform:uppercase;font-size:.8em;color:#666}
    </style></head><body>${body}</body></html>`;
    writeFileSync(outPath, html, 'utf8');
  }
}

// Usage (CLI --export):
// const exp = new SessionHtmlExport();
// exp.export('.mya/sessions/abc.jsonl', 'report.html');
// → mở report.html trong browser (self-contained, share/archive được)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Shareable (HTML tĩnh, gửi đồng nghiệp/issue) | ❌ Static (không interactive — chỉ xem) |
| ✅ ANSI đúng (màu terminal render chuẩn) | ❌ File lớn (inline CSS + content đầy đủ) |
| ✅ Archive (lưu, reopen bất cứ lúc nào) | ❌ ANSI→HTML không hoàn hảo (1 số escape phức tạp) |
| ✅ Self-contained (không external dep) | ❌ Export overhead (render toàn session) |

## Khác các hướng gần

| | Session TUI view | Log cat | SN: Session-HTML-Export |
|---|---|---|---|
| Format | Terminal interactive | Text raw | **HTML tĩnh (browser)** |
| Share | ❌ (cần agent) | ❌ (raw) | **✅ (file độc lập)** |
| ANSI | Terminal native | Raw escape | **✅ → HTML span** |

## Khi nào chọn

- Muốn share session (gửi đồng nghiệp, đính issue/PR)
- Cần archive (lưu transcript, reopen sau)
- Output nhiều ANSI (màu terminal — cần render đúng)
- Nối session store JSONL (435) + CLI; guard ANSI→HTML completeness (cursor/256-color/truecolor — fallback) + self-contained (inline CSS, không CDN) + export fidelity (tool call/result render rõ); phối 508 export — offline static artifact
