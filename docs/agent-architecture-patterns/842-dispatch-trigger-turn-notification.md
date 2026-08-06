# Hướng AFJ: Dispatch Trigger-Turn Notification — mode dispatch fire-and-forget: session kết thúc (exit/timeout/quiet) thì `pi.sendMessage({ triggerTurn: true })` đánh thức agent kèm tail output, không cần polling

> **Nguồn gốc:** pi-interactive-shell (index.ts) | **Coupling:** 🟡 — phụ thuộc intercom sendMessage + triggerTurn seam | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có sendMessage + triggerTurn seam, thiếu dispatch-mode lifecycle) | **Effort:** 1 tuần

## Nguồn gốc

**pi-interactive-shell** chạy shell trong mode **dispatch** (fire-and-forget): agent khởi tạo session, tiếp tục làm việc khác, và **không polling**. Khi session kết thúc (exit code / timeout / quiet-window), pi gọi `pi.sendMessage(payload, { triggerTurn: true })` — payload mang tail output và exit status. `triggerTurn` là tín hiệu "đánh thức agent chạy thêm một turn" để xử lý kết quả thay vì chờ đợi thụ động. Nguyên tắc: **fire-and-forget + wake-on-event** — agent không block, không poll; hệ thống thông báo khi có kết quả.

## Mô tả

mya dispatch-trigger-turn: (1) **mode dispatch** — task nền chạy độc lập, agent không await (giống background subagent); (2) **triggerTurn seam đã sẵn** — `packages/intercom` `sendMessage(payload, { triggerTurn: true })` đánh thức agent kèm payload (đã có cho inbound message delivery "trigger"); (3) **session-end detector** — detect exit/timeout/quiet để quyết định khi fire notification; (4) **tail output** — payload mang cuối output + exit status để agent xử lý ngay. Nối AIR (abort-signal) để hủy session nền, và AFK (monitor-trigger) cho mode poll/watch.

## Kiến trúc (ASCII)

```
  AGENT ──dispatch(task)──▶ SESSION NỀN (shell/worker)
    │  fire-and-forget, KHÔNG await, tiếp tục turn khác
    │
    │            SESSION NỀN chạy...kết thúc khi:
    │            ├─ exit (code 0/non-0)
    │            ├─ timeout (deadline)
    │            └─ quiet (không output N giây)
    │                        │
    │                        ▼
    │            pi.sendMessage(
    │              { content: tail + exitStatus },
    │              { triggerTurn: true }   ◀── ĐÁNH THỨC agent
    │            )
    ▼
  AGENT chạy turn mới xử lý kết quả (không poll, không block)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom intercom.ts — sendMessage(payload, { triggerTurn: true })
//    (delivery === "trigger" && shouldTriggerInboundMessage → triggerTurn)
// ✅ packages/intercom intercom.ts — ensureConnected("background") retry reconnect
// ✅ packages/agent index.ts — SubagentHandle (background, await output async)
// ✅ packages/core loop.ts — runTurn có thể được kích hoạt lại bởi inbound trigger

// ❌ THIẾU: dispatch-mode wrapper (fire-and-forget + session-end detector)
// ❌ THIẾU: exit/timeout/quiet detection → sendMessage({ triggerTurn:true })
// ❌ THIẾU: tail-output capture + exit-status payload shape
```

## Implementation

```typescript
// packages/intercom/src/dispatch-mode.ts (MỚI)
export interface DispatchSession {
  readonly id: string;
  readonly startedAt: number;
  finished: boolean;
  exitStatus?: number;
  tail: string[];          // circular buffer cuối output
}
/** Chạy task nền fire-and-forget; wake agent khi kết thúc. */
export function dispatchTriggerTurn(
  send: (p: { content: string; display: boolean }, opts: { triggerTurn: boolean }) => void,
  session: DispatchSession,
  events: AsyncIterable<string>,
  opts: { timeoutMs: number; quietMs: number; tailLines: number },
): void {
  let lastOutput = Date.now();
  const finish = (reason: string, code?: number) => {
    if (session.finished) return;
    session.finished = true; session.exitStatus = code;
    send(
      { content: `[dispatch ${reason}] exit=${code ?? "n/a"}\n${session.tail.join("\n")}`, display: true },
      { triggerTurn: true },
    );
  };
  (async () => {
    for await (const line of events) {
      session.tail.push(line);
      if (session.tail.length > opts.tailLines) session.tail.shift();
      lastOutput = Date.now();
    }
    finish("exit");
  })();
  setTimeout(() => finish("timeout"), opts.timeoutMs);
  setInterval(() => { if (!session.finished && Date.now() - lastOutput > opts.quietMs) finish("quiet"); }, opts.quietMs);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent không block, không poll — tiết kiệm turn/token | ❌ Cần session-end detector chính xác (exit/timeout/quiet) |
| ✅ Wake-on-event phản hồi ngay khi xong | ❌ triggerTurn khi agent đang bận có thể gián đoạn |
| ✅ Tail output đủ ngữ cảnh để agent xử lý | ❌ Output dài → tail truncate mất thông tin đầu |

## Khác các hướng gần

| | AFJ Dispatch Trigger-Turn | AFK Monitor-Trigger | AFL Reattach Overlay |
|---|---|---|---|
| Kích hoạt | Session **kết thúc** | Trigger **match** sự kiện | Mở lại session background |
| Wake cơ chế | sendMessage triggerTurn | trigger stream/poll-diff | ReattachOverlay UI |
| Mục đích | Nhận kết quả task nền | Phản hồi thay đổi cấu trúc | Tiếp tục phiên người dùng |

## Khi nào chọn

- Task nền (shell/worker) chạy lâu, agent không nên block chờ
- Muốn agent tự xử lý kết quả khi task xong mà không polling
- Cần phản hồi theo event (exit/timeout/quiet) thay vì interval cố định
- Guard: session-end detector tường minh, tail capture giới hạn, idempotent (chỉ fire 1 lần)
