# Hướng KT: Multi-Window Views — TUI split-view: chat/diff/status/graph song song

> **Nguồn gốc:** tmux panes; IDE split-view (VS Code); tiling WMs (i3); multi-pane TUI (lazygit, k9s)
> **Coupling:** 🟡 — cần tầng UI terminal
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (TUI sẵn — thiếu layout đa-ô có thể cấu hình)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Split-view / panes** (tmux): chia terminal thành nhiều ô, mỗi ô hiển thị luồng khác nhau — cùng xem nhiều thứ song song. IDE split (VS Code): editor + diff + terminal + problems song song. Tiling WM (i3): cửa sổ tự chia ô, không overlap. TUI đa-ô (lazygit/k9s): status + detail + log đồng thời. Nguyên tắc: agent sinh nhiều luồng thông tin (chat, diff code, status task, cost) — hiển thị **song song** trong ô riêng, user theo dõi toàn cảnh thay vì切换 tab. Nối 161 agent-ide + 99 progressive-disclosure.

## Mô tả

mya multi-window TUI: màn hình chia ô — **chat** (agent output), **diff** (thay đổi code 11 git), **status** (task/74 graph), **cost** (44/167). Mỗi ô scroll độc lập, có thể focus/resize. Layout cấu hình được (chat to + diff nhỏ, hoặc 4 ô đều). Khác single-view: multi-window **song song** — user thấy agent output VÀ diff VÀ status cùng lúc, không mất ngữ cảnh. Nối 161 agent-ide (môi trường).

## Kiến trúc

```
  ┌─────────────────────── mya TUI (split-view) ───────────────────────┐
  │ ┌───────────────────────────┬───────────────────────────┐         │
  │ │ CHAT (agent output)       │ DIFF (code changes 11)     │         │
  │ │ "Tôi sẽ refactor hàm X..."│ - old: function X(){}      │         │
  │ │ > search ✓                │ + new: const X = () => {}  │         │
  │ │ > edit  ✓                 │ 2 files, +12 -5            │         │
  │ │ scroll độc lập ↑↓         │ focus ô này để xem full    │         │
  │ ├───────────────────────────┼───────────────────────────┤         │
  │ │ STATUS (74 graph)         │ COST (44/167)              │         │
  │ │ ● plan ✓  ● code ⧗        │ $0.042 | 1.2k in / 800 out │         │
  │ │ ● test ⏳  ● review ⏸     │ budget 23% used            │         │
  │ └───────────────────────────┴───────────────────────────┘         │
  │  Tab = chuyển ô focus | resize | layout preset (chat-big / grid)   │
  └───────────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/print — TUI render (nền multi-window)
// ✅ 161 agent-ide — IDE environment
// ✅ 11 git-as-ipc — git (nguồn diff)
// ✅ 74 stateful-graph — status (nguồn ô status)
// ✅ 44 cost-budget / 167 per-task-cost — cost (nguồn ô cost)
// ✅ 99 progressive-disclosure — UI phơi bày (nền layout)

// ❌ THIẾU: split-layout engine (ô độc lập, resize)
// ❌ THIẾU: pane registry (mỗi luồng → 1 ô)
// ❌ THIẾU: focus + keybind (Tab chuyển ô)
// ❌ THIẾU: layout preset (chat-big / grid / focus-one)
```

## Implementation

```typescript
// packages/print/src/multi-window.ts (NEW)
interface Pane { id: string; title: string; render(): string[]; focused: boolean; }

class SplitLayout {
  private panes: Pane[] = [];
  private focused = 0;
  private preset: "grid" | "chat-big" | "focus-one" = "grid";

  add(p: Pane): void { this.panes.push(p); }
  focusNext(): void { this.focused = (this.focused + 1) % this.panes.length; }

  draw(cols: number, rows: number): string {
    const active = this.panes.map((p, i) => ({ ...p, focused: i === this.focused }));
    const halfC = Math.floor(cols / 2), halfR = Math.floor(rows / 2);
    const cells = this.preset === "grid"
      ? active.map((p) => box(p.title, p.render(), halfC, halfR, p.focused))
      : this.preset === "chat-big"
        ? [box(active[0].title, active[0].render(), halfC, rows, true), stack(active.slice(1), halfC, rows)]
        : box(active[this.focused].title, active[this.focused].render(), cols, rows, true);
    return Array.isArray(cells) ? cells.join("\n") : cells;
  }
}
// Tab = focusNext() | preset toggle | resize pane — user theo dõi song song
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Theo dõi song song (tmux/lazygit proven) | ❌ Màn hình nhỏ → ô chật (terminal giới hạn) |
| ✅ Không mất ngữ cảnh (xem chat + diff cùng) | ❌ Layout engine phức tạp (resize/redraw) |
| ✅ Layout cấu hình (preset theo task) | ❌ Keybind phức tạp hơn single-view |
| ✅ Nối 161 IDE + 99 disclosure | ❌ Overlap với 99 (cần tách vai) |

## Khác các hướng gần

| | 99 Progressive Disclosure | 161 Agent IDE | KT: Multi-Window |
|---|---|---|---|
| Hiển thị | Phơi theo nhu cầu | 1 môi trường | **Nhiều ô song song** |
| Khi | User hỏi | Luôn | **Luôn, nhiều luồng** |
| Song song | ❌ (từng lớp) | ❌ | ✅ (panes) |
| Layout | ❌ | ❌ | ✅ cấu hình (preset) |

## Khi nào chọn

- User muốn xem nhiều luồng cùng lúc (chat + diff + status + cost)
- Terminal đủ rộng (không chật)
- Agent sinh thông tin đa dạng (cần theo dõi toàn cảnh)
- Môi trường IDE (161) — bổ sung split-view
