# Hướng AJC: Event-Bus Request-Response — extension khác điều khiển plan-mode qua shared event bus: emit channel với requestId + action + callback respond, timeout 5s

> **Nguồn gốc:** plannotator | **Coupling:** 🟡 — control plane qua event bus | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có intercom bus + receipts; chưa có req/resp pattern) | **Effort:** 1 tuần

## Nguồn gốc

**plannotator** cho phép extension Pi khác **điều khiển plan-mode qua shared event bus**: emit `PLANNOTATOR_REQUEST_CHANNEL` với **`requestId` + action + callback `respond`**, **timeout 5s** — request/response pattern trên bus cho **programmatic control mà không cần slash command**. Extension khác (không phải user) gửi lệnh "bật plan mode" — plan server nhận, thực thi, respond qua callback.

Nguyên tắc: **control giữa extensions đi qua event bus với request/response contract** — không phải slash command (chỉ user gõ được, không programmatic); **requestId để match response** — bus là broadcast, response phải gắn requestId để caller biết của mình; **timeout 5s** — request không respond thì fail nhanh (không treo caller); **callback respond** — responder trả qua callback thay vì broadcast chung (tránh lộn response với message khác).

## Mô tả

Với mya, pattern = **request/response trên event bus**: (1) **intercom `IntercomExtensionChannel` đã có** — `publish(payload)` + `onEvent` (extension bus: namespace, owner/capable audience) — nền đúng; (2) thêm **`request()` helper** — emit với `{ requestId, action, payload }` + subscribe response; match bằng requestId; **timeout 5s** → reject; (3) **responder pattern** — nhận request event → thực thi (bật plan-mode: `cron approval-mode`/role/mode switch) → `respond(requestId, result)` qua publish hẹp (owner/capable); (4) **ứng dụng** — gateway control plane (route `/control` có sẵn) + extension host (package host) + **workflow runner** (packages/workflows) gửi lệnh qua bus thay vì chỉ slash command; (5) **đối chiếu** — `ApprovalRelay` (gateway) đã là request/response qua WS (`requestId`, timeout 24h, decide) — pattern tương tự, AJC đưa lên bus cho extension-to-extension. Nối reply-tracker (intercom — theo dõi pending asks).

## Kiến trúc (ASCII)

```
  CALLER (extension / workflow runner)
    │  request({ action: "set-plan-mode", payload, requestId })
    ▼
  EVENT BUS (intercom extension channel — publish)
    │
    ▼  RESPONDER (plan server / gateway control)
    ├─ nhận event requestId + action
    ├─ thực thi (bật plan-mode / switch role / chạy workflow)
    └─ respond(requestId, result) ──► publish hẹp (owner/capable)
    │
    ▼  CALLER nhận response (match requestId)
    ├─ trong 5s ──► ok (result)
    └─ quá 5s ──► TIMEOUT (fail nhanh — không treo)
  (requestId match — response không lộn với message khác)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom extension-api.ts — IntercomExtensionChannel
//   (publish + onEvent + owner/capable audience — bus nền)
// ✅ packages/intercom reply-tracker.ts — pending asks theo dõi (nền req/resp)
// ✅ packages/gateway approval-relay.ts — requestId + timeout + decide
//   (request/response pattern đã có trên WS — đưa lên bus)
// ✅ packages/gateway control.ts — control plane routes (nền actions)
// ✅ packages/workflows runner.ts — workflow stages (caller tiềm năng)
// ✅ packages/intercom broker — message receipts (queued/delivered — nền)

// ❌ THIẾU: request()/respond() helper trên extension channel
// ❌ THIẾU: timeout 5s + requestId match
// ❌ THIẾU: extension→extension control (chưa có ngoài slash command)
```

## Implementation

```typescript
// packages/intercom/src/extension-rpc.ts (NEW)
import type { IntercomExtensionChannel } from "./extension-api.js";

export const REQUEST_TIMEOUT_MS = 5_000;

/** Request/response trên extension channel — requestId + timeout. */
export function extensionRequest<Req, Res>(
  channel: IntercomExtensionChannel,
  action: string,
  payload: Req,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Res> {
  const requestId = `${action}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`extension request ${action} timed out sau ${timeoutMs}ms`));
    }, timeoutMs);

    const off = channel.onEvent((ev) => {
      // Chỉ nhận response gắn đúng requestId — không lộn với message khác.
      if (ev.type === "message" && typeof ev.payload === "object" &&
          (ev.payload as { requestId?: string }).requestId === requestId) {
        clearTimeout(timer);
        off();
        resolve((ev.payload as { result: Res }).result);
      }
    });

    channel.publish({ kind: "request", requestId, action, payload }, { audience: "capable" });
  });
}

/** Responder — nhận request, thực thi, respond qua publish hẹp. */
export function serveExtensionRequest<Req, Res>(
  channel: IntercomExtensionChannel,
  handler: (action: string, payload: Req) => Promise<Res>,
): void {
  channel.onEvent((ev) => {
    if (ev.type !== "message") return;
    const p = ev.payload as { kind?: string; requestId?: string; action?: string; payload?: Req };
    if (p.kind !== "request" || !p.requestId || !p.action) return;
    void handler(p.action, p.payload as Req)
      .then((result) => channel.publish({ kind: "response", requestId: p.requestId, result }, { ownerOnly: true }))
      .catch(() => channel.publish({ kind: "response", requestId: p.requestId, error: "handler failed" }, { ownerOnly: true }));
  });
}
// Plan server: serveExtensionRequest(channel, (action, payload) =>
//   action === "set-plan-mode" ? control.setPlanMode(payload) : Promise.reject(...));
// Workflow runner/extension: extensionRequest(channel, "set-plan-mode", { on: true }).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Programmatic control — extension gọi được, không cần slash command | ❌ Timeout 5s — handler chậm bị fail (cần timeout lớn hơn cho việc nặng) |
| ✅ requestId match — response không lộn | ❌ Bus broadcast — request tới mọi capable; cần routing rõ |
| ✅ Nối ApprovalRelay pattern (WS) + reply-tracker | ❌ Callback respond hẹp — nếu responder chết, caller timeout |
| ✅ Không phụ thuộc UI/user | ❌ Bảo mật — action qua bus cần auth (ai được gửi lệnh) |

## Khác các hướng gần

| | AJC Event Bus Req/Resp | ADE Mailbox Dispatch | AJA Review Takeover |
|---|---|---|---|
| Trọng tâm | Control qua bus | Audit messaging | Review UX |
| Cơ chế | requestId + timeout + respond | State machine + idempotent | CSS-hide + checkbox |
| Quan hệ | Control plane | Runtime messaging | UI layer |

## Khi nào chọn

- Extension/worker khác cần điều khiển agent (plan-mode, role, workflow) — không phải qua UI
- Đã có intercom extension channel + reply-tracker — thêm req/resp helper
- Muốn fail nhanh (timeout 5s) thay vì treo caller
- Guard: requestId match bắt buộc, timeout rõ, auth action qua bus, responder fail → response lỗi