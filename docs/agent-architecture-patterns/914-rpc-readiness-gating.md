# Hướng AID: RPC-Readiness-Gating — RPC handlers và broadcast `subagents:ready` chuyển từ factory-time sang first bound `session_start`; đóng race nơi consumer factory chạy sau có thể miss event; activation bị agent filter loại bỏ hoàn toàn im lặng trên RPC channels

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — RPC lifecycle | **Agent-agnostic:** ⚠️ (extension lifecycle) | **Code sẵn:** ⚠️ (có JSON-RPC transport; chưa có readiness gating + ready broadcast) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagent3** RPC handlers và broadcast **`subagents:ready`** chuyển từ **factory-time** sang **first bound `session_start`**; đóng race nơi consumer factory chạy sau có thể **miss event**; activation bị **agent filter** loại bỏ hoàn toàn **im lặng trên RPC channels**. Nguyên tắc: **defer registration to bound session** — không đăng ký ở factory (race); **ready broadcast** — thông báo service ready sau khi handler bound; **filter silence** — filtered activation không phát ra ready (no phantom service); **close race** — consumer chạy sau không miss vì ready fire sau bind.

## Mô tả

Với mya, pattern = **RPC readiness gating**: (1) mya đã có **rpc** (packages/rpc) JSON-RPC transport; (2) AID thêm **defer registration** — handler đăng ký ở first `session_start` (bound), không factory-time; (3) **`subagents:ready` broadcast** — sau khi handler bound, emit ready event; (4) **race close** — consumer subscribe trước OR sau ready đều nhận (replay ready cho late subscriber); (5) **filter silence** — activation bị agent-filter loại bỏ → không đăng ký handler, không emit ready (im lặng trên RPC channel, nối AHW).

## Kiến trúc (ASCII)

```
  ❌ TRƯỚC (factory-time — RACE):
     factory đăng ký handler + emit ready
        │
        ▼ consumer factory chạy SAU ──► MISS ready event ✗

  ✅ AID (first bound session_start):
     ACTIVATION
        │
        ├─ agent filter? ──► FILTERED ──► KHÔNG đăng ký, KHÔNG emit (silent)
        │
        └─ first bound session_start:
             ├─ register RPC handlers (bound — not factory)
             ├─ emit "subagents:ready"
             └─ late consumer subscribe ──► REPLAY ready (no miss) ✓
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/rpc index.ts — JSON-RPC transport (RpcHandler bind)
// ✅ packages/intercom extension-api.ts — extension lifecycle (session_start)
// ✅ packages/intercom runtime-claim.ts — activation/claim (nền filter check)
// ✅ AHW cross-extension-rpc — subagents:rpc namespace (gating target)

// ❌ THIẾU: defer registration to first bound session_start
// ❌ THIẾU: subagents:ready broadcast + late-subscriber replay
// ❌ THIẾU: filter silence (filtered activation no emit)
```

## Implementation

```typescript
// packages/agent/src/rpc-readiness.ts (NEW)
export class RpcReadinessGate {
  private handlersBound = false;
  private readyFired = false;
  private readonly readyCallbacks = new Set<() => void>();

  /** Defer handler registration đến first bound session_start — close race. */
  onSessionStart(activated: boolean, register: () => void): void {
    if (!activated) return;                       // FILTERED — silent, no register
    if (this.handlersBound) return;               // đã bound — idempotent
    register();                                   // bind handlers (bound, not factory)
    this.handlersBound = true;
    this.fireReady();                             // broadcast ready SAU bind
  }
  /** Consumer subscribe — replay ready nếu đã fire (no miss). */
  onReady(cb: () => void): void {
    if (this.readyFired) cb();                    // late subscriber — replay
    else this.readyCallbacks.add(cb);
  }
  private fireReady(): void {
    this.readyFired = true;
    for (const cb of this.readyCallbacks) cb();
    this.readyCallbacks.clear();
  }
}
// extension: onSessionStart(activated, register) → gate; consumer: onReady(cb).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Close race — late consumer không miss | ❌ Defer → latency handler available tăng |
| ✅ Filter silence — no phantom service | ❌ Phải track activated vs filtered chính xác |
| ✅ Replay ready cho late subscriber | ❌ readyCallbacks set phải cleanup (memory) |
| ✅ Nối rpc transport sẵn | ❌ Consumer phải dùng onReady (không fire-and-forget) |

## Khác các hướng gần

| | AID RPC-Readiness-Gating | AIC Per-Session-Registry-Claim | AHW Cross-Extension-RPC |
|---|---|---|---|
| Trọng tâm | Khi đăng ký RPC handler | Singleton registry ownership | Extension ↔ extension RPC |
| Cơ chế | Defer to session_start + ready replay | Symbol.for + first-wins | event bus + reply envelope |
| Quan hệ | Gating cho AHW | Gating cho manager | Consumer của AID |

## Khi nào chọn

- Consumer có thể subscribe sau khi service ready → cần replay (close race)
- Activation có thể bị filter → cần silence (no phantom)
- Factory-time registration gây race condition
- Guard: defer to bound session_start, ready broadcast + replay, filter silence, callback cleanup
