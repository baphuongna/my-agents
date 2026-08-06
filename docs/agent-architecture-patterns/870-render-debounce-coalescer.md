# Hướng AGL: Render Debounce Coalescer — gộp mọi request render vào 1 timer (default 33ms) và defer khi user đang gõ để TUI không giật

> **Nguồn gốc:** pi-powerline-footer | **Coupling:** 🟡 — bind vào TUI render loop | **Agent-agnostic:** ✅ (logic render thuần, không dính agent loop) | **Code sẵn:** ⚠️ (ink tự batch re-render, nhưng KHÔNG có coalescer có chủ đích + editor-type-defer) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-powerline-footer** dùng một `RenderScheduler` tập trung: mọi lời gọi render (status update, token count, spinner tick, git branch change...) đều đổ vào cùng một hàng đợi thay vì mỗi nguồn tự `setTimeout` riêng. Scheduler **coalesce** toàn bộ request chờ trong cửa sổ `33ms` (≈30fps) thành **một lần vẽ duy nhất**. Ngoài ra khi phát hiện user đang gõ (chỉnh sửa input), scheduler **defer** render thêm `EDITOR_STATUS_DEFER_MS` — tránh redraw footer giữa chừng làm nháy/duplicate keystroke.

Nguyên tắc: **coalesce nhiều tín hiệu thành 1 vẽ** (giảm jank + tiết kiệm CPU); **nhường quyền ưu tiên cho input người dùng** (defer khi đang gõ); **một timer duy nhất** thay vì N timer rải rác — dễ trace, dễ cancel.

## Mô tả

Với mya, TUI (packages/print) hiện dựa vào **Ink** (React renderer cho CLI) vốn đã tự **batch** re-render theo microtask/flush cycle — nên jank cơ bản đã được giảm. Tuy nhiên mya **chưa có** một `RenderScheduler` có chủ đích với hai chính sách: (1) **coalescing cửa sổ cố định** (gom các emit rời rạc từ spinner/tokens/git/intercom status thành 1 vẽ), và (2) **editor-type-defer** (khi phát hiện user đang gõ trong input box, trì hoãn vẽ footer/status cho tới khi ngừng gõ). Pattern này đáng giá khi nhiều lane (subagent/cron/channel) cùng emit status cùng lúc — coalescer gom thành 1 frame.

## Kiến trúc (ASCII)

```
  N NGUỒN (spinner, tokens, git, cron, intercom)
        │ requestRender(src)
        ▼
  ┌─────────────────────────────────────┐
  │ RenderScheduler (1 timer duy nhất)  │
  │  - pending = Set<src>               │
  │  - COALESCE_MS = 33 (≈30fps)        │
  │  - editorTyping? defer thêm DEFER_MS│
  └─────────────────────────────────────┘
        │ timer fire → flush()
        ▼
  1 LẦN VẼ DUY NHẤT (rebuild footer/status)
  ── user đang gõ → reset timer, không vẽ giữa chừng
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/shared-instances.ts — singleton instances dùng chung
// ✅ Ink (React CLI renderer) — tự batch re-render theo flush cycle
// ✅ packages/agent/src/agents-panel.ts — panel rendering trong TUI
// ⚠️ KHÔNG có RenderScheduler có chủ đích (coalesce window + editor-type-defer)
// ❌ KHÔNG có cờ editorTyping → defer render khi user đang gõ input
```

## Implementation

```typescript
// packages/print/src/render-scheduler.ts (NEW)
export class RenderScheduler {
  private timer?: NodeJS.Timeout;
  private pending = new Set<string>();
  private editorTyping = false;
  private editorTimer?: NodeJS.Timeout;

  constructor(
    private readonly draw: () => void,
    private readonly coalesceMs = 33,        // ~30fps
    private readonly editorDeferMs = 150,    // EDITOR_STATUS_DEFER_MS
  ) {}

  request(source: string): void {
    this.pending.add(source);
    this.arm();
  }

  setEditorTyping(active: boolean): void {
    this.editorTyping = active;
    if (active) {
      clearTimeout(this.editorTimer);
      this.editorTimer = setTimeout(() => { this.editorTyping = false; this.arm(); }, this.editorDeferMs);
    }
  }

  private arm(): void {
    if (this.timer) return;                  // timer đã chờ → gộp luôn
    const delay = this.editorTyping ? this.editorDeferMs : this.coalesceMs;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, delay);
  }

  private flush(): void {
    if (this.editorTyping) { this.arm(); return; }   // vẫn đang gõ → lùi tiếp
    if (this.pending.size === 0) return;
    this.pending.clear();
    this.draw();                             // 1 lần vẽ cho mọi nguồn
  }
}
// Hook: input box gọi scheduler.setEditorTyping(true/false) trên keystroke;
// mọi status emitter gọi scheduler.request(src) thay vì vẽ trực tiếp.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm jank — nhiều emit thành 1 frame | ❌ Độ trễ tối đa = coalesceMs (33ms) + defer |
| ✅ Nhường CPU khi user đang gõ (không cướp focus) | ❌ Editor-type-defer cần hook keystroke (coupling input box) |
| ✅ 1 timer thay vì N timer — dễ trace/cancel | ❌ Spinner animation mượt phụ thuộc window vừa đủ |

## Khác các hướng gần

| | AGL Render Coalescer | AHG Segment Dedup | AGY Stale-Cache-First |
|---|---|---|---|
| Trọng tâm | Gộp vẽ thành 1 frame | Bỏ emit khi data không đổi | Vẽ cache ngay, fetch nền |
| Cơ chế | 1 timer + editor-defer | segmentEquals + 200ms coalesce | allowStaleCache + bg re-fetch |
| Quan hệ | Nối render loop | Nối emit pipeline | Nối data freshness |

## Khi nào chọn

- Nhiều lane (subagent/cron/channel) cùng emit status → cần gom thành 1 frame
- TUI giật khi user đang gõ và status redraw giữa chừng cướp keystroke
- Muốn 1 timer tập trung thay vì N setTimeout rải rác khó trace
- Guard: coalesceMs ≈ 33ms, editor-defer chỉ khi detect keystroke, flush xóa pending
