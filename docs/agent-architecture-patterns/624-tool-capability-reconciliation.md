# Hướng WZ: Tool Capability Reconciliation — hook before_agent_start strip/restore tool khỏi active set theo ctx.hasUI (idempotent) cho chạy headless/RPC

> **Nguồn gốc:** rpiv-mono (capability reconciliation hook); "before_agent_start strip/restore tool by ctx.hasUI", "idempotent", "headless/RPC run" | **Coupling:** 🟡 — thêm lifecycle hook vào agent start | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tool dispatch + builtin sẵn — chưa có hasUI strip/restore hook) | **Effort:** 1-2 tuần

## Nguồn gốc

**rpiv-mono** có tool cần **UI** (approval dialog, interactive question, TUI render) không chạy được trong **headless/RPC** (no terminal, server mode). Giải: **hook `before_agent_start` reconciliation** — trước mỗi turn agent, đọc `ctx.hasUI`: nếu **không có UI** → **strip** tool UI-only khỏi active set (agent không thấy, không gọi); nếu **có UI** → **restore** (đưa lại). Thao tác **idempotent** (chạy nhiều lần cùng kết quả — strip rồi strip lại không lỗi, restore rồi restore không double). Nguyên tắc: **active tool set khớp capability runtime** — không expose tool agent không thể dùng (gây lỗi khi gọi).

## Mô tả

mya tool capability reconciliation: hook trước agent start, theo `ctx.hasUI` strip/restore tool UI-only vào active set. Idempotent (re-run an toàn). Chạy headless/RPC → UI tool bị strip; chạy interactive → restore. mya có tool dispatch + builtin — WZ thêm **before_agent_start hook** + **hasUI strip/restore** + **idempotent reconcile**.

## Kiến trúc

```
  ┌─── before_agent_start hook (mỗi turn) ───────────────┐
  │  read ctx.hasUI                                         │
  │  ┌─ hasUI = false (headless/RPC) ──────────────────┐  │
  │  │  strip: activeSet = activeSet - uiOnlyTools        │  │  ← gỡ tool UI
  │  │  saved = uiOnlyTools (để restore sau)              │  │
  │  └────────────────────────────────────────────────────┘ │
  │  ┌─ hasUI = true (interactive) ─────────────────────┐  │
  │  │  restore: activeSet = activeSet ∪ saved            │  │  ← trả lại tool UI
  │  └────────────────────────────────────────────────────┘ │
  │  (idempotent: strip rồi strip = không đổi; restore rồi restore = không đổi)
  └───────────────────────┬───────────────────────────────┘
                          ▼
  ACTIVE TOOL SET (khớp capability runtime)
  → agent chỉ thấy tool có thể gọi (UI tool chỉ khi có UI)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools dispatch.ts — tool dispatch (nền — WZ active set ở đây)
// ✅ packages/tools builtin.ts — builtin tool (nền — WZ tag uiOnly)
// ✅ packages/tools approval.ts — approval tool (nền — WZ UI-only ví dụ)

// ❌ THIẾU: before_agent_start hook (lifecycle point)
// ❌ THIẾU: hasUI strip/restore (capability reconcile)
// ❌ THIẾU: idempotent guard (re-run an toàn)
```

## Implementation

```typescript
// packages/agent/src/tool-reconcile.ts (MỚI)
interface Tool { name: string; requiresUI?: boolean }
interface Ctx { hasUI: boolean }

class ToolReconciler {
  private active: Set<string>;
  private stripped: Set<string>; // UI tool đã gỡ (để restore)
  constructor(private tools: Map<string, Tool>, initial: string[]) {
    this.active = new Set(initial);
    this.stripped = new Set();
  }

  // idempotent: strip/restore theo hasUI
  reconcile(ctx: Ctx): void {
    if (!ctx.hasUI) {
      // strip UI-only tool khỏi active, lưu vào stripped
      for (const [name, t] of this.tools) {
        if (t.requiresUI && this.active.has(name)) {
          this.active.delete(name);
          this.stripped.add(name); // idempotent: add vào set (không double)
        }
      }
    } else {
      // restore: trả tool đã strip về active
      for (const name of this.stripped) this.active.add(name);
      this.stripped.clear(); // idempotent: clear (re-run không double-add)
    }
  }

  list(): string[] { return [...this.active]; }
}

// Usage:
// const rec = new ToolReconciler(toolMap, allToolNames);
// hook.before_agent_start = () => rec.reconcile({ hasUI: ctx.hasUI });
// rec.reconcile({ hasUI: false }); // strip UI tool (headless)
// rec.reconcile({ hasUI: false }); // idempotent (không đổi)
// rec.reconcile({ hasUI: true });  // restore
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Active set khớp capability (không expose tool không dùng được) | ❌ Hook overhead (reconcile mỗi turn) |
| ✅ Idempotent (re-run an toàn, không lỗi/double) | ❌ requiresUI metadata (phải tag tool) |
| ✅ Headless-safe (UI tool strip khi no-UI) | ❌ Restore ambiguity (restore tool nào đã add tay?) |
| ✅ Tự động (hook, không cần config mỗi mode) | ❌ Late-discovery (tool thêm runtime không tag) |

## Khác các hướng gần

| | Static tool set | Per-mode config | WZ: Reconcile-Hook |
|---|---|---|---|
| Adapt runtime | ❌ | Manual | **✅ hasUI tự động** |
| Idempotent | n/a | ❌ | **✅ strip/restore re-run** |
| Hook-driven | ❌ | ❌ | **✅ before_agent_start** |

## Khi nào chọn

- Có tool UI-only (approval/question/TUI) cần strip khi chạy headless/RPC
- Muốn active tool set khớp capability runtime (không expose tool gây lỗi)
- Nối packages/tools dispatch.ts + builtin.ts + approval.ts; guard requiresUI-tag-completeness (mọi UI tool phải tag), idempotent-test (reconcile 2× = 1×), và runtime-tool-late (tool add sau reconcile → reconcile lại trước turn kế); WZ = tool capability reconciliation, kết hợp 625 XA structured-questionnaire-tool (UI-only question tool cần strip headless) + packages/rpc (RPC = no UI context)
