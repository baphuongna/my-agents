# Hướng AHZ: Live-Widget-Fleetview — persistent widget trên editor hiển thị spinner braille, token count, context-window gauge (color-coded <70/70-85/≥85%), số lần compact (`⇊N`); FleetView dưới editor cho điều hướng bàn phím vào conversation viewer từng agent đang chạy, kèm inline composer để steer

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — TUI widget | **Agent-agnostic:** ❌ (editor/TUI-specific) | **Code sẵn:** ❌ | **Effort:** 2 tuần

## Nguồn gốc

**pi-subagent3** **persistent widget** trên editor hiển thị spinner braille, token count, **context-window gauge** (color-coded <70% 🟢 / 70-85% 🟡 / ≥85% 🔴), số lần compact (`⇊N`); **FleetView** dưới editor cho điều hướng bàn phím vào conversation viewer từng agent đang chạy, kèm **inline composer** để steer. Nguyên tắc: **always-visible status** — agent activity luôn nhìn thấy (không cần switch buffer); **context-window gauge** — cảnh báo sắp đầy sớm; **fleet navigation** — nhiều agent → điều hướng bàn phím; **inline steer** — composer gửi message không rời editor.

## Mô tả

Với mya, pattern = **live status widget + fleet view**: (1) mya chưa có persistent editor widget (packages/agent headless; natives/print TUI); (2) AHZ thêm **status bar widget**: `⠙ <agent> ctx:42% 🟢 tokens:1.2k ⇊0`; (3) **context-window gauge** từ token count (stream done.usage) / model ctx window; (4) **compact counter** `⇊N` (n nối compaction count); (5) **FleetView** — list agent đang chạy (pool AgentSessionEntry busy), keyboard nav vào AHP viewer; (6) **inline composer** — steer mid-run (nối AIF mid-run-steering).

## Kiến trúc (ASCII)

```
  ┌─ EDITOR ────────────────────────────────────────────────┐
  │  (code buffer)                                          │
  │                                                         │
  ├─ STATUS WIDGET (persistent, always visible) ────────────┤
  │ ⠙ review-bot  ctx:42% 🟢  tokens:1.2k  ⇊0  [running]    │
  ├─ FLEET VIEW (keyboard nav vào viewer) ──────────────────┤
  │ ► review-bot   ctx:42% 🟢   [enter → viewer]            │
  │   refactor     ctx:85% 🔴   [enter → viewer]            │
  │   scout        ctx:18% 🟢   [enter → viewer]            │
  ├─ COMPOSER (inline steer) ───────────────────────────────┤
  │ > _                                          [enter=steer]│
  └─────────────────────────────────────────────────────────┘
  gauge: <70% 🟢 | 70-85% 🟡 | ≥85% 🔴 ; ⇊N = số lần compact
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent pool.ts — AgentSessionEntry { busy, messageCount } (fleet list)
// ✅ packages/agent — spawnSubagent handle { status, startedAt } (nền status)
// ✅ natives/print — ink/TUI rendering foundation
// ✅ packages/core telemetry.ts — token/usage tracking (nền token count)

// ❌ THIẾU: persistent status widget (spinner + gauge + compact counter)
// ❌ THIẾU: FleetView keyboard navigation
// ❌ THIẾU: inline composer (steer mid-run — nối AIF)
// ❌ THIẾU: context-window gauge (cần model ctx window config)
```

## Implementation

```tsx
// packages/print/src/agent-widget.tsx (NEW — ink)
import type { AgentSessionEntry } from "@my-agent/agent";

interface WidgetProps { entry: AgentSessionEntry; ctxWindow: number; tokens: number; compactions: number; }

function gaugeColor(pct: number): string {
  return pct < 70 ? "🟢" : pct < 85 ? "🟡" : "🔴";
}
export function AgentWidget({ entry, ctxWindow, tokens, compactions }: WidgetProps): JSX.Element {
  const pct = ctxWindow > 0 ? Math.round((tokens / ctxWindow) * 100) : 0;
  return (
    <Text>
      ⠙ {entry.agentName ?? "agent"}  ctx:{pct}%{gaugeColor(pct)}  tokens:{(tokens / 1000).toFixed(1)}k  ⇊{compactions}  [{entry.busy ? "running" : "idle"}]
    </Text>
  );
}
// FleetView: map pool.busy entries → rows; keyboard up/down + enter → open AHP viewer.
// Composer: input box → onSubmit → steerSubagent(id, msg) (nối AIF mid-run-steering).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent activity always-visible (không switch buffer) | ❌ TUI-specific (không agent-agnostic) |
| ✅ Context gauge cảnh báo sớm | ❌ Token count real-time overhead |
| ✅ Fleet nav nhiều agent | ❌ Phức tạp keyboard routing |
| ✅ Inline steer không rời editor | ❌ Editor integration (VSCode/Neovim khác nhau) |

## Khác các hướng gần

| | AHZ Live-Widget-Fleetview | AHP Two-Level-UI-Collapse | AIF Mid-Run-Steering-Injection |
|---|---|---|---|
| Trọng tâm | Widget tổng quan + fleet | Viewer 2 cấp chi tiết | Steer mid-run |
| Cơ chế | Status bar + keyboard nav + composer | Toggle + tree | Inject user message + redirect |
| Quan hệ | Tổng quan (overview) | Chi tiết (detail) | Action (steer) |

## Khi nào chọn

- Nhiều agent chạy song song → cần always-visible status
- Muốn context-window gauge cảnh báo sớm (trước compact)
- Editor-first workflow → steer không rời editor
- Guard: gauge threshold calibrate, token count real-time, keyboard routing rõ, editor-adapter per target
