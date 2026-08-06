# Hướng AGX: Live Preview Settings UI — settings panel render live preview title với spinner animation thật, toggle/reorder component bằng Ctrl+Up/Down rồi persist — WYSIWYG config

> **Nguồn gốc:** pi-status | **Coupling:** 🔴 — bind vào TUI interactive panel | **Agent-agnostic:** ⚠️ (cần status component) | **Code sẵn:** ❌ (mya KHÔNG có interactive settings panel với live preview) | **Effort:** 1 tuần

## Nguồn gốc

**pi-status** có settings panel **WYSIWYG**: render **live preview** title với **spinner animation thật** (interval rebuild — vẽ lại mỗi tick để spinner quay), cho phép **toggle** (bật/tắt component) và **reorder** (Ctrl+Up/Down di chuyển component trong list) **trực tiếp trên UI**, rồi **persist** config. Triết lý WYSIWYG: **thấy ngay kết quả** khi chỉnh (preview thật, không mock), **chỉnh bằng phím** (toggle/reorder), **lưu cuối cùng** — user không phải tưởng tượng config sẽ ra sao.

Nguyên tắc: **live preview thật** (animation chạy, không screenshot tĩnh); **edit trực tiếp UI** (toggle/reorder bằng phím); **persist cuối** (save khi thoát); **WYSIWYG** (what you see = what you get).

## Mô tả

Với mya, packages/print có `agents-panel.ts` (panel agent) và TUI ink, nhưng **chưa có** interactive **settings panel** với: (1) **live preview** (spinner animation thật qua interval rebuild), (2) **toggle/reorder** component bằng phím, (3) **persist** config. Pattern này nâng UX config — user thấy ngay thay đổi thay vì edit JSON mù.

## Kiến trúc (ASCII)

```
  ┌─ Settings Panel (WYSIWYG) ──────────────────┐
  │ [x] spinner  ⣾  (LIVE preview: spinner quay)│  ← interval rebuild mỗi tick
  │ [x] model    gpt-4                          │
  │ [ ] tokens   1.2k/8k                        │  ← toggle [x]/[ ]
  │  ↑↓ Ctrl+Up/Down reorder                    │  ← edit trực tiếp
  └─────────────────────────────────────────────┘
        │ user chỉnh (toggle/reorder)
        ▼
  preview rebuild ngay (interval) → thấy kết quả
        │ persist (thoát panel)
        ▼
  config.json đã lưu (thứ tự + enabled y hệt preview)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/agents-panel.ts — panel rendering TUI (ink)
// ✅ packages/print/src/cli.ts — config read
// ❌ KHÔNG có interactive settings panel (toggle/reorder bằng phím)
// ❌ KHÔNG có live preview với animation thật (interval rebuild spinner)
```

## Implementation

```typescript
// packages/print/src/settings-panel.ts (NEW)
export interface PanelItem { id: string; enabled: boolean; render(): string; }

export class SettingsPanel {
  private items: PanelItem[];
  private cursor = 0;
  private timer?: NodeJS.Timeout;
  private dirty = false;

  constructor(
    items: PanelItem[],
    private readonly onChange: () => void,      // trigger re-render (ink)
    private readonly persist: (items: PanelItem[]) => void,
  ) { this.items = items; }

  open(): void {
    // interval rebuild → spinner trong preview quay THẬT (WYSIWYG)
    this.timer = setInterval(() => this.onChange(), 100);
  }

  toggle(): void { this.items[this.cursor]!.enabled = !this.items[this.cursor]!.enabled; this.dirty = true; this.onChange(); }

  move(delta: number): void {        // Ctrl+Up/Down reorder
    const j = this.cursor + delta;
    if (j < 0 || j >= this.items.length) return;
    [this.items[this.cursor], this.items[j]] = [this.items[j], this.items[this.cursor]];
    this.cursor = j; this.dirty = true; this.onChange();
  }

  render(): string {
    return this.items.map((it, i) => {
      const mark = i === this.cursor ? "▶" : " ";
      const en = it.enabled ? "[x]" : "[ ]";
      return `${mark} ${en} ${it.enabled ? it.render() : it.id}`;
    }).join("\n");
  }

  close(): void {                    // persist khi thoát
    clearInterval(this.timer); this.timer = undefined;
    if (this.dirty) this.persist(this.items);   // lưu thứ tự + enabled y hệt preview
  }
}
// ink: panel.render() mỗi onChange(); keymap toggle/move/close.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ WYSIWYG — thấy ngay kết quả chỉnh | ❌ Interval rebuild tốn CPU khi mở panel |
| ✅ Edit trực tiếp UI (toggle/reorder phím) | ❌ Phải persist đúng (dirty flag) tránh ghi thừa |
| ✅ Spinner preview thật (không mock tĩnh) | ❌ Coupling TUI ink (🔴) cho tính năng UI |

## Khác các hướng gần

| | AGX Live-Preview UI | AGU Configurable Statusbar | AGV Idle Reassert |
|---|---|---|---|
| Trọng tâm | Preview thật khi chỉnh config | Ordered component list | Thắng race async override |
| Cơ chế | Interval rebuild + keymap edit | id+enabled upgrade append | Exponential backoff |
| Quan hệ | Nối settings UX | Nối statusbar widget | Nối title lifecycle |

## Khi nào chọn

- Config phức tạp (thứ tự + toggle) — user cần thấy ngay kết quả
- Muốn edit trực tiếp UI (phím) thay vì edit JSON mù
- Cần WYSIWYG (preview thật, animation chạy)
- Guard: interval rebuild khi mở, dirty flag persist, spinner preview thật
