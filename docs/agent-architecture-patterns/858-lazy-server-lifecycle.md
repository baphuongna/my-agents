# Hướng AFZ: Lazy Server Lifecycle — server MCP lazy mặc định: chỉ connect ở tool call đầu tiên, idle disconnect sau 10 phút; lifecycle keep-alive có health check + auto-reconnect, lazy-keep-alive giữ resident sau lần dùng đầu

> **Nguồn gốc:** pi-mcp-adapter (README.md) | **Coupling:** 🟡 — wrap MCP server connection | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có intercom ensureConnected/retry, thiếu MCP lazy lifecycle) | **Effort:** 1 tuần

## Nguồn gốc

**pi-mcp-adapter** mặc định **lazy connect**: MCP server chỉ **connect ở tool call đầu tiên** (không connect lúc startup — tiết kiệm tài nguyên). **Idle disconnect sau 10 phút** (không dùng → đóng). Có 3 chế độ lifecycle: **keep-alive** (health check + auto-reconnect), **lazy** (mặc định, connect-on-call), **lazy-keep-alive** (resident sau lần dùng đầu — connect rồi giữ). Nguyên tắc: **connect khi cần, đóng khi rảnh, reconnect khi lỗi**.

## Mô tả

mya lazy-server-lifecycle: (1) **ensureConnected pattern đã sẵn** — `packages/intercom` intercom.ts có `ensureConnected(reason)` với retry reconnect (startup/background/tool/overlay); (2) **lazy connect** — connect-on-first-call thay vì startup; (3) **idle disconnect** — timer 10 phút đóng khi rảnh; (4) **keep-alive** — health check (ping) + auto-reconnect; (5) **lazy-keep-alive** — resident sau lần đầu. Nối AGD (session-recovery reauth) và AGC (mcp-script-worker).

## Kiến trúc (ASCII)

```
  MCP SERVER LIFECYCLE (3 chế độ)
   │
   ├─ LAZY (mặc định):
   │    startup ──▶ KHÔNG connect
   │    tool call đầu ──▶ connect (on-demand)
   │    idle 10 phút ──▶ DISCONNECT
   │
   ├─ KEEP-ALIVE:
   │    connect + health check (ping) định kỳ
   │    lỗi ──▶ auto-reconnect
   │
   └─ LAZY-KEEP-ALIVE:
        tool call đầu ──▶ connect rồi GIỮ (resident)
        (lai giữa lazy + keep-alive)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom intercom.ts — ensureConnected(reason) + retry reconnect
// ✅ packages/intercom intercom.ts — ensureConnected("background") queued retry
// ✅ packages/core lifecycle patterns (session/memory)

// ❌ THIẾU: MCP lazy connect-on-first-call
// ❌ THIẾU: idle disconnect 10 phút
// ❌ THIẾU: keep-alive health check + auto-reconnect
```

## Implementation

```typescript
// packages/tools/src/mcp-lifecycle.ts (MỚI)
const IDLE_DISCONNECT_MS = 10 * 60_000;
export type LifecycleMode = "lazy" | "keep-alive" | "lazy-keep-alive";
export interface ServerConn {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  readonly connected: boolean;
}
/** MCP server lifecycle: lazy / keep-alive / lazy-keep-alive. */
export class McpLifecycle {
  private lastUsed = 0;
  private connected = false;
  private idleTimer?: ReturnType<typeof setInterval>;
  constructor(private conn: ServerConn, private mode: LifecycleMode) {}
  /** Đảm bảo connected — lazy: connect-on-call; keep-alive: luôn. */
  async ensureConnected(): Promise<void> {
    this.lastUsed = Date.now();
    if (this.connected) return;
    await this.conn.connect();
    this.connected = true;
    if (this.mode !== "keep-alive") this.scheduleIdle();
    if (this.mode === "keep-alive" || this.mode === "lazy-keep-alive") this.startHealth();
  }
  private scheduleIdle(): void {
    clearInterval(this.idleTimer);
    this.idleTimer = setInterval(async () => {
      if (this.mode === "lazy" && Date.now() - this.lastUsed > IDLE_DISCONNECT_MS) {
        await this.conn.disconnect();   // idle 10 phút → đóng
        this.connected = false;
      }
    }, 60_000);
  }
  private startHealth(): void {
    setInterval(async () => {
      if (this.connected && !(await this.conn.ping())) await this.conn.connect();  // auto-reconnect
    }, 30_000);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lazy tiết kiệm tài nguyên (không connect mù) | ❌ Cold-start latency ở call đầu |
| ✅ Idle disconnect giải phóng connection | ❌ Health check overhead (keep-alive) |
| ✅ Auto-recover khi server lỗi | ❌ Reconnect storm nếu server down liên tục |

## Khác các hướng gần

| | AFZ Lazy Server Lifecycle | AGD Session-Recovery | AGC Script-Worker |
|---|---|---|---|
| Trọng tâm | Connection lifecycle | Re-auth + retry | Worker thread terminate |
| Idle | disconnect 10 phút | n/a | 30s timeout |
| Recover | auto-reconnect | re-auth + retry | kill worker |

## Khi nào chọn

- MCP server nhiều, không dùng hết lúc startup
- Muốn tiết kiệm connection (idle disconnect)
- Cần tự phục hồi khi server lỗi
- Guard: idle threshold tuning, health check nhẹ, reconnect backoff
