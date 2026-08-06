# Hướng QS: Collab Session Relay — relay session live link+QR, co-view, client-side frame

> **Nguồn gốc:** oh-my-pi (pi-coding-agent); "collab session relay"; "live session link + QR code"; "co-view shared session"; "client-side rendering frame"; "relay = read-only mirror for observer"
> **Coupling:** 🟡 — thêm relay/transport layer (session mirror → remote client) song song intercom
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/collab relay + intercom sẵn — chưa có QR invite + co-view frame)
> **Effort:** 3-4 tuần

## Nguồn gốc

**oh-my-pi** mô tả **collab session relay**: agent session chạy ở host, **relay** stream state (output, file-view, cursor) tới **remote client** qua **live link** (URL) hoặc **QR code** (điện thoại quét vào). **Co-view**: observer (đồng nghiệp/reviewer) xem **cùng session theo thời gian thực** — thấy agent đang sửa file gì, output gì. **Client-side frame**: client render state riêng (không chạy agent — read-only mirror), nên nhẹ, chạy trên điện thoại. Nguyên tắc: **tách execution (host) khỏi observation (client)** — relay = cầu nối stream. Khác **383 omnichannel-gateway** (multi-channel input) — QS là **output mirror**; khác **084 judge** (review sau) — QS là **live co-view**.

## Mô tả

mya collab session relay: (1) **Host session**: agent chạy bình thường (chỉnh code, chạy tool). (2) **Relay**: stream session state (terminal output, file diff, cursor, status) tới relay endpoint. (3) **Invite**: sinh **live link** (URL có token) hoặc **QR code** (mã hóa URL) cho observer. (4) **Co-view**: client (browser/điện thoại) kết nối link → render state (client-side frame, read-only, không chạy agent). (5) **Sync**: state update real-time (WebSocket / SSE), observer thấy đúng gì host thấy. mya có `packages/collab/relay.ts` + `intercom` — QS thêm **QR invite generator** + **client-side render frame** + **session-state serializer** (state → compact delta stream).

## Kiến trúc

```
  HOST (agent session running):
  ┌─────────────────────────────────────────────────────┐
  │  agent: editing parser.rs, running tests, output...  │
  │  session-state: { file, cursor, diff, terminal }      │
  └───────────────────────┬─────────────────────────────┘
                          │ (serialize → delta stream)
                          ▼
  ┌─── RELAY ENDPOINT ──────────────────────────────────┐
  │  WebSocket / SSE: stream deltas to subscribers       │
  │  invite: sinh live-link (URL+token) / QR code        │
  └───────────┬───────────────────────────┬─────────────┘
              │ link                      │ QR
              ▼                           ▼
  ┌─── CLIENT A (browser) ────┐  ┌─── CLIENT B (phone, QR) ─┐
  │  co-view: render state     │  │  co-view: render state    │
  │  - file diff (read-only)   │  │  - terminal output        │
  │  - terminal output         │  │  - status bar             │
  │  - cursor position         │  │  (lightweight frame)      │
  │  (client-side, no agent)   │  │  (read-only mirror)       │
  └────────────────────────────┘  └───────────────────────────┘
          ▲                               ▲
          └────── real-time sync ─────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/collab/relay.ts — relay transport (nền — QS = session mirror)
// ✅ packages/intercom — channel transport (nền — QS co-view)
// ✅ packages/web — web render (nền — QS client frame)
// ✅ 292 lifecycle-hooks — event source (nền — QS stream deltas)

// ❌ THIẾU: QR invite generator (URL → QR image)
// ❌ THIẾU: session-state serializer (file/diff/cursor/terminal → compact delta)
// ❌ THIẾU: client-side render frame (browser/phone, read-only, real-time)
// ❌ THIẾU: token-auth invite (link có token, hết hạn)
```

## Implementation

```typescript
// packages/collab/src/session-relay.ts (MỚI)
interface SessionState {
  sessionId: string;
  activeFile?: string;
  diff?: string;
  cursor?: { line: number; col: number };
  terminalOutput?: string;
  status: 'idle' | 'working' | 'done' | 'error';
}

class SessionRelay {
  private subscribers = new Set<(delta: Partial<SessionState>) => void>();

  constructor(private emit: (event: string, payload: unknown) => void) {}

  // stream state delta (via 292 hooks → emit)
  broadcast(state: SessionState): void {
    const delta: Partial<SessionState> = state; // compact: chỉ field thay đổi
    this.emit('session:delta', delta);
    for (const sub of this.subscribers) sub(delta);
  }

  // sinh invite link + QR
  invite(baseUrl: string): { link: string; qrPayload: string; token: string } {
    const token = cryptoRandom();
    const link = `${baseUrl}/collab/${this.sessionId}?t=${token}`;
    return { link, qrPayload: link, token }; // qrPayload → render QR image client-side
  }

  subscribe(cb: (delta: Partial<SessionState>) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
}

// Client-side (browser frame, read-only):
// const ws = new WebSocket(relayUrl);
// ws.onmessage = (e) => renderFrame(JSON.parse(e.data));
// function renderFrame(delta) { updateFileView(delta.diff); updateTerminal(delta.terminalOutput); }

// Usage (host):
// relay.broadcast({ activeFile: 'parser.rs', diff: newDiff, status: 'working' });
// const invite = relay.invite('https://mya.dev');  // → QR cho phone
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Co-view real-time (reviewer thấy agent làm gì ngay) | ❌ Latency stream (delta trễ → observer thấy cũ) |
| ✅ Nhẹ client (render-only, không chạy agent) | ❌ Token-leak (link lộ → stranger xem session) |
| ✅ QR cho điện thoại (không cần laptop) | ❌ Read-only (observer không tương tác — cần thêm) |
| ✅ Nối collab/relay + intercom (tận dụng transport) | ❌ Diff lớn → delta nặng (bandwidth) |

## Khác các hướng gần

| | 383 Omnichannel-Gateway | 084 LLM-as-Judge | QS: Collab-Relay |
|---|---|---|---|
| Cái gì | Multi-channel input | Review sau task | **Live output mirror** |
| Hướng | Input → agent | Agent → judge | **Host → client (co-view)** |
| Real-time | ✅ (input) | ❌ (post) | **✅ (stream deltas)** |

## Khi nào chọn

- Muốn reviewer/đồng nghiệp xem agent live (co-view, không đứng sau vai)
- Cần mobile access (QR → điện thoại)
- Session chỉ-đọc mirror (client nhẹ, không chạy agent)
- Nối packages/collab/relay (transport) + intercom (channel) + 292 lifecycle-hooks (event source); guard token-auth (link hết hạn) + delta compression (diff lớn); mở rộng read-only → interactive (observer comment) nếu cần
