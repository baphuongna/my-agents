# Hướng AFH: PTY Overlay User Takeover — interactive CLI chạy trong PTY overlay, user xem real-time và gõ phím bất kỳ để giành quyền

> **Nguồn gốc:** pi-interactive-shell | **Coupling:** 🟡 — PTY + input arbitration | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn codeexec spawn; thiếu PTY overlay + takeover) | **Effort:** 2 tuần

## Nguồn gốc

**pi-interactive-shell** (tool-schema.ts): **interactive_shell** chạy CLI tương tác (vim, psql, agent CLI khác) trong **PTY overlay**; **agent chờ**, **user xem real-time** và **gõ phím bất kỳ để giành quyền điều khiển** (takeover). Nghĩa là: một tool chạy CLI cần tương tác (editor, database shell, wizard) mà không phá terminal của agent — CLI chạy trong lớp PTY riêng, output hiện real-time, agent đứng chờ; user thấy cần can thiệp → gõ phím → quyền điều khiển chuyển sang user (agent đứng yên chờ user xong).

Giá trị: (1) **CLI tương tác chạy được trong agent flow** — vim/psql thường không chạy trong pipe/stdio đơn giản — PTY là bắt buộc (terminal app cần tty); (2) **user control** — agent không tự gõ bừa vào vim — user giành quyền khi cần, agent chỉ chờ; (3) **minh bạch** — user thấy real-time CLI đang làm gì (không hộp đen); (4) **an toàn** — quyền điều khiển tường minh (agent chờ mặc định, user takeover khi gõ phím).

## Mô tả

Với mya, pattern = **PTY tool + input arbitration**: (1) **spawn PTY** — mya có `packages/tools/codeexec.ts` spawn child (stdio pipe) — pattern thêm **PTY alloc** (node-pty hoặc native) cho CLI cần tty; (2) **overlay render** — output CLI hiện real-time qua print transport (nối agents-panel/focus-recap render pattern — lớp escape đã có AEX/AEY); (3) **agent chờ** — tool chạy interactive CLI, agent không gõ — chờ user hoặc CLI thoát; (4) **user takeover** — user gõ phím bất kỳ → input path chuyển từ "agent-driven" sang "user-driven" (arbiter state); user xong (thoát CLI) → quyền trả agent; (5) **timeout/abort** — CLI treo → watchdog (nối AEZ tinh thần) + abort (AEP) — không kẹt mãi; (6) **phân biệt input** — phím user vs output CLI qua PTY master/slave (nối AEY raw-paste — paste bracket vẫn hoạt động trong overlay). Đây là pattern **shared-terminal arbitration**: một tty, hai người điều khiển (agent/user) — quyền rõ ràng, chuyển tường minh.

## Kiến trúc (ASCII)

```
  AGENT GỌI interactive_shell (tool)
    │
    ▼ SPAWN PTY (node-pty/native — CLI cần tty: vim, psql, wizard)
  PTY master ──► CLI (vim/psql) chạy trong overlay
    │             output hiện REAL-TIME (print transport)
    │
    ▼ TRẠNG THÁI: AGENT CHỜ (mặc định — không tự gõ bừa)
    │
    ▼ USER GÕ PHÍM BẤT KỲ ──► TAKEOVER (input arbiter)
  ├─ input path: user-driven (agent đứng yên)
  ├─ user xem + điều khiển trực tiếp CLI
  └─ CLI thoát → quyền trả agent (kết quả trả về)
    │
    ▼ TIMEOUT/ABORT (watchdog AEZ + AEP) — CLI treo không kẹt mãi
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/codeexec.ts — spawn child (stdio pipe — nền; PTY là mở rộng)
// ✅ packages/print/src/agents-panel.ts + focus-recap.ts — render overlay pattern
//   (lớp escape AEX/AEY — nền vẽ overlay)
// ✅ packages/print/src/raw-paste.ts (AEY) — paste bracket (vẫn chạy trong overlay)
// ✅ packages/print/src/tab-status.ts (AEZ) — watchdog tinh thần
// ✅ packages/workflows/src/runner.ts — abort/timeout (AEP)
// ✅ packages/intercom/src/ui — widget/input surface (nơi gom phím user)

// ❌ THIẾU: PTY alloc (node-pty/native) + overlay render
// ❌ THIẾU: input arbiter (agent-chờ → user-takeover → trả quyền)
// ❌ THIẾU: watchdog/abort cho CLI treo trong overlay
```

## Implementation

```typescript
// packages/tools/src/pty-overlay.ts (NEW)
export type ControlState = "agent-waiting" | "user-controlled";

export class PtyOverlay {
  state: ControlState = "agent-waiting";

  constructor(
    private pty: { write(data: string): void; onData(cb: (d: string) => void): void; kill(): void },
    private onUserTakeover: () => void,
    private onExit: (code: number | null) => void,
  ) {}

  /** User gõ phím bất kỳ → giành quyền điều khiển (agent đứng yên chờ). */
  onUserInput(key: string): void {
    if (this.state === "agent-waiting") {
      this.state = "user-controlled";
      this.onUserTakeover();
    }
    this.pty.write(key);              // phím user → PTY (CLI nhận trực tiếp)
  }

  /** Agent không tự gõ khi CLI interactive — chỉ gõ khi được phép. */
  agentWrite(data: string): void {
    if (this.state === "user-controlled") return;   // user đang giữ — agent im lặng
    this.pty.write(data);
  }

  start(): void {
    this.pty.onData((d) => process.stdout.write(d));   // real-time overlay render
    this.pty.onData((d) => {
      // CLI thoát (EOF) → trả quyền về agent
      if (d.includes("\x04")) { this.state = "agent-waiting"; }
    });
  }
}
// Watchdog: CLI im lặng quá lâu → abort (AEP) — không kẹt mãi
// Nối AEY: paste bracket trong overlay vẫn parse — user paste nhiều dòng OK
// Render: output CLI qua print transport — không phá terminal agent
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ CLI tương tác chạy trong agent flow (vim/psql/wizard) | ❌ PTY phụ thuộc native (node-pty) — build/platform phức tạp |
| ✅ User giành quyền tường minh — agent không gõ bừa | ❌ Arbiter state dễ sai khi nhiều input path (agent+user đồng thời) |
| ✅ User thấy real-time — không hộp đen | ❌ Overlay render + terminal agent xung đột (cần vùng riêng) |
| ✅ Đã có spawn + render + escape layers | ❌ CLI thoát không báo EOF (full-screen app) — cần watchdog |

## Khác các hướng gần

| | AFH PTY Overlay | AFI Hands-Free Polling | AEY Raw Paste |
|---|---|---|---|
| Trọng tâm | CLI tương tác + user takeover | Chạy dài không chặn turn | Nhận paste text thuần |
| Cơ chế | PTY + input arbiter | sessionId + poll/drain | Paste bracket + normalize |
| Quan hệ | Interactive path (AFI ngược) | Non-interactive path | Input path chung |

## Khi nào chọn

- Agent cần chạy CLI tương tác (vim, psql, database shell, wizard)
- User muốn can thiệp trực tiếp CLI khi cần (takeover rõ ràng)
- Đã có codeexec spawn + print render + escape layers — thêm PTY
- Terminal app không chạy trong pipe đơn giản — PTY là bắt buộc