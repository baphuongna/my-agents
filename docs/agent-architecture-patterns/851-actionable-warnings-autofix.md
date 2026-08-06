# Hướng AFS: Actionable-Warnings Autofix — turn_end ghi `actionable-warnings.json` delta-only theo dòng touched; mỗi warning có id `aw:hash` ổn định để suppression persist; autofix conservative chỉ apply edit-kind action, cap 5 fixes/agent_end, skip stale actions

> **Nguồn gốc:** pi-lens (docs/features.md) | **Coupling:** 🟡 — hook turn_end + autofix vào loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có audit RuntimeEvent + repair tool, thiếu actionable-warnings delta) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-lens** ở **turn_end** ghi `actionable-warnings.json` **delta-only** — chỉ warning liên quan **dòng touched** trong turn (không toàn workspace). Mỗi warning có **id `aw:<hash>`** ổn định (hash nội dung) để **suppression persist** (agent/user ẩn warning, ẩn mãi vì id không đổi). **Autofix conservative**: chỉ tự apply action loại **edit** (không chạy command), **cap 5 fixes/agent_end** (không bão), **skip stale actions** (action cũ không còn hợp lệ). Nguyên tắc: **warning có hành động cụ thể + autofix thận trọng + suppression bền vững**.

## Mô tả

mya actionable-warnings: (1) **turn_end hook đã sẵn** — `packages/core` loop.ts có checkIdleOnTurnStart/hook tại turn boundary; (2) **delta-only** — chỉ dòng touched (theo edit log) → cần track touched lines; (3) **aw:hash id** — hash nội dung warning ổn định; (4) **suppression persist** — `packages/audit` hoặc store ghi warning bị ẩn; (5) **autofix** — `packages/tools` repair.ts đã có repair tool, thêm conservative autofix (edit-only, cap 5, skip stale); (6) **RuntimeEvent** — `packages/audit` đã có kind "repair". Nối AFQ (lens warnings).

## Kiến trúc (ASCII)

```
  TURN END ──▶ collect warnings (delta-only: dòng touched)
   │
   ▼  mỗi warning:
  { id: "aw:<hash>", file, line, message, action: {kind:"edit", ...} }
   │                            id ổn định → suppression persist
   │
   ├─ ghi actionable-warnings.json (delta-only)
   │
   └─ AUTOFIX (conservative):
        ├─ chỉ action kind="edit" (không command)
        ├─ cap 5 fixes / agent_end
        ├─ skip stale action (file đã đổi, line không còn hợp lệ)
        └─ apply edit → repair
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/audit index.ts — RuntimeEvent kind "repair" + audit pipeline
// ✅ packages/tools repair.ts — repair tool (nền autofix)
// ✅ packages/core loop.ts — turn boundary hook (checkIdleOnTurnStart pattern)
// ✅ packages/tools hashline-edit.ts — track touched lines (delta source)

// ❌ THIẾU: actionable-warnings.json delta-only (dòng touched)
// ❌ THIẾU: aw:<hash> stable id + suppression persist
// ❌ THIẾU: conservative autofix (edit-only, cap 5, skip stale)
```

## Implementation

```typescript
// packages/tools/src/actionable-warnings.ts (MỚI)
import { createHash } from "node:crypto";
export type WarningAction = { kind: "edit"; file: string; range: [number, number]; replacement: string } | { kind: "command"; cmd: string };
export interface ActionableWarning {
  readonly id: string;            // aw:<hash>
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly action: WarningAction;
}
const AUTOFIX_CAP = 5;
function awHash(w: Omit<ActionableWarning, "id">): string {
  return "aw:" + createHash("sha256").update(`${w.file}:${w.line}:${w.message}`).digest("hex").slice(0, 12);
}
/** Tạo warning với id ổn định (suppression persist). */
export function makeWarning(w: Omit<ActionableWarning, "id">): ActionableWarning {
  return { ...w, id: awHash(w) };
}
/** Autofix conservative: chỉ edit, cap 5, skip stale. */
export function conservativeAutofix(
  warnings: ActionableWarning[],
  isStale: (a: Extract<WarningAction, { kind: "edit" }>) => boolean,
): Extract<WarningAction, { kind: "edit" }>[] {
  const edits = warnings
    .filter((w): w is ActionableWarning & { action: Extract<WarningAction, { kind: "edit" }> } => w.action.kind === "edit")
    .filter((w) => !isStale(w.action));   // skip stale
  return edits.slice(0, AUTOFIX_CAP);       // cap 5
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Warning có hành động cụ thể → agent biết sửa sao | ❌ Autofix conservative có thể bỏ qua fix tốt (command) |
| ✅ Delta-only — không noise toàn workspace | ❌ Hash collision lý thuyết (id trùng) |
| ✅ aw:hash ổn định → suppression bền vững | ❌ Cap 5 có thể không đủ khi nhiều warning |
| ✅ Autofix an toàn (edit-only, skip stale) | ❌ Cần stale-detection chính xác |

## Khác các hướng gần

| | AFS Actionable-Warnings | repair tool | audit recovery |
|---|---|---|---|
| Trigger | turn_end delta | Agent gọi | RuntimeEvent error |
| Autofix | Conservative edit-only | Agent quyết định | Recovery strategy |
| Suppress | aw:hash persist | không | không |

## Khi nào chọn

- Muốn agent nhận warning kèm cách sửa cụ thể (action)
- Cần autofix an toàn (edit-only) với giới hạn (cap 5)
- Cần suppression bền vững (ẩn warning mãi mãi)
- Guard: aw:hash ổn định, stale-detection trước apply, cap, delta-only theo touched lines
