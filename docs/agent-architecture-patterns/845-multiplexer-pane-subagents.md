# Hướng AFM: Multiplexer Pane-Subagents — mỗi subagent chạy trong pane riêng của multiplexer (cmux/tmux/zellij/wezterm); launch command nhắm child surface theo ID nên focus và command delivery độc lập — parallel thật sự không chặn main agent

> **Nguồn gốc:** pi-interactive-subagents (README.md, pi-extension/subagents/cmux.ts) | **Coupling:** 🔴 — phụ thuộc multiplexer ngoài (tmux/zellij/wezterm) | **Agent-agnostic:** ⚠️ (gắn terminal multiplexer) | **Code sẵn:** ❌ (có subagent pool in-process, không có external pane) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-interactive-subagents** chạy mỗi subagent trong **pane riêng của multiplexer** (cmux/tmux/zellij/wezterm). Launch command nhắm **child surface theo ID** — vì mỗi subagent có surface ID riêng, **focus** và **command delivery** hoàn toàn độc lập: người dùng nhìn từng pane, gõ command vào đúng pane, mà main agent không bị chặn. Đây là **parallel thật sự** (process riêng + UI riêng), khác subagent in-process chia sẻ event loop. Nguyên tắc: **1 subagent = 1 pane = 1 surface ID**, delivery độc lập theo ID.

## Mô tả

mya multiplexer-pane: (1) **subagent pool đã sẵn** — `packages/agent` spawnSubagent tạo SubagentHandle (isolated session, riêng history), nhưng **in-process** (chạy trong cùng Node event loop); (2) **external pane** — cần spawn subagent thành **process riêng** trong pane multiplexer; (3) **surface ID routing** — mỗi pane có ID, command gửi theo ID (giống intercom session routing); (4) **multiplexer adapter** — cmux/tmux/zellij/wezterm (cần chọn 1); (5) **focus độc lập** — người dùng chọn pane để xem/tương tác. Nối AFN (async result steering) và collab relay (multi-client).

## Kiến trúc (ASCII)

```
  MULTIPLEXER (tmux/zellij/wezterm)
  ┌──────────────┬──────────────┬──────────────┐
  │ PANE A (main)│ PANE B (sub1)│ PANE C (sub2)│
  │ surface id=1 │ surface id=2 │ surface id=3 │
  │              │              │              │
  │ main agent   │ subagent α   │ subagent β   │
  └──────┬───────┴──────┬───────┴──────┬───────┘
         │              │              │
         ▼              ▼              ▼
   launch(cmd, surfaceId)  ◀── nhắm pane theo ID
   focus(surfaceId)        ◀── user chọn pane xem
   deliver(cmd, surfaceId) ◀── command đi đúng pane

   PARALLEL thật sự: process riêng + event loop riêng + UI riêng
   main agent KHÔNG bị chặn khi subagent chạy
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent index.ts — spawnSubagent → SubagentHandle (isolated session)
// ✅ packages/agent pool.ts — subagent pool (active + completed)
// ✅ packages/intercom/broker client.ts — session routing theo id (nền surface ID)
// ✅ packages/collab relay.ts — multi-client broadcast (nền multi-pane)

// ❌ THIẾU: external pane spawn (process riêng trong multiplexer)
// ❌ THIẾU: multiplexer adapter (cmux/tmux/zellij/wezterm)
// ❌ THIẾU: surface-ID launch/focus/delivery command
```

## Implementation

```typescript
// packages/agent/src/multiplexer-pane.ts (MỚI)
export type Multiplexer = "tmux" | "zellij" | "wezterm" | "cmux";
export interface PaneSubagent {
  readonly surfaceId: string;
  readonly childPid: number;
  readonly multiplexer: Multiplexer;
}
/** Spawn subagent thành pane riêng — process độc lập, không chặn main. */
export async function spawnPaneSubagent(
  goal: string,
  mux: Multiplexer,
  launch: (surfaceId: string, cmd: string[]) => Promise<{ pid: number }>,
): Promise<PaneSubagent> {
  const surfaceId = `sub_${crypto.randomUUID().slice(0, 8)}`;
  const cmd = ["mya", "--surface", surfaceId, "--goal", goal];
  const { pid } = await launch(surfaceId, cmd);  // tmux new-window / zellij new-pane...
  return { surfaceId, childPid: pid, multiplexer: mux };
}
/** Gửi command vào đúng pane theo surface ID (không chạm pane khác). */
export function deliverToPane(surfaceId: string, text: string, sendKeys: (id: string, t: string) => void): void {
  sendKeys(surfaceId, text + "\r");  // tmux send-keys -t <id>
}
/** Focus pane để người dùng xem (không ảnh hưởng delivery). */
export function focusPane(surfaceId: string, select: (id: string) => void): void {
  select(surfaceId);  // tmux select-pane -t <id>
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parallel thật sự — process + event loop riêng | ❌ Phụ thuộc multiplexer ngoài (không phải mọi môi trường có) |
| ✅ Người dùng thấy từng subagent trong pane | ❌ Phức tạp setup/orchestration pane |
| ✅ Delivery độc lập theo surface ID | ❌ IPC cross-process (khó debug hơn in-process) |
| ✅ Main agent không bị chặn | ❌ Tài nguyên cao (mỗi pane = 1 process Node) |

## Khác các hướng gần

| | AFM Multiplexer Pane | AFN Async Result Steering | ACE Side Thread |
|---|---|---|---|
| Isolation | Process riêng + pane UI | In-process async | In-process side session |
| Parallel | Thật sự (đa process) | Cooperative (event loop) | Cooperative |
| UI | Pane multiplexer riêng | Notification về main | Overlay panel |

## Khi nào chọn

- Cần parallel thật sự (subagent CPU/IO nặng không chặn main)
- Người dùng muốn theo dõi từng subagent trực quan (pane riêng)
- Môi trường có multiplexer (tmux/zellij/wezterm) sẵn
- Guard: multiplexer detection, surface-ID routing nhất quán, cleanup pane khi xong, IPC fallback khi không có mux
