# Hướng AEP: Workflow Abort Cancellation — Esc hủy workflow, AbortSignal lan tới mọi subagent session

> **Nguồn gốc:** pi-dynamic-workflows | **Coupling:** 🟡 — đụng runner + session lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn signal → worker.terminate; thiếu lan tới subagent + skipped state) | **Effort:** 1 tuần

## Nguồn gốc

**pi-dynamic-workflows** (src/workflow-tool.ts): **Esc hủy workflow**: (1) tín hiệu **AbortSignal** lan tới **mọi subagent session** qua `session.abort()`; (2) agent đang chạy bị **đánh dấu skipped**; (3) kết quả trả về **compact** (không dump toàn bộ output dở dang). Mục tiêu: hủy là **hành động có cấu trúc** — không chỉ kill tiến trình, mà (a) thông báo cho từng subagent đang chạy (chúng tự dừng sạch), (b) view biết trạng thái "skipped" (nối AEN progress view), (c) kết quả gọn gàng cho agent gọi workflow biết chuyện gì xảy ra.

Failure mode chống: Esc chỉ terminate tiến trình cha → subagent tiếp tục chạy ngầm (leak session), hoặc kết quả abort là raw error dump khiến caller không biết đã hủy có chủ đích.

## Mô tả

Với mya, pattern = **abort propagation chain** trong workflow execution: (1) **AbortSignal** từ nguồn (Esc, timeout, parent abort) — mya đã có nền: `runner.ts` `runWorkflowIsolated` nhận `opts.signal` → `worker.terminate()`, và `core/loop.ts` có `signal.addEventListener("abort", …)` trong agent loop; (2) **lan tới subagent** — `agent()` primitive spawn subagent qua `packages/agent` (spawn handle có lifecycle status) — thêm `session.abort()` khi signal fire; (3) **skipped state** — phase đang chạy / task đang chạy được đánh dấu skipped (nối AEN ProgressView.markDone(seq, "skipped")); (4) **compact result** — abort trả `{ status: "aborted", skippedTasks: N, partial?: … }` — không dump output; (5) **timeout là abort** — `runWorkflowIsolated` đã có timeout terminate — gom chung cơ chế. Đây là pattern **structured cancellation**: hủy là một kết quả hợp lệ, không phải lỗi.

## Kiến trúc (ASCII)

```
  ESC / TIMEOUT / PARENT ABORT
    │
    ▼ AbortSignal (runner.ts — đã có signal → worker.terminate)
    ├─► worker.terminate() — kill body async (đã có)
    ├─► session.abort() lan tới MỌI subagent (packages/agent spawn handle)
    │     subagent tự dừng sạch — không chạy ngầm
    ├─► markDone(seq, "skipped") cho phase/task đang chạy (AEN)
    └─► trả kết quả COMPACT: { status:"aborted", skippedTasks:N }
          (không dump output dở dang — caller hiểu ngay)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows/src/runner.ts — runWorkflowIsolated: signal → worker.terminate()
// ✅ packages/core/src/loop.ts — signal.addEventListener("abort") trong agent loop
// ✅ packages/agent/src/index.ts — spawn subagent + lifecycle status
// ✅ packages/audit/src/recovery.ts — RecoveryRecipe FSM (bounded recovery)
// ✅ packages/core/src/types.ts — ToolHookSink preTool/postTool (hook điểm hủy)

// ❌ THIẾU: session.abort() API trên subagent handle (spawn → abort)
// ❌ THIẾU: lan signal từ workflow xuống từng agent()/parallel()/pipeline() (AEO)
// ❌ THIẾU: skipped state + compact result contract
```

## Implementation

```typescript
// packages/workflows/src/abort.ts (NEW)
export interface AbortResult {
  status: "aborted";
  skippedTasks: number;
  partial?: unknown;      // compact — không dump output dở dang
}

/** Lan AbortSignal tới mọi subagent session đang chạy. */
export function wireAbort(
  signal: AbortSignal,
  sessions: Array<{ abort(): Promise<void> }>,   // spawn handles (packages/agent)
  progress: ProgressView,                        // nối AEN
): void {
  if (signal.aborted) return;
  signal.addEventListener(
    "abort",
    () => {
      // 1) thông báo từng subagent — chúng tự dừng sạch
      void Promise.all(sessions.map((s) => s.abort()));
      // 2) đánh dấu skipped các phase đang chạy (AEN)
      progress.markAllRunning("skipped");
    },
    { once: true },
  );
}

/** Timeout = abort (gom chung cơ chế với Esc). */
export function withAbortTimeout(
  fn: () => Promise<unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AbortResult | unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: "aborted", skippedTasks: 0 }), timeoutMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve({ status: "aborted", skippedTasks: 0 });
    }, { once: true });
    fn().then((v) => { clearTimeout(timer); resolve(v); }, reject);
  });
}
// AEO primitives nhận signal: parallel/pipeline thunk truyền signal xuống
// Kết quả compact: { status:"aborted", skippedTasks } — caller xử lý như kết quả hợp lệ
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hủy có cấu trúc — subagent dừng sạch, không leak | ❌ Subagent có thể không đáp ứng abort (cần timeout fallback) |
| ✅ Kết quả compact — caller biết ngay "đã hủy" | ❌ Lan signal qua nhiều lớp — khó theo dõi thứ tự dừng |
| ✅ Timeout gom chung cơ chế abort | ❌ Mark skipped sai nếu abort giữa phase — view lệch |
| ✅ Đã có signal nền (loop + worker.terminate) | ❌ Partial result cần policy rõ (giữ gì, bỏ gì) |

## Khác các hướng gần

| | AEP Workflow Abort | AEN Runtime Phases | AEV Verification Gates |
|---|---|---|---|
| Trọng tâm | Hủy workflow có cấu trúc | Progress view | Chặn tiến khi gate fail |
| Cơ chế | AbortSignal lan + skipped | Event → view model | Gate check + execSync |
| Quan hệ | Đánh dấu phase skipped (AEN) | Tiêu thụ event | Chặn trước khi chạy |

## Khi nào chọn

- Workflow chạy dài / nhiều subagent — user cần hủy sạch
- Đã có signal nền (runner + loop) — thêm session.abort + compact result
- Muốn abort là kết quả hợp lệ, không phải error dump
- Cần view hiển thị đúng "skipped" khi hủy (nối AEN)