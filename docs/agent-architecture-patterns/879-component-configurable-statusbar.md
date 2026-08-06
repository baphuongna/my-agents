# Hướng AGU: Component-Configurable Statusbar — status bar = ordered component list (spinner/model/tokens/git_branch...) với enabled flag; upgrade append component mới disabled để không vỡ config cũ

> **Nguồn gốc:** pi-status | **Coupling:** 🟢 — UI component layer | **Agent-agnostic:** ⚠️ (một số component dính model/tokens) | **Code sẵn:** ❌ (mya có agents-panel/status rendering, nhưng KHÔNG có ordered component list + upgrade-safe append) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-status** render status bar từ một **ordered component list** — mỗi component (spinner, model, tokens, git_branch, cwd, latency...) có `enabled` flag và **thứ tự do user định nghĩa**. Khi **upgrade** thêm component mới, hệ thống **tự append component mới `disabled` ở cuối** config cũ — giữ nguyên thứ tự người dùng đã set, không ghi đè, không vỡ. Merge upgrade-safe: config cũ vẫn dùng được, component mới xuất hiện nhưng tắt cho đến khi user bật.

Nguyên tắc: **component là plugin có thứ tự** (user sort); **enabled flag** (bật/tắt từng cái); **upgrade append disabled** (không phá config cũ); **giữ thứ tự user** (không reorder ngầm).

## Mô tả

Với mya, packages/print có `agents-panel.ts` (panel agent) và status rendering trong TUI, nhưng **chưa có** status bar dạng **ordered component list configurable**: (1) danh sách component có thứ tự user, (2) `enabled` flag, (3) **upgrade-safe append** component mới disabled. Pattern này quan trọng khi phát triển thêm status widget mới — cần không phá config người dùng đã tinh chỉnh thứ tự.

## Kiến trúc (ASCII)

```
  config (user): [{id:spinner,enabled:true},{id:model,enabled:true},{id:tokens,enabled:false}]
        │
        ▼
  upgrade: component mới "git_branch" chưa có
        │  → append {id:git_branch, enabled:false} CUỐI danh sách
        ▼
  render: duyệt theo thứ tự, chỉ vẽ enabled=true
  ── config cũ giữ nguyên thứ tự; component mới có sẵn nhưng tắt
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/agents-panel.ts — panel rendering trong TUI
// ✅ packages/print/src/main.ts / index.ts — status line rendering
// ❌ KHÔNG có ordered component list configurable (id + enabled + order)
// ❌ KHÔNG có upgrade-safe append (component mới disabled cuối danh sách)
```

## Implementation

```typescript
// packages/print/src/statusbar-components.ts (NEW)
export interface StatusComponent { id: string; enabled: boolean; render(): string; }

const REGISTRY = new Map<string, () => StatusComponent>();   // id → factory

export function registerStatusComponent(id: string, factory: () => StatusComponent): void {
  REGISTRY.set(id, factory);
}

/** Merge upgrade-safe: giữ thứ tự user, append component mới disabled cuối. */
export function reconcileComponents(userOrder: Array<{ id: string; enabled: boolean }>): StatusComponent[] {
  const seen = new Set(userOrder.map((c) => c.id));
  const appended: Array<{ id: string; enabled: boolean }> = [];
  for (const id of REGISTRY.keys()) {
    if (!seen.has(id)) appended.push({ id, enabled: false });   // component mới → disabled
  }
  const merged = [...userOrder, ...appended];
  return merged
    .filter((c) => REGISTRY.has(c.id))
    .map((c) => ({ ...REGISTRY.get(c.id)!(), enabled: c.enabled }))
    .filter((c) => c.enabled);                                  // chỉ render enabled
}

// Đăng ký: registerStatusComponent("spinner", () => new SpinnerComp());
// render: reconcileComponents(userConfig).forEach(c => line += c.render());
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Upgrade không vỡ config cũ (append disabled) | ❌ Component disabled vẫn chiếm slot config |
| ✅ User sort thứ tự tự do | ❌ Registry + reconcile cần duy trì id map |
| ✅ Bật/tắt từng component (enabled) | ❌ Component phụ thuộc nhau cần dependency check |

## Khác các hướng gần

| | AGU Configurable Statusbar | AGX Live-Preview UI | AHE Threshold-Color |
|---|---|---|---|
| Trọng tâm | Ordered component list | Preview setting thật | Màu progress theo ngưỡng |
| Cơ chế | id+enabled, upgrade append | Interval rebuild | pct → color segment |
| Quan hệ | Nối statusbar widget | Nối settings UI | Nối progress visual |

## Khi nào chọn

- Status bar có nhiều widget (spinner/model/tokens/git) — cần sort + bật/tắt
- Phát triển thêm widget mới mà không phá config người dùng
- Muốn upgrade-safe (component mới disabled cuối, user tự bật)
- Guard: giữ thứ tự user, append disabled, chỉ render enabled=true
