# Hướng YE: Tmux Scrape Control — skills/tmux điều khiển interactive CLI bằng send-keys + capture-pane `-S -200` scrape output theo socket riêng (claude.sock) — agent thao tác terminal sống như người dùng (skills/tmux/SKILL.md)

> **Nguồn gốc:** agent-stuff (skills/tmux/SKILL.md) | **Coupling:** 🟡 — thêm tool điều khiển tmux, không đổi core | **Agent-agnostic:** ⚠️ (tmux trên host) | **Code sẵn:** ⚠️ (có screen + codeexec — chưa có tmux control) | **Effort:** 2-3 tuần

## Nguồn gốc

**agent-stuff** skill tmux cho phép agent điều khiển **interactive CLI** (dev server, REPL, ssh session) như người dùng thật: **send-keys** gõ phím vào pane, **capture-pane -S -200** lấy 200 dòng output gần nhất. Mỗi ứng dụng có **socket riêng** (`claude.sock`) — các session tmux tách biệt, không đụng session của người dùng khác. Khác với spawn lệnh một phát rồi đọc stdout, tmux cho phép agent **giữ terminal sống**, quan sát output phát sinh theo thời gian thực, phản hồi prompt tương tác.

## Mô tả

mya áp dụng tmux-scrape-control: tool `tmux` mới: (1) `create(socket, name, cmd)` — tạo tmux server với socket riêng + pane chạy lệnh; (2) `send(socket, keys)` — gõ phím/chuỗi vào pane (như người gõ); (3) `scrape(socket, lines=200)` — `capture-pane -S -200` lấy output gần nhất; (4) `waitFor(socket, pattern, timeout)` — poll scrape đến khi thấy pattern (server ready, prompt xuất hiện). Agent dùng nó cho dev server (đợi "listening on port"), REPL tương tác, trình build hỏi y/n. Output scrape được **snapshot** về telemetry/context — không cần tail file. mya có sẵn tools/screen.ts (chụp màn hình desktop), codeexec (chạy lệnh), output-compress (nén output lớn) — YE thêm **tmux client** + **socket isolation** + **waitFor matcher**.

## Kiến trúc

```
  Agent ──► tmux tool
     │
     ├─ create(socket=claude.sock, "dev", "npm run dev")
     │      └─ tmux -L claude.sock new-session -d -s dev
     │
     ├─ waitFor(socket, /listening on port/, 30s)
     │      └─ loop: capture-pane -S -200 → match regex
     │
     ├─ send(socket, "curl localhost:3000\n")   ← gõ như người
     │
     └─ scrape(socket, 200)  → output gần nhất → context/telemetry
            └─ tmux -L claude.sock capture-pane -p -S -200
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools screen.ts — chụp màn hình desktop (nền — YE analog cho terminal)
// ✅ packages/tools codeexec.ts — chạy lệnh + đọc stdout (nền — YE một-phát khác sống)
// ✅ packages/tools output-compress.ts — nén output lớn (nền — YE scrape 200 dòng)
// ✅ packages/core spill.ts — payload lớn → ref (nền — YE output dài)

// ❌ THIẾU: tmux client (send-keys / capture-pane wrapper)
// ❌ THIẾU: socket isolation (claude.sock riêng per app)
// ❌ THIẾU: waitFor matcher (poll pattern với timeout)
```

## Implementation (TS)

```typescript
// packages/tools/src/tmux-control.ts (MỚI)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export class TmuxControl {
  constructor(private socket: string) {}

  private base(): string[] { return ["-L", this.socket]; } // socket riêng per app

  async create(name: string, cmd: string): Promise<void> {
    await run("tmux", [...this.base(), "new-session", "-d", "-s", name, cmd]);
  }

  /** Gõ phím như người dùng — hỗ trợ C-c, Enter, chuỗi. */
  async send(name: string, keys: string): Promise<void> {
    await run("tmux", [...this.base(), "send-keys", "-t", name, "-l", keys, "Enter"]);
  }

  /** Scrape 200 dòng output gần nhất. */
  async scrape(name: string, lines = 200): Promise<string> {
    const { stdout } = await run("tmux", [...this.base(), "capture-pane", "-p", "-t", name, "-S", String(-lines)]);
    return stdout;
  }

  /** Poll scrape đến khi match pattern hoặc hết timeout (ms). */
  async waitFor(name: string, pattern: RegExp, timeoutMs = 30_000, stepMs = 1_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      last = await this.scrape(name);
      if (pattern.test(last)) return last;   // server ready / prompt xuất hiện
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return null; // timeout — agent đọc `last` để chẩn đoán
  }
}

// Usage:
// const tmux = new TmuxControl("claude.sock"); // socket riêng, không đụng user
// await tmux.create("dev", "npm run dev");
// const out = await tmux.waitFor("dev", /listening on port 3000/);
// await tmux.send("dev", "curl localhost:3000/api");
// const body = await tmux.scrape("dev", 200); // → snapshot về context
```

## Được

- ✅ Điều khiển CLI sống như người — tương tác prompt, không chỉ spawn
- ✅ Socket isolation — session riêng, không phá terminal người dùng
- ✅ Output theo thời gian thực — scrape 200 dòng thấy trạng thái mới nhất
- ✅ WaitFor định hướng — đợi "listening" thay vì sleep cố định
- ✅ Snapshot về context — output scrape thành context/telemetry được

## Mất

- ❌ Phụ thuộc tmux — host không có tmux (Windows, container nhẹ) là hỏng
- ❌ Output hạn chế — pane chỉ giữ buffer giới hạn, output cũ bị trôi
- ❌ Race — send rồi scrape ngay có thể chưa kịp render (cần waitFor)

## Khác các hướng gần

| | Spawn + stdout (codeexec) | screen.ts (desktop) | YE: Tmux Control |
|---|---|---|---|
| Tương tác | một phát | không | **send-keys liên tục** |
| Output | stdout kết thúc | ảnh chụp | **scrape -S -200 sống** |
| Isolation | process riêng | màn hình chung | **socket riêng** |

## Khi nào chọn

- Agent cần chạy dev server / REPL / interactive CLI lâu dài và phản hồi
- Muốn thao tác terminal sống như người (nhấn phím, đợi prompt)
- Có codeexec + output-compress sẵn — YE thêm tmux client + waitFor
- Nối packages/tools codeexec.ts (fallback không tmux) + output-compress.ts (scrape dài) + core/telemetry.ts (snapshot output); guard tmux-absent (check `command -v tmux` trước — fallback spawn), scrape-volume (200 dòng/poll giới hạn — không tràn context), và socket-collision (hai app cùng socket → panic kiểm tra tồn tại); YE = tmux control, kết hợp 653 YC repo-cache (lớp ngoài tiện ích) + 654 YD command-shim (cùng steer hành vi ở tầng shell)
