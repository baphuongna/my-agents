# Hướng AGD: Session-Recovery Reauth — `withSessionRecovery` bọc mọi call: khi connection rơi vào `needs-auth` giữa chừng, tự động re-auth + reconnect rồi retry call **một lần** thay vì fail cứng; kết hợp `combineAbortSignals` để hủy sạch

> **Nguồn gốc:** pi-mcp-adapter (session-recovery.ts) | **Coupling:** 🟡 — wrap MCP call boundary | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có intercom retry + abort-signal threading, thiếu needs-auth reauth retry) | **Effort:** 1 tuần

## Nguồn gốc

**pi-mcp-adapter** `withSessionRecovery` bọc **mọi MCP call**: khi connection rơi vào trạng thái `needs-auth` giữa chừng (token hết hạn, session mất), **tự động re-auth + reconnect rồi retry call MỘT LẦN** thay vì fail cứng. Kết hợp **`combineAbortSignals`** — gộp nhiều AbortSignal (timeout + user-cancel + parent) để hủy sạch, không rò rỉ. Nguyên tắc: **fail-soft cho needs-auth (retry 1 lần), abort sạch qua signal combine**.

## Mô tả

mya session-recovery-reauth: (1) **retry pattern đã sẵn** — `packages/intercom` ensureConnected có retry reconnect; (2) **abort-signal threading đã sẵn** — AIR (combineAbortSignals pattern); (3) **needs-auth detect** — connection state machine (connected/needs-auth/disconnected); (4) **reauth + retry once** — bắt needs-auth → re-auth → reconnect → retry call 1 lần (không loop vô hạn); (5) **combineAbortSignals** — gộp signal để hủy sạch. Nối AFZ (lazy lifecycle).

## Kiến trúc (ASCII)

```
  withSessionRecovery(call)
       │
       ▼  gọi MCP call
  connection state?
   ├─ connected ──▶ gọi thành công → return
   ├─ needs-auth ──▶ RECOVER:
   │     ├─ re-auth (refresh token)
   │     ├─ reconnect
   │     └─ RETRY call 1 LẦN (không loop)
   │           ├─ ok ──▶ return
   │           └─ fail again ──▶ throw (không retry nữa)
   └─ disconnected ──▶ throw

  combineAbortSignals(timeout, userCancel, parent)
       └─ gộp → hủy sạch mọi pending call khi 1 signal abort
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom intercom.ts — ensureConnected retry reconnect (background)
// ✅ packages/agent index.ts — AbortSignal combine (AIR abort-threading, onAbortSafe)
// ✅ packages/intercom intercom.ts — combineAbortSignals seam (abort clean)

// ❌ THIẾU: needs-auth state detect trong call boundary
// ❌ THIẾU: reauth + reconnect + retry-once wrapper
```

## Implementation

```typescript
// packages/tools/src/session-recovery.ts (MỚI)
export type ConnState = "connected" | "needs-auth" | "disconnected";
export interface RecoverableConn {
  state(): ConnState;
  reauth(): Promise<void>;
  reconnect(): Promise<void>;
}
/** combineAbortSignals — gộp nhiều signal thành một (hủy sạch). */
export function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(); break; }
    s.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}
/** Bọc call: needs-auth → reauth+reconnect+retry 1 lần. */
export async function withSessionRecovery<T>(
  conn: RecoverableConn,
  call: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const combined = combineAbortSignals(signal);
  try {
    return await call(combined);
  } catch (e) {
    if (conn.state() !== "needs-auth") throw e;   // chỉ recover needs-auth
    await conn.reauth();
    await conn.reconnect();
    return call(combineAbortSignals(signal));      // retry MỘT LẦN (không loop)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fail-soft needs-auth — không mất call giữa chừng | ❌ Retry 1 lần thêm latency khi token hết hạn |
| ✅ Abort sạch qua signal combine | ❌ Reauth có thể fail (token refresh lỗi) |
| ✅ Không loop vô hạn (retry once) | ❌ Cần state machine chính xác (needs-auth detect) |

## Khác các hướng gần

| | AGD Session-Recovery | AFZ Lazy Lifecycle | audit recovery |
|---|---|---|---|
| Trigger | needs-auth mid-call | idle / on-call | RuntimeEvent error |
| Recover | reauth+reconnect+retry | connect/disconnect | strategy match |
| Abort | combineAbortSignals | n/a | n/a |

## Khi nào chọn

- MCP call có nguy cơ needs-auth giữa chừng (token expire)
- Muốn fail-soft (retry 1 lần) thay vì fail cứng
- Cần hủy sạch nhiều pending call (combine signals)
- Guard: chỉ retry once (không loop), needs-auth detect chính xác, abort propagate
