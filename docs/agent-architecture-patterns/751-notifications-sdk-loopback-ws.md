# Hướng ABW: Notifications SDK Loopback WS — mỗi session một loopback WebSocket riêng (action_needed/reply), client Telegram/Discord/mobile là client thuần

> **Nguồn gốc:** gajae-code (docs/notifications-sdk.md) | **Coupling:** 🟡 — thêm loopback WS + discovery file vào notification layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có channels + push — chưa có loopback WS SDK) | **Effort:** 2 tuần

## Nguồn gốc

**gajae-code** notifications SDK: **mỗi session chạy một loopback WebSocket riêng** với protocol `action_needed` / `reply` + **discovery file** (`sessionId.json`) — client (Telegram/Discord/mobile) tìm session qua discovery file rồi kết nối WS loopback. Điểm mấu chốt: **client là client thuần** — Telegram/Discord/mobile **không cần thay đổi upstream wire protocol** (chúng chỉ nói protocol loopback riêng của SDK; SDK lo phần adapter với platform). Kết quả: notification/reply đi qua WS loopback giữa session và client SDK — tách bạch, không đụng upstream. Nguyên tắc: **per-session loopback WS, discovery file để client tìm session, client thuần (upstream protocol không đổi)**.

## Mô tả

mya notifications SDK loopback WS: mỗi session mở **loopback WebSocket** (localhost) với protocol `action_needed` (session cần user hành động) / `reply` (user trả lời) + ghi **discovery file** `sessionId.json` (port, session meta); client (Telegram/Discord/mobile qua adapter) đọc discovery file → kết nối WS → nhận action_needed / gửi reply. mya có packages/gateway channels.ts (channel adapters Telegram/Discord) + push.ts (Web Push) + packages/intercom broker (WS broker) — ABW thêm **per-session loopback WS** + **discovery file** + **action_needed/reply protocol**.

## Kiến trúc

```
  SESSION (mya agent)
  │  mở loopback WS (127.0.0.1:<port>) — protocol action_needed/reply
  │  ghi discovery file sessionId.json { port, sessionId, ts }
  ▼
  DISCOVERY FILE (sessionId.json)
  ┌────────────────────────────────────┐
  │  { "sessionId": "s1", "port": 8123 }│
  └──────────────────┬─────────────────┘
                     │ client đọc file → kết nối
                     ▼
  CLIENTS (thuần — không đổi upstream wire protocol)
  ├─ Telegram  ──► adapter ──┐
  ├─ Discord   ──► adapter ──┤  loopback WS
  └─ Mobile    ──► adapter ──┘
     action_needed: "cần bạn duyệt: tool X"
     reply:         "duyệt" (user → session)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway channels.ts — channel adapters (Telegram/Discord/...) (nền — ABW client side)
// ✅ packages/gateway push.ts — Web Push (nền — ABW notification delivery)
// ✅ packages/intercom broker — WS broker (nền — ABW WS infra)

// ❌ THIẾU: per-session loopback WS (mỗi session 1 WS riêng)
// ❌ THIẾU: discovery file (sessionId.json — client tìm session)
// ❌ THIẾU: action_needed/reply protocol (SDK chuẩn)
```

## Implementation

```typescript
// packages/gateway/src/notifications-sdk.ts (MỚI)
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type NotifMessage =
  | { type: "action_needed"; actionId: string; text: string; sessionId: string }
  | { type: "reply"; actionId: string; text: string };

/** Per-session loopback WS: mỗi session 1 server riêng + discovery file. */
export class SessionNotifier {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private port = 0;

  /** Mở loopback WS + ghi discovery file (sessionId.json). */
  async start(sessionId: string, discoveryDir = join(homedir(), ".mya", "notify")): Promise<number> {
    const server = createServer();
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", ws => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    this.port = (server.address() as { port: number }).port;

    // discovery file: client đọc để biết port + session
    mkdirSync(discoveryDir, { recursive: true });
    writeFileSync(join(discoveryDir, `${sessionId}.json`),
      JSON.stringify({ sessionId, port: this.port, protocol: "action_needed/reply", ts: Date.now() }));
    return this.port;
  }

  /** Gửi action_needed tới mọi client đang kết nối (session cần hành động). */
  notifyAction(actionId: string, text: string, sessionId: string): void {
    const msg: NotifMessage = { type: "action_needed", actionId, text, sessionId };
    for (const ws of this.clients) ws.send(JSON.stringify(msg));
  }

  /** Nhận reply từ client (user hành động). */
  onReply(cb: (reply: NotifMessage & { type: "reply" }) => void): void {
    this.wss?.on("connection", ws => {
      ws.on("message", raw => {
        const msg = JSON.parse(raw.toString()) as NotifMessage;
        if (msg.type === "reply") cb(msg);
      });
    });
  }
}
// Usage:
// const notifier = new SessionNotifier();
// await notifier.start("sess-1");             // loopback WS + discovery file
// notifier.notifyAction("a1", "cần duyệt tool X", "sess-1"); // Telegram/Discord/mobile nhận
// notifier.onReply(r => runApproval(r.actionId, r.text));    // reply → session
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Upstream không đổi (client thuần — không sửa Telegram/Discord protocol) | ❌ Discovery file management (file stale khi session chết) |
| ✅ Per-session tách biệt (mỗi session WS riêng — không cross-talk) | ❌ Loopback only (client phải cùng máy — remote cần tunnel) |
| ✅ Protocol rõ (action_needed/reply — SDK chuẩn) | ❌ WS lifecycle (reconnect, heartbeat — client phải xử lý) |
| ✅ Port động (ephemeral — không conflict) | ❌ Security (loopback WS không auth — process local khác gọi được) |

## Khác các hướng gần

| | Push notification 1 chiều | Channel adapter trực tiếp | ABW: Loopback WS SDK |
|---|---|---|---|
| Chiều | 1 (notify) | 2 (qua adapter) | **2 (action_needed/reply)** |
| Upstream protocol | không đổi | adapter đổi | **client thuần, SDK lo** |
| Per-session | không | chung | **mỗi session 1 WS + discovery file** |
| Discovery | — | — | **sessionId.json** |

## Khi nào chọn

- Muốn notification 2 chiều (action_needed → reply) mà không đổi upstream platform protocol
- Nhiều session — mỗi session cần notification riêng (không lẫn)
- Client đa dạng (Telegram/Discord/mobile) dùng chung SDK
- Nối packages/gateway channels.ts + push.ts + packages/intercom broker; guard discovery-freshness (xóa discovery file khi session đóng — không stale), ws-heartbeat (client mất kết nối → reconnect), và loopback-auth (WS chỉ loopback + token nếu cần — không để local process khác giả client); ABW = notifications SDK loopback WS, kết hợp 751-family gajae-code notifications với packages/gateway channels + intercom broker
