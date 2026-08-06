# Hướng AFT: Session-State Rehydrate — widget/diagnostic state persist theo stable session id (`ctx.sessionManager.getSessionId()`) ra disk; `sessionStartMode` phân biệt fork/keep/clean/maybe-rehydrate để resume hoặc launch lại session cũ vẫn phục hồi findings

> **Nguồn gốc:** pi-lens (clients/session-state-store.ts) | **Coupling:** 🟡 — cần stable session id + disk persist | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có session-branch + brain persist, thiếu widget/diagnostic rehydrate) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-lens** persist **widget/diagnostic state** theo **stable session id** (`ctx.sessionManager.getSessionId()` — id không đổi qua restart) ra disk. Khi launch lại, **`sessionStartMode`** quyết định cách resume: **fork** (nhánh mới từ state cũ), **keep** (giữ nguyên state cũ), **clean** (bỏ state cũ, bắt đầu mới), **maybe-rehydrate** (rehydrate nếu có, không thì clean). Nhờ đó resume hoặc launch lại session cũ vẫn **phục hồi findings** (diagnostic đã tính, widget state). Nguyên tắc: **state bám stable session id, mode quyết định resume policy**.

## Mô tả

mya session-state-rehydrate: (1) **stable session id** — cần session id ổn định qua restart (core session.ts có id, nhưng cần ensure stable); (2) **disk persist** — `packages/memory` brain-store/brain-sqlite-store đã có persist pattern; (3) **sessionStartMode** — fork/keep/clean/maybe-rehydrate; (4) **rehydrate logic** — đọc state theo id, apply theo mode; (5) **findings** — diagnostic/widget state cần phục hồi. Nối AFL (reattach handoff, sessionStartMode đồng dạng).

## Kiến trúc (ASCII)

```
  SESSION (stable id = getSessionId(), không đổi qua restart)
   │
   ▼  persist widget/diagnostic state ra disk theo id
  disk: <sessionId>.state.json { findings, widgetState, diagnostics }

  ── RESTART / RELAUNCH ──
   │
   ▼  sessionStartMode quyết định:
   ├─ fork          ─▶ nhánh mới từ state cũ (copy + continue)
   ├─ keep          ─▶ giữ nguyên state cũ (resume đầy đủ)
   ├─ clean         ─▶ bỏ state cũ (bắt đầu mới)
   └─ maybe-rehydrate ─▶ rehydrate nếu có, không thì clean
   │
   ▼  findings/widget phục hồi theo mode
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — Session.id (cần ensure stable qua restart)
// ✅ packages/core session-branch.ts — Branch/Delegate (nền fork mode)
// ✅ packages/memory brain-store.ts/brain-sqlite-store.ts — disk persist pattern
// ✅ packages/memory lifecycle.ts — memory lifecycle (nền state lifecycle)

// ❌ THIẾU: stable session id qua restart (getSessionId)
// ❌ THIẾU: widget/diagnostic state persist theo id
// ❌ THIẾU: sessionStartMode fork/keep/clean/maybe-rehydrate
```

## Implementation

```typescript
// packages/core/src/session-state-rehydrate.ts (MỚI)
export type SessionStartMode = "fork" | "keep" | "clean" | "maybe-rehydrate";
export interface PersistedState {
  readonly sessionId: string;
  findings: unknown[];      // diagnostic findings
  widgetState: Record<string, unknown>;
}
/** Quyết định mode khi launch: maybe-rehydrate ưu tiên rehydrate nếu state tồn tại. */
export function resolveMode(existing: PersistedState | null, requested: SessionStartMode): SessionStartMode {
  if (requested === "maybe-rehydrate") return existing ? "keep" : "clean";
  return requested;
}
/** Apply persisted state theo mode — fork copy, keep giữ, clean bỏ. */
export function rehydrate(
  existing: PersistedState | null,
  mode: SessionStartMode,
  fresh: () => PersistedState,
): PersistedState {
  switch (mode) {
    case "clean": return fresh();
    case "keep": case "maybe-rehydrate": return existing ?? fresh();
    case "fork": return existing ? { ...existing, findings: [...existing.findings] } : fresh();
  }
}
// Caller (turn start): 
//   const state = loadFromDisk(getStableSessionId());
//   const applied = rehydrate(state, resolveMode(state, requestedMode), freshState);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Resume không mất findings (đã tính) | ❌ Stable session id phải đảm bảo qua restart |
| ✅ 4 mode linh hoạt (fork/keep/clean/maybe) | ❌ State stale nếu code đổi (findings cũ không còn đúng) |
| ✅ Tiết kiệm recomputation | ❌ Disk I/O + quản lý state cũ (gc) |

## Khác các hướng gần

| | AFT Session-Rehydrate | AFL Reattach Overlay | memory brain-store |
|---|---|---|---|
| State | Widget/diagnostic | Session transcript | Memory facts |
| Persist | Theo stable session id | Handoff snapshot | Brain sqlite/jsonl |
| Mode | fork/keep/clean/maybe | transfer/bg/kill | capture/retrieve |

## Khi nào chọn

- Widget/diagnostic state đắt tính, muốn phục hồi sau restart
- Cần stable session id bền vững
- Muốn chọn resume policy (fork/keep/clean)
- Guard: stable id đảm bảo, stale detection (code đổi → findings cũ bỏ), gc state cũ
