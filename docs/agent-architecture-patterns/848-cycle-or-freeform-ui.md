# Hướng AFP: Cycle-or-Freeform UI — SettingsList component có 2 chế độ nhập: nếu setting có `values` thì Enter/Space cycle qua danh sách, nếu không có thì mở Input free-form string — một component UI phục vụ cả enum lẫn text

> **Nguồn gốc:** pi-extension-settings (src/components/settings-list.ts) | **Coupling:** 🟢 — component UI thuần, không phụ thuộc agent runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có intercom/ui overlay + config, thiếu SettingsList dual-mode) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extension-settings** `SettingsList` là **một component phục vụ hai chế độ** dựa trên khai báo setting: nếu setting có trường `values` (enum) thì phím **Enter/Space cycle** qua danh sách giá trị (không cần gõ); nếu không có `values` thì mở **Input free-form** để gõ string tùy ý. Thiết kế tinh tế: **một UI**, hành vi thay đổi theo data — enum dùng cycle (nhanh, không sai chính tả), text free dùng input. Nguyên tắc: **UI thích ứng theo schema**, tránh 2 component riêng biệt.

## Mô tả

mya cycle-or-freeform: (1) **overlay UI đã sẵn** — `packages/intercom/ui` có compose (input), inline-message, session-list (list + chọn); (2) **config đã sẵn** — `packages/intercom` config.ts có typed config; (3) **SettingsList mới** — list setting, mỗi item kiểm tra có `values` không → cycle hoặc input; (4) **cycle behavior** — Enter/Space tăng index wrap-around trong `values`; (5) **freeform behavior** — mở compose-like input nhận string. Một component, dual-mode theo schema.

## Kiến trúc (ASCII)

```
  SettingsList (một component)
   │  hiển thị danh sách setting
   │
   item có `values` (enum)?
   ├─ CÓ  ──▶ Enter/Space = CYCLE
   │         values = ["on","off","auto"]
   │         index 0→1→2→0 (wrap)   ◀── nhanh, không sai chính tả
   │
   └─ KHÔNG ──▶ Enter = mở INPUT free-form
              gõ string tùy ý       ◀── linh hoạt, text tự do

   một UI, hành vi theo schema → đơn giản hóa, nhất quán
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom/ui compose.ts — Input overlay (freeform string)
// ✅ packages/intercom/ui session-list.ts — list + chọn (cycle nền)
// ✅ packages/intercom/ui inline-message.ts — inline display
// ✅ packages/intercom config.ts — typed config (schema settings)

// ❌ THIẾU: SettingsList dual-mode (cycle enum vs freeform input)
// ❌ THIẾU: cycle index wrap-around + Enter/Space keybind
```

## Implementation

```typescript
// packages/intercom/src/ui/settings-list.ts (MỚI)
export interface SettingItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly values?: string[];   // có → enum (cycle); không → freeform
}
/** Quyết định mode theo schema: enum (cycle) hoặc freeform (input). */
export function isEnum(item: SettingItem): item is SettingItem & { values: string[] } {
  return Array.isArray(item.values) && item.values.length > 0;
}
/** Cycle giá trị enum — Enter/Space; wrap-around. */
export function cycleValue(item: SettingItem & { values: string[] }, current: string): string {
  const idx = item.values.indexOf(current);
  const next = (idx + 1) % item.values.length;   // wrap-around
  return item.values[next]!;
}
/** Xử lý phím: Enter/Space → cycle (enum) hoặc open input (freeform). */
export function handleKey(
  item: SettingItem,
  key: "Enter" | "Space",
  onCycle: (next: string) => void,
  onFreeform: () => void,
): void {
  if (key !== "Enter" && key !== "Space") return;
  if (isEnum(item)) onCycle(cycleValue(item, item.value));
  else onFreeform();   // mở Input overlay freeform
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một component cho cả enum lẫn text — đơn giản | ❌ Discovery kém: user không biết setting có enum hay không |
| ✅ Cycle enum nhanh, không sai chính tả | ❌ Cycle dài (nhiều values) → mệt, cần search |
| ✅ Schema-driven — thêm setting không đổi UI | ❌ Freeform không validate type (cần guard) |

## Khác các hướng gần

| | AFP Cycle-or-Freeform | compose Input | session-list |
|---|---|---|---|
| Mục đích | Edit setting (enum+text) | Nhập freeform string | Chọn session |
| Mode | Dual theo schema | Chỉ freeform | Chỉ chọn |

## Khi nào chọn

- Setting có cả enum lẫn text free trong cùng một danh sách
- Muốn UI nhất quán (một component) thay vì tách enum/text
- Ưu tiên tốc độ cho enum (cycle), linh hoạt cho text (input)
- Guard: validate freeform theo type, cycle wrap-around, hiển thị mode hiện tại rõ
