# Hướng AFN: Async Result Steering — `subagent()` trả về ngay; khi subagent xong, kết quả được "steer back" vào main session dạng async notification kích hoạt turn mới để agent xử lý — orchestration event-driven

> **Nguồn gốc:** pi-interactive-subagents (pi-extension/subagents/index.ts) | **Coupling:** 🟡 — cần async notification + turn-trigger seam | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có SubagentHandle await async, thiếu steer-back notification) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-interactive-subagents** thiết kế `subagent()` **trả về ngay** (non-blocking) — main agent tiếp tục làm việc. Khi subagent hoàn thành, kết quả được **"steer back"** vào main session dạng **async notification**, notification này **kích hoạt turn mới** để main agent xử lý kết quả. Đây là **orchestration event-driven**: main agent không block chờ, nhận kết quả khi sẵn sàng qua event. Nguyên tắc: **spawn non-blocking + result-via-event + auto-trigger-turn**.

## Mô tả

mya async-result-steering: (1) **SubagentHandle đã sẵn** — `packages/agent` spawnSubagent trả về handle có `status`/`output()`/`wait()`, chạy nền; (2) **steer-back notification** — khi handle chuyển sang "done", inject kết quả vào main session (giống intercom inbound message inject); (3) **trigger new turn** — notification qua `sendMessage({ triggerTurn: true })` đánh thức main agent; (4) **dedupe/orchestration** — nhiều subagent → nhiều notification, main xử lý theo thứ tự arrival. Nối AFJ (triggerTurn) và core loop (runTurn có thể trigger lại).

## Kiến trúc (ASCII)

```
  MAIN AGENT ──spawnSubagent(goal)──▶ subagent() TRẢ VỀ NGAY
     │                                   │ handle (status/output/wait)
     │  tiếp tục turn khác               │ chạy nền...
     │                                   ▼
     │                              subagent DONE (status="done")
     │                                   │
     │              ┌────────────────────┘
     │              ▼  STEER BACK (async notification)
     │   inject result vào main session
     │              ▼
     │   sendMessage({ triggerTurn: true })  ◀── kích hoạt TURN MỚI
     ▼
  MAIN AGENT chạy turn mới xử lý kết quả (event-driven, không block)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent index.ts — spawnSubagent → SubagentHandle (output()/wait() async)
// ✅ packages/agent index.ts — SubagentStatus: pending/running/done/failed/aborted
// ✅ packages/intercom intercom.ts — sendMessage({ triggerTurn: true }) + inject inbound
// ✅ packages/core loop.ts — runTurn có thể được kích hoạt lại bởi trigger

// ❌ THIẾU: steer-back watcher (handle done → inject + triggerTurn)
// ❌ THIẾU: orchestration ordering khi nhiều subagent done gần nhau
```

## Implementation

```typescript
// packages/agent/src/async-steer.ts (MỚI)
import type { SubagentHandle, Agent } from "./index.js";
/** Spawn non-blocking; khi subagent done → steer result về main, trigger turn mới. */
export function spawnAndSteer(
  agent: Agent,
  goal: string,
  opts: { onResult: (output: string, goal: string) => void },
): SubagentHandle {
  const handle = agent.spawnSubagent(goal, opts as never);
  // Watcher: chờ done async, KHÔNG block main.
  void handle.wait().then((output) => {
    if (handle.status === "done") {
      opts.onResult(output, goal);   // caller: sendMessage({triggerTurn:true}) với output
    }
  });
  return handle;   // trả về ngay — main tiếp tục
}
/** Orchestrator: nhiều subagent, steer theo thứ tự arrival. */
export function fanOutAndSteer(
  agent: Agent,
  goals: string[],
  sink: (output: string, goal: string) => void,
): SubagentHandle[] {
  return goals.map((g) => spawnAndSteer(agent, g, { onResult: sink }));
}
// sink = (output, goal) => pi.sendMessage(
//   { content: `Subagent("${goal}") done:\n${output}`, display: true },
//   { triggerTurn: true });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Main agent không block — orchestration hiệu quả | ❌ Notification arrival không thứ tự đảm bảo |
| ✅ Event-driven — phản hồi khi subagent xong | ❌ triggerTurn dày có thể gián đoạn main đang xử lý |
| ✅ Fan-out nhiều subagent song song | ❌ Cần dedupe/orchestration khi nhiều done cùng lúc |

## Khác các hướng gần

| | AFN Async Result Steering | AFM Multiplexer Pane | AIR Abort Threading |
|---|---|---|---|
| Trọng tâm | Steer kết quả về main event-driven | Isolation pane process | Hủy xuyên chain |
| Non-blocking | ✅ trả về ngay | ✅ process riêng | n/a |
| Kết quả | Async notification + triggerTurn | Đọc từ pane | abort |

## Khi nào chọn

- Orchestrator spawn nhiều subagent, không muốn main block chờ từng cái
- Muốn main agent tự xử lý kết quả khi subagent xong (event-driven)
- Fan-out task song song rồi gom kết quả
- Guard: watcher không leak (.then/fail), dedupe notification, triggerTurn có cooldown
