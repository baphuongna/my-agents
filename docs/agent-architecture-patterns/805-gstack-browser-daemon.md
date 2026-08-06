# Hướng ADY: Gstack Browser Daemon — Chromium daemon persistent thay vì cold-start mỗi command

> **Nguồn gốc:** gstack | **Coupling:** 🟡 — daemon ngoài, cần socket + lifecycle quản lý | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn browser runner + session; thiếu daemon persistent) | **Effort:** 2 tuần

## Nguồn gốc

**gstack** chạy **Chromium daemon persistent**: một process browser sống lâu trên **localhost HTTP** (Bun.serve + CDP) thay vì **cold-start browser mỗi command**. Số liệu trong ARCHITECTURE.md: **first call ~3s**, **mỗi call sau ~100-200ms** — cold-start tốn ~3s còn warm call chỉ vài trăm ms. **Cookies/tabs/login sessions giữ nguyên qua commands** — không phải login lại mỗi lần. **30min idle timeout** — daemon tự chết khi không dùng, không treo vô hạn.

Đây là pattern **resource lifecycle**: tài nguyên đắt (browser) được giữ nóng giữa các lần dùng, có idle timeout để không phí tài nguyên, state (cookies/session) được bảo toàn.

## Mô tả

Với mya, `packages/tools/src/web/browser` đã có: `agent-browser-runner.ts` (build args, --session/--cdp), `session.ts` (BrowserSession + `AGENT_BROWSER_IDLE_TIMEOUT_MS` idle-kill daemon + Chrome children). Pattern daemon persistent thêm: (1) **daemon process sống giữa các tool call** — không spawn lại mỗi call; (2) **HTTP + CDP endpoint** — tool gọi HTTP local thay vì spawn; (3) **session reuse** — cookies/tabs giữ nguyên; (4) **idle timeout chuẩn** — đã có nền (300s default trong session.ts). Gap chính: hiện session theo tool call, chưa có daemon HTTP server persistent + warm reuse path.

## Kiến trúc (ASCII)

```
  TOOL CALL (browser)
    │
    ▼ DAEMON RESOLVER
    ├─ daemon đang chạy? ──► gọi HTTP localhost (100-200ms, warm)
    └─ daemon chết?     ──► spawn Chromium daemon (~3s, cold)
            │
            ▼
  CHROMIUM DAEMON (Bun.serve + CDP)
    ├─ cookies/tabs/login GIỮ NGUYÊN qua commands
    ├─ HTTP endpoint (localhost)
    └─ idle timer 30min → tự kill (không treo vô hạn)
            │
            ▼
  TRẢ KẾT QUẢ về tool call
  ⚠️ daemon nhận fds — đừng pipe stdout (deadlock — Gotcha trong runner)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools/src/web/browser/agent-browser-runner.ts — build args, --session/--cdp
// ✅ packages/tools/src/web/browser/session.ts — BrowserSession + idle-kill
//   (AGENT_BROWSER_IDLE_TIMEOUT_MS, DEFAULT 300s — nền 30min timeout)
// ✅ packages/tools/src/web/browser/engine-resolver.ts — chrome/lightpanda
// ✅ packages/rpc — tcp-server (nền HTTP endpoint localhost)
// ✅ packages/core — LaneHeartbeat (nền daemon heartbeat)

// ❌ THIẾU: daemon HTTP server persistent (Bun.serve + CDP)
// ❌ THIẾU: warm reuse path (first ~3s, sau ~100-200ms)
// ❌ THIẾU: session persistence across tool calls (cookies/tabs giữ nguyên)
```

## Implementation

```typescript
// packages/tools/src/web/browser/daemon.ts (NEW)
export interface BrowserDaemonOpts {
  host: string;              // localhost
  idleTimeoutMs: number;     // 30 min
  binary: string;            // chromium path
}

export class BrowserDaemon {
  private server?: http.Server;
  private lastUse = 0;
  private idle?: NodeJS.Timeout;

  constructor(private opts: BrowserDaemonOpts) {}

  async ensureWarm(): Promise<string> {
    // daemon sống? → warm call (100-200ms)
    if (this.server?.listening && Date.now() - this.lastUse < this.opts.idleTimeoutMs) {
      this.ping();
      return `http://${this.opts.host}:${this.port}`;
    }
    // cold start (~3s) — spawn Chromium với CDP
    this.server = await this.startDaemon(this.opts.binary);
    this.ping();
    return this.endpoint();
  }

  private ping(): void {
    this.lastUse = Date.now();
    clearTimeout(this.idle);
    // idle timeout — daemon tự kill, không treo vô hạn
    this.idle = setTimeout(() => this.kill(), this.opts.idleTimeoutMs);
    this.idle.unref();
  }

  async call(page: PageAction): Promise<BrowserResult> {
    const ep = await this.ensureWarm();         // warm: ~100-200ms
    const resp = await fetch(`${ep}/cdp`, {     // cookies/tabs giữ nguyên
      method: "POST", body: JSON.stringify(page),
    });
    return resp.json() as BrowserResult;
  }

  kill(): void { this.server?.close(); /* kill Chromium children */ }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cold ~3s → warm ~100-200ms mỗi call | ❌ Daemon là process ngoài — cần lifecycle quản lý |
| ✅ Cookies/tabs/login giữ nguyên | ❌ Memory browser chiếm dù idle |
| ✅ Idle timeout — không treo vô hạn | ❌ Daemon crash → session mất |
| ✅ Nhiều tool call chia sẻ một browser | ❌ Port/socket conflict nếu nhiều daemon |

## Khác các hướng gần

| | ADY Browser Daemon | ADP Wrap Proxy | ADG tmux Team |
|---|---|---|---|
| Tài nguyên | Browser (Chromium) | LLM proxy | Worker CLI |
| Giữ nóng | Cookies/tabs | Settings/cache | Pane session |
| Timeout | 30min idle | — | Parent crash-survive |

## Khi nào chọn

- Browser tool gọi nhiều lần trong session — cold-start tốn
- Cần cookies/login session giữ qua commands
- Đã có browser runner + session idle-kill — thêm daemon server
- Chấp nhận process ngoài + lifecycle quản lý