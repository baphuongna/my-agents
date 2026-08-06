# Hướng AFL: Reattach Overlay Handoff — session backgrounded mở lại bằng ReattachOverlay (exit countdown, dialog transfer/background/kill, handoff snapshot); người dùng không mất phiên khi chuyển foreground↔background

> **Nguồn gốc:** pi-interactive-shell (reattach-overlay.ts) | **Coupling:** 🟡 — cần overlay UI + session state persist | **Agent-agnostic:** ⚠️ (overlay TUI gắn runtime) | **Code sẵn:** ⚠️ (có session-list/compose overlay + broker session, thiếu ReattachOverlay handoff) | **Effort:** 2 tuần

## Nguồn gốc

**pi-interactive-shell** `ReattachOverlay` cho người dùng **mở lại session đã background**: khi quay lại foreground, overlay hiện **exit countdown** (session sắp chết?), **dialog transfer/background/kill** (chọn hành động), và **handoff snapshot** (transfer context từ session cũ sang mới). Người dùng không mất phiên khi chuyển foreground↔background — có thể tiếp tục đúng chỗ. Nguyên tắc: **session là tài nguyên có thể tạm gác và phục hồi**, handoff tường minh giữ continuity.

## Mô tả

mya reattach-overlay: (1) **overlay đã sẵn** — `packages/intercom` có `session-list` overlay (listSessions + chọn session) và `compose` overlay (gửi message); (2) **broker session state** — `packages/intercom/broker` quản lý session (client/extension-state/runtime-claim/spawn); (3) **ReattachOverlay mới** — kết hợp list + countdown + action dialog (transfer/background/kill); (4) **handoff snapshot** — `packages/core` session-branch (Branch/Delegate) nền cho transfer context; (5) **sessionStartMode** — fork/keep/clean phân biệt cách resume (nối AFT session-rehydrate). UI qua `packages/intercom/ui`.

## Kiến trúc (ASCII)

```
  USER rời session ──▶ BACKGROUND (session sống nhưng ẩn)
                          │
  USER quay lại ──────────┤
                          ▼
              ┌──────────────────────────┐
              │ ReattachOverlay           │
              │  ├─ exit countdown ⏱️      │ session sắp hết hạn?
              │  ├─ listSessions (session-list)│
              │  └─ DIALOG action:         │
              │     • transfer (handoff)   │
              │     • background (giấu lại)│
              │     • kill (hủy)           │
              └─────────┬────────────────┘
                        ▼  chọn transfer
              HANDOFF SNAPSHOT (stable tier + ctxFiles)
                        ▼
              NEW SESSION kế thừa context ──▶ tiếp tục đúng chỗ
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom/ui session-list.ts — listSessions + chọn session (overlay)
// ✅ packages/intercom/ui compose.ts — compose overlay gửi message
// ✅ packages/intercom/broker client.ts/extension-state.ts/runtime-claim.ts — session state
// ✅ packages/intercom intercom.ts — session overlay { overlay:true }
// ✅ packages/core session-branch.ts — Branch/Delegate transfer context (nền handoff)

// ❌ THIẾU: ReattachOverlay (exit countdown + action dialog)
// ❌ THIẾU: handoff snapshot (transfer stable tier + ctxFiles sang session mới)
// ❌ THIẾU: sessionStartMode fork/keep/clean cho reattach
```

## Implementation

```typescript
// packages/intercom/src/reattach-overlay.ts (MỚI)
import type { Session } from "@my-agent/core";
export type ReattachAction = "transfer" | "background" | "kill";
export interface HandoffSnapshot {
  stableTier: Session["stableTier"];
  ctxFiles: string[];
  summary: string;
}
/** Tạo snapshot để transfer context sang session mới. */
export function buildHandoff(from: Session): HandoffSnapshot {
  return { stableTier: from.stableTier, ctxFiles: [...from.ctxFiles], summary: "" };
}
/** Áp dụng snapshot vào session đích (resume context). */
export function applyHandoff(target: Session, snap: HandoffSnapshot): void {
  target.stableTier = snap.stableTier;
  target.ctxFiles = [...snap.ctxFiles];
}
/** Quyết định exit countdown cảnh báo dựa trên TTL còn lại. */
export function exitCountdown(expiresAt: number, now: number): { seconds: number; urgent: boolean } {
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  return { seconds, urgent: seconds < 60 };
}
// ReattachOverlay component: list sessions → countdown → dialog →
//   transfer: buildHandoff(old) → createSession → applyHandoff(new)
//   background: ẩn lại (giữ sống)    kill: abort + remove
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Người dùng không mất phiên khi chuyển bg↔fg | ❌ Overlay TUI phức tạp (countdown + dialog) |
| ✅ Handoff snapshot giữ continuity | ❌ Snapshot có thể stale nếu session cũ vẫn chạy |
| ✅ 3 action rõ ràng (transfer/background/kill) | ❌ Transfer context tốn memory nếu nhiều session |

## Khác các hướng gần

| | AFL Reattach Overlay | ACE Side Thread | AFT Session-Rehydrate |
|---|---|---|---|
| Mục đích | Mở lại session background | Tạo thread suy nghĩ song song | Phục hồi state sau restart |
| Cơ chế | Overlay + handoff snapshot | Side session + inject | Disk persist + sessionStartMode |
| Kế thừa | Transfer snapshot | aside/new/tangent | Rehydrate từ disk |

## Khi nào chọn

- Agent chạy nhiều session nền, người dùng cần quay lại đúng chỗ
- Muốn transfer context giữa session (old → new) an toàn
- Cần cảnh báo TTL sắp hết (exit countdown)
- Guard: handoff snapshot nhất quán, action dialog tường minh, kill dọn sạch tài nguyên
