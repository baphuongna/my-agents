# Hướng AHX: Graceful-Turn-Limit-Wrapup — agent nhận cảnh báo "wrap up" trước khi bị hard abort để tạo kết quả partial sạch; status-note phân biệt `stopped` (human abort) với `aborted` (turn limit) để parent không nhầm output partial với completed

> **Nguồn gốc:** pi-subagent3 | **Coupling:** 🟡 — turn lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có abort + iteration-budget; chưa có wrap-up warning + stopped/aborted distinction) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagent3** agent nhận **cảnh báo "wrap up"** trước khi bị hard abort để tạo kết quả partial sạch thay vì output bị cắt giữa chừng; **status-note phân biệt `stopped` (human abort) với `aborted` (turn limit)** để parent không nhầm output partial với completed. Nguyên tắc: **graceful degradation** — trước hard kill, cho agent cơ hội summarize partial; **two-phase abort** — soft warning (wrap up) → hard abort; **status distinction** — `stopped` (human ý định) ≠ `aborted` (budget cạn) ≠ `completed` (done) — parent xử lý khác nhau.

## Mô tả

Với mya, pattern = **graceful turn-limit wrapup + status distinction**: (1) mya đã có **iteration-budget** (packages/core) + **abort** (packages/agent killSubagent) — đúng budget + kill; (2) AHX thêm **wrap-up warning** — khi turn còn N bước trước limit → inject "wrap up: summarize partial now"; (3) **two-phase**: soft warning (cho agent 1-2 bước summarize) → hard abort; (4) **status-note** — subagent status: `completed` (done) | `stopped` (human abort) | `aborted` (turn limit) — hiện mya có `done`/`aborted` (killSubagent → aborted); (5) parent check status-note → biết output partial hay completed.

## Kiến trúc (ASCII)

```
  AGENT chạy (iteration-budget đếm)
    │
    ├─ còn K bước trước limit?
    │    └─ K ≤ WRAPUP_THRESHOLD ──► inject "WRAP UP: summarize partial now"
    │                                  │
    │                                  ▼ agent có 1-2 bước tạo partial sạch
    │
    ├─ hard abort (limit reached)
    │    └─ status = "aborted" (turn limit) + note partial output
    │
    └─ human abort (killSubagent)
         └─ status = "stopped" (human ý định)
  PARENT check status-note:
    completed → dùng output đầy đủ
    aborted   → output PARTIAL (turn limit) — flag, không nhầm completed
    stopped   → output PARTIAL (human abort) — khác ý định
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core iteration-budget.ts — turn/iteration budget (đếm bước)
// ✅ packages/agent — killSubagent → status "aborted" (hard abort đã có)
// ✅ packages/agent — sub.status: "running"|"done"|"aborted" (nền status)
// ✅ packages/core loop.ts — loop control (nền wrap-up inject point)
// ✅ packages/core time.ts — nowWallclock (budget timing)

// ❌ THIẾU: wrap-up warning (soft trước hard)
// ❌ THIẾU: "stopped" vs "aborted" distinction (hiện chỉ aborted)
// ❌ THIẾU: partial output flag cho parent
```

## Implementation

```typescript
// packages/core/src/turn-limit-wrapup.ts (NEW)
export type TurnStatus = "completed" | "stopped" | "aborted";

export interface WrapUpState {
  iterationsLeft: number;
  wrapupThreshold: number; // vd 3 — cảnh báo khi còn ≤3 bước
}

/** Inject wrap-up warning khi gần limit — agent có cơ hội summarize partial. */
export function maybeWrapUpWarning(
  s: WrapUpState, inject: (msg: string) => void,
): boolean {
  if (s.iterationsLeft > 0 && s.iterationsLeft <= s.wrapupThreshold) {
    inject(
      `⚠️ Còn ${s.iterationsLeft} bước trước turn limit. ` +
      `WRAP UP NGAY: summarize kết quả partial, ghi artifact nếu cần. ` +
      `Sau đây sẽ bị hard abort.`,
    );
    return true; // đã warning
  }
  return false;
}

/** Phân biệt status — parent không nhầm partial với completed. */
export function classifyTurnStatus(
  done: boolean, humanAbort: boolean, limitReached: boolean,
): TurnStatus {
  if (done) return "completed";
  if (humanAbort) return "stopped";     // human ý định
  if (limitReached) return "aborted";   // budget cạn
  return "aborted";
}
// loop.ts: trước mỗi iteration → maybeWrapUpWarning; killSubagent(human) → stopped;
// limitReached → aborted. Parent: if status !== "completed" → output là PARTIAL.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Partial output sạch (wrap-up cơ hội summarize) | ❌ Wrap-up tốn 1-2 bước budget thêm |
| ✅ Status distinction — parent xử lý đúng | ❌ 3 status phức tạp hơn 2 |
| ✅ Graceful degradation thay vì cắt giữa chừng | ❌ Wrap-up warning có thể bị agent bỏ qua |
| ✅ Nối iteration-budget + abort sẵn | ❌ Threshold phải calibrate theo task |

## Khác các hướng gần

| | AHX Graceful-Turn-Limit-Wrapup | AHR Stale-Run-Reconciler | AHS Completion-Dedupe-Key |
|---|---|---|---|
| Trọng tâm | Wrap-up trước abort + status | Sửa orphan run | Dedupe notify |
| Cơ chế | Soft warning + status distinction | PID-liveness + grace | id: + tuple key |
| Quan hệ | Khi kết thúc (lifecycle) | Sau kết thúc (cleanup) | Khi notify kết thúc |

## Khi nào chọn

- Subagent có thể hết budget mid-work → cần partial sạch
- Parent cần phân biệt completed vs partial (stopped/aborted)
- Muốn graceful degradation (wrap-up) thay vì hard cut
- Guard: wrap-up threshold calibrate, status enum rõ (completed/stopped/aborted), parent flag partial, agent tôn trọng warning
