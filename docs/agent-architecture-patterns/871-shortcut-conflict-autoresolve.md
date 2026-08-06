# Hướng AGM: Shortcut Conflict Autoresolve — validate shortcut, tự tìm replacement khi trùng reserved thay vì im lặng đè

> **Nguồn gốc:** pi-powerline-footer | **Coupling:** 🟢 — config/keybinding layer thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (mya có command-registry nhưng KHÔNG có conflict autoresolve) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-powerline-footer** validate shortcut config khi load: tập **reserved** được gom từ `APP_RESERVED` (phím hệ thống) + `TUI_KEYBINDINGS` (đã bind sẵn). Khi shortcut người dùng cấu hình **trùng** reserved, thay vì im lặng đè (silent override — khiến phím cũ mất tác dụng mà user không hay), hệ thống **tự tìm replacement** từ danh sách default khác (chọn phím gần, chưa dùng). Kết quả: không phím nào bị "nuốt" âm thầm; conflict được báo + giải quyết.

Nguyên tắc: **không bao giờ silent override keybinding**; **reserved set gộp từ nhiều nguồn** (app + tui); **tự pick replacement an toàn** (chưa dùng, gần default); **báo conflict** cho user biết.

## Mô tả

Với mya, packages/print có `command-registry.ts` (đăng ký command) và `cli-flags.ts`, nhưng **chưa có** layer validate shortcut với: (1) **reserved set gộp** từ nhiều nguồn, (2) **phát hiện trùng** khi load config, (3) **autoresolve replacement** từ default list chưa dùng. Pattern này quan trọng khi extension (pi-powerline-footer, pi-status, pi-sub...) thêm keybinding mới — cần đảm bảo không đè phím cốt lõi của shell mà không báo.

## Kiến trúc (ASCII)

```
  USER CONFIG (shortcuts.json)
        │
        ▼
  validateShortcut(cfg)
        │  reserved = APP_RESERVED ∪ TUI_KEYBINDINGS
        ▼
  ┌─ trùng reserved? ─┐
  │ NO                │ YES → pickReplacement(defaults, used)
  ▼                   │       → chọn phím chưa dùng gần default
  apply(cfg)          ▼
                  apply(remapped) + warn("X trùng → đổi sang Y")
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/command-registry.ts — đăng ký command (test: command-registry.test.ts)
// ✅ packages/print/src/cli-flags.ts — parse flag/keybinding
// ❌ KHÔNG có reserved set gộp (APP_RESERVED ∪ TUI_KEYBINDINGS)
// ❌ KHÔNG có conflict detection + autoresolve replacement khi load config
```

## Implementation

```typescript
// packages/print/src/shortcut-resolver.ts (NEW)
export interface ShortcutConfig { [action: string]: string; }   // action → key

const APP_RESERVED = new Set(["ctrl+c", "ctrl+d", "ctrl+l", "ctrl+z", "enter", "esc"]);
const TUI_DEFAULTS: Record<string, string[]> = {                // action → fallback keys
  "toggle-panel": ["ctrl+p", "alt+p", "f2"],
  "cycle-agent": ["ctrl+tab", "alt+a"],
};

export function resolveShortcuts(user: ShortcutConfig): ShortcutConfig {
  const used = new Set<string>(APP_RESERVED);
  const resolved: ShortcutConfig = {};
  const warns: string[] = [];

  for (const [action, key] of Object.entries(user)) {
    const norm = key.toLowerCase();
    if (used.has(norm)) {
      const alt = (TUI_DEFAULTS[action] ?? []).find((k) => !used.has(k));
      if (!alt) { warns.push(`unresolvable conflict: ${action} (${key})`); continue; }
      warns.push(`shortcut conflict: ${action} ${key} → ${alt}`);
      resolved[action] = alt; used.add(alt);                    // pick replacement an toàn
    } else {
      resolved[action] = norm; used.add(norm);
    }
  }
  if (warns.length) console.warn("[shortcuts] " + warns.join("; "));
  return resolved;
}
// Load config → resolveShortcuts(cfg) → apply; không bao giờ silent override.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không phím nào bị nuốt âm thầm | ❌ Replacement auto có thể không hợp gu user |
| ✅ Reserved set gộp nhiều nguồn (app + tui) | ❌ Default list phải đầy đủ, không thì unresolvable |
| ✅ Báo conflict rõ ràng (warn) | ❌ Validate mỗi load → cần cache nếu config lớn |

## Khác các hướng gần

| | AGM Conflict Autoresolve | AGN Settings Write-Target | AGT Config Env-Precedence |
|---|---|---|---|
| Trọng tâm | Giải trùng keybinding | Chọn nơi ghi settings | Thứ tự ưu tiên config |
| Cơ chế | Reserved set + replacement | Global/project write-target | File > theme, env override |
| Quan hệ | Nối keybinding layer | Nối settings persistence | Nối config precedence |

## Khi nào chọn

- Extension thêm keybinding mới — cần đảm bảo không đè phím cốt lõi
- User config shortcut có thể trùng reserved/app binding
- Muốn conflict được báo rõ chứ không silent override
- Guard: reserved gộp app + tui, replacement phải chưa dùng, warn mọi remap
