# Hướng AEZ: Tab Status Timeout Watchdog — đổi tiêu đề tab ✅/🚧/🛑 theo event, watchdog 180s bắt timeout

> **Nguồn gốc:** pi-extensions2 | **Coupling:** 🟢 — UI layer, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn RuntimeEvent stream + event normalizer) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions2** (tab-status/tab-status.ts): theo dõi trạng thái session qua **event** (`agent_start/end`, `tool_result`) và **đổi tiêu đề tab** thành **✅ / 🚧 / 🛑**; kèm **watchdog 180s** — không có hoạt động trong 180s → đánh dấu **timeout**; phát hiện **commit** qua **regex git commit** (khi agent commit, tiêu đề chuyển trạng thái "đã commit"). Tức: tiêu đề tab là **trạng thái sống của agent** nhìn từ ngoài (user mở nhiều tab, liếc mắt biết tab nào đang chạy/chờ/chết).

Giá trị: (1) **glanceable status** — không cần mở tab để biết agent còn sống/đang chạy/treo; (2) **watchdog** — agent treo (không event) bị lộ sau 180s — không để tab "đang chạy" mãi dù thực tế chết; (3) **sự kiện thật** — status từ event stream (agent_start → 🚧, agent_end → ✅, timeout → 🛑), không đoán; (4) **commit detection** — mốc tiến triển thật (agent vừa commit = đã hoàn thành một chặng).

## Mô tả

Với mya, pattern = **status FSM trên RuntimeEvent**: (1) mya đã có **RuntimeEvent stream** (`packages/core` — loop emit text/tool_call/tool_result/usage) — nguồn sự thật cho status; (2) **FSM** — `idle → running (🚧) → done (✅) → error/timeout (🛑)`; `agent_start` → 🚧, `agent_end` → ✅, tool_call/tool_result → cập nhật hoạt động (reset watchdog); (3) **watchdog 180s** — timer: không có event trong 180s → 🛑 timeout (nối AEP tinh thần — abort/timeout là trạng thái hợp lệ); (4) **commit regex** — output tool chứa `git commit` (regex `commit [a-f0-9]{7,40}`) → gắn cờ "committed" vào title (nối output-compress git reducers); (5) **render** — đổi title terminal (`\x1b]0;…\x1b\\` OSC — cùng lớp escape AEX/AEY) hoặc tab UI. Đây là pattern **externalized liveness**: trạng thái agent hiển thị ngoài, cập nhật từ event, không cần poll.

## Kiến trúc (ASCII)

```
  AGENT LOOP (packages/core) — RuntimeEvent stream
  ├─ agent_start  ──► FSM: running 🚧  (reset watchdog)
  ├─ tool_call    ──► hoạt động — reset watchdog 180s
  ├─ tool_result  ──► hoạt động + scan commit regex
  │                   └─ match "commit a1b2c3d" ──► title + "committed"
  ├─ agent_end    ──► FSM: done ✅
  └─ (im lặng 180s) ──► WATCHDOG: timeout 🛑 (treo bị lộ)
    │
    ▼ STATUS FSM: idle ─► 🚧 ─► ✅ / 🛑
    ▼ RENDER: title tab/terminal (OSC \x1b]0;…) — glanceable
  (user liếc nhiều tab — biết ngay tab nào chạy/chờ/chết)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/loop.ts — RuntimeEvent stream (agent_start/end, tool events)
// ✅ packages/core/src/types.ts — RuntimeEvent types (nguồn FSM)
// ✅ packages/tools/src/output-compress.ts — git reducers (nối commit regex)
// ✅ packages/print/src/agents-panel.ts — panel/status render pattern
// ✅ packages/print/src/focus-recap.ts (AEX) — cùng lớp escape OSC/title
// ✅ packages/workflows/src/runner.ts — signal timeout (tinh thần watchdog)

// ❌ THIẾU: status FSM (idle/running/done/error/timeout)
// ❌ THIẾU: watchdog 180s (reset theo event, fire → 🛑)
// ❌ THIẾU: commit regex + title render (OSC)
```

## Implementation

```typescript
// packages/print/src/tab-status.ts (NEW)
export type TabStatus = "idle" | "running" | "done" | "error" | "timeout";

const COMMIT_RE = /\bcommit\s+[0-9a-f]{7,40}\b/i;
const WATCHDOG_MS = 180_000;

export class TabStatus {
  private status: TabStatus = "idle";
  private committed = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(private setTitle: (title: string) => void) {}   // OSC \x1b]0;…

  /** Mọi event → cập nhật FSM + reset watchdog. */
  onEvent(e: { kind: string; text?: string; tool?: string }): void {
    if (e.kind === "agent_start") { this.status = "running"; this.committed = false; }
    else if (e.kind === "agent_end") { this.status = "done"; }
    else if (e.kind === "tool_result" || e.kind === "tool_call") {
      if (this.status !== "running") this.status = "running";
      if (e.text && COMMIT_RE.test(e.text)) this.committed = true;   // commit detection
    }
    this.kickWatchdog();
    this.render();
  }

  /** Watchdog: 180s không event → timeout 🛑 (treo bị lộ). */
  private kickWatchdog(): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.status = "timeout";
      this.render();
    }, WATCHDOG_MS);
  }

  private render(): void {
    const icon = this.status === "running" ? "🚧" : this.status === "done" ? "✅" : this.status === "timeout" ? "🛑" : "…";
    const suffix = this.committed ? " · committed" : "";
    this.setTitle(`mya ${icon}${suffix}`);
  }
}
// Wire: loop emit → tabStatus.onEvent(e) — status sống từ event, không poll
// Nối AEX/AEY: cùng lớp escape — title qua OSC, không lẫn paste/focus
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Glanceable — liếc tab biết agent chạy/chờ/chết | ❌ Event miss (transport lỗi) → status sai — cần watchdog bù |
| ✅ Watchdog 180s bắt treo — không "chạy" mãi | ❌ 180s có thể false-positive với task chạy im lặng lâu |
| ✅ Status từ event thật — không đoán | ❌ Commit regex có thể match nhầm text (cần scope tool) |
| ✅ Nối event stream + output-compress sẵn | ❌ Nhiều tab → nhiều watchdog timer (cần quản lý) |

## Khác các hướng gần

| | AEZ Tab Status | AEX Focus Recap | AEP Workflow Abort |
|---|---|---|---|
| Trọng tâm | Trạng thái session ngoài | Vẽ recap đúng lúc | Hủy workflow |
| Cơ chế | FSM + watchdog 180s | DECSET ?1004 + fallback | AbortSignal lan |
| Quan hệ | Tiêu thụ RuntimeEvent | Cùng lớp escape | Watchdog timeout → 🛑 (tinh thần) |

## Khi nào chọn

- User mở nhiều session/tab — cần biết trạng thái không cần mở
- Agent chạy dài — treo phải bị lộ (watchdog)
- Đã có RuntimeEvent stream + agents-panel — thêm FSM + title
- Muốn mốc tiến triển thật (commit detection) trong status