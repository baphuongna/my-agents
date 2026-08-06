# Hướng ACA: Live Status Widget Subagents — TUI hiển thị status widget live cho từng subagent (id/model/turn count/context tokens), sống sót qua /new /resume /fork /reload nhờ reconnect về owner session

> **Nguồn gốc:** pi-crew (extension/status-widget.ts) | **Coupling:** 🟡 — thêm status widget + reconnect vào TUI/agent tracking | **Agent-agnostic:** ⚠️ (TUI-specific) | **Code sẵn:** ⚠️ (có agents-panel — chưa có live widget + reconnect) | **Effort:** 2 tuần

## Nguồn gốc

**pi-crew** extension `status-widget.ts`: TUI hiển thị **status widget live** cho từng subagent đang chạy — **id, model, turn count, context token usage** — với **spinner frame** và **icon đặc biệt (⏳)** cho **interactive subagent đang chờ response**. Điểm quan trọng: widget **sống sót qua `/new`, `/resume`, `/fork`, `/reload`** — khi session chủ reset/đổi, widget vẫn hiển thị subagent đang chạy nhờ **subagent reconnect về owner session** (subagent không chết khi session chủ reload; nó reconnect và widget theo dõi lại). Nguyên tắc: **status live per-subagent (id/model/turns/context), interactive subagent có icon riêng (⏳), widget sống sót qua session ops nhờ reconnect**.

## Mô tả

mya live status widget subagents: TUI panel hiển thị **status live** cho từng subagent: id, model, turn count, context token usage, spinner frame (đang chạy), icon ⏳ cho interactive subagent đang chờ user; widget **sống sót qua /new /resume /fork /reload** — subagent **reconnect về owner session** sau khi session chủ reset (không orphan, không mất theo dõi). mya có packages/print agents-panel.ts (live tree — poll /pool/tree 2s) + launcher.ts (status display) — ACA thêm **per-subagent status detail** (model/turns/context) + **interactive icon** + **reconnect mechanism**.

## Kiến trúc

```
  TUI (status widget)
  ┌─────────────────────────────────────────────┐
  │  ⠋ sub-1  model=haiku  turns=3  ctx=12k    │  ← spinner (đang chạy)
  │  ⏳ sub-2  model=sonnet  turns=1  ctx=8k    │  ← interactive (chờ user)
  │  ✓ sub-3  model=opus    turns=5  ctx=45k   │  ← done
  └──────────────────────┬──────────────────────┘
                         │  theo dõi subagent state
                         ▼
  SUBAGENT STATE (id, model, turnCount, contextTokens, interactive, status)
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
  /new /resume /fork /reload     SUBAGENT RECONNECT
  (session chủ reset)            ──► subagent reconnect về owner session
                                 ──► widget theo dõi lại (không mất)
  → widget sống sót qua session ops
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print agents-panel.ts — live agents tree (poll /pool/tree 2s) (nền — ACA widget)
// ✅ packages/print launcher.ts — status display (nền — ACA host)
// ✅ packages/gateway — /pool/tree + session tracking (nền — ACA data source)
// ✅ packages/agent pool.ts — AgentSession state (nền — ACA turn count/context)
// ✅ 753 ABY nonblocking-subagent-steering — background subagent (nền — ACA theo dõi subagent nền)

// ❌ THIẾU: per-subagent status detail (model/turn count/context tokens)
// ❌ THIẾU: interactive icon (⏳ cho subagent đang chờ user)
// ❌ THIẾU: reconnect mechanism (subagent reconnect về owner sau /new /resume /fork /reload)
```

## Implementation

```typescript
// packages/print/src/status-widget.ts (MỚI)
import type { AgentTreeNode } from "./agents-panel.js";

export interface SubagentStatus {
  id: string;
  model: string;
  turnCount: number;
  contextTokens: number;
  interactive: boolean; // đang chờ user response → icon ⏳
  status: "running" | "waiting" | "done" | "failed";
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Render status widget live cho từng subagent (spinner + interactive icon). */
export function renderStatusWidget(subagents: SubagentStatus[], frame: number): string[] {
  return subagents.map(s => {
    const icon = s.interactive && s.status === "waiting"
      ? "⏳"                                    // interactive đang chờ user
      : s.status === "running"
        ? SPINNER[frame % SPINNER.length]!      // spinner frame (đang chạy)
        : s.status === "done" ? "✓" : "✗";
    const ctx = `${(s.contextTokens / 1024).toFixed(1)}k`;
    return `${icon} ${s.id.padEnd(8)} model=${s.model.padEnd(14)} turns=${s.turnCount} ctx=${ctx}`;
  });
}

/** Theo dõi subagent state; widget sống sót qua session ops nhờ reconnect. */
export class StatusTracker {
  private readonly states = new Map<string, SubagentStatus>();
  private frame = 0;

  constructor(private onReconnect: (subagentId: string) => void) {}

  /** Reconnect: session chủ /new /resume /fork /reload → subagent reconnect về owner. */
  reconnect(subagentId: string): void {
    this.onReconnect(subagentId);
    const s = this.states.get(subagentId);
    if (s) this.states.set(subagentId, { ...s, status: "running" }); // theo dõi lại, không mất
  }

  update(s: SubagentStatus): void { this.states.set(s.id, s); }

  render(): string[] {
    return renderStatusWidget([...this.states.values()], this.frame++);
  }
}
// Usage:
// const tracker = new StatusTracker(id => agentPool.reconnectSubagent(id));
// setInterval(() => {
//   for (const sub of fetchSubagentStatuses()) tracker.update(sub);
//   tui.render(tracker.render()); // spinner + ⏳ + turns + ctx, sống sót qua /reload
// }, 1000);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Live status (model/turns/context — user thấy subagent đang làm gì) | ❌ Poll cost (fetch status định kỳ — load nhẹ nhưng thêm traffic) |
| ✅ Interactive icon (⏳ — user biết subagent đang chờ mình) | ❌ TUI-specific (chỉ hữu ích trong terminal UI) |
| ✅ Sống sót qua session ops (reconnect — không mất theo dõi) | ❌ Reconnect phức tạp (subagent phải biết owner session mới) |
| ✅ Spinner frame (visual động — không tưởng tượng "đang chạy") | ❌ Status stale (tracker không nhận update → widget hiển thị cũ) |

## Khác các hướng gần

| | Log text (subagent xong mới thấy) | Tree đơn giản (agents-panel) | ACA: Live Status Widget |
|---|---|---|---|
| Chi tiết | không | id/status | **model + turns + context tokens** |
| Interactive | không biết | không | **icon ⏳ riêng** |
| Session ops | mất theo dõi | poll lại | **reconnect — sống sót** |
| Live | không | 2s poll | **spinner + frame động** |

## Khi nào chọn

- Nhiều subagent chạy nền — user cần thấy trạng thái live (đang chạy/chờ/done)
- Có interactive subagent (chờ user) — cần phân biệt bằng icon
- Session chủ hay /new /resume /fork /reload — cần widget không chết
- Nối packages/print agents-panel.ts + launcher.ts + packages/gateway /pool/tree + packages/agent pool.ts + 753 ABY; guard poll-interval (poll vừa đủ — không tốn CPU), reconnect-completeness (mọi session op đều reconnect — không sót), và context-token-source (token usage lấy từ đúng nguồn — không estimate mù); ACA = live status widget subagents, kết hợp 753 ABY nonblocking-subagent-steering (subagent nền được widget theo dõi) + 754 ABZ frontmatter-driven-subagent-discovery (widget hiển thị config từ frontmatter)
