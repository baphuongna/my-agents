# Hướng AIM: Semantic-Color-Vars — theme định nghĩa bộ biến ngữ nghĩa chuẩn (accent, accentBright, warmMix, toolPendingBg, toolSuccessBg, toolErrorBg, customMsgBg...) mà Pi dùng để render toàn bộ UI — một file JSON đổi toàn bộ giao diện TUI mà không đụng code

> **Nguồn gốc:** pi-themes | **Coupling:** 🟢 — theming data | **Agent-agnostic:** ❌ (TUI-specific) | **Code sẵn:** ❌ (chưa có theme color var system) | **Effort:** 1 tuần

## Nguồn gốc

**pi-themes** theme định nghĩa **bộ biến ngữ nghĩa chuẩn** (accent, accentBright, warmMix, toolPendingBg, toolSuccessBg, toolErrorBg, customMsgBg...) mà Pi dùng để render **toàn bộ UI** — **một file JSON đổi toàn bộ giao diện TUI mà không đụng code**. Nguyên tắc: **semantic naming** — biến theo *ý nghĩa* (toolSuccessBg) không phải *giá trị* (#00ff00); **single source** — một JSON theme → toàn bộ UI render; **code-agnostic** — đổi theme = đổi data, không rebuild; **complete palette** — đủ biến cho mọi UI element.

## Mô tả

Với mya, pattern = **semantic color variable system**: (1) mya chưa có theme color var system (packages/desktop có IPC, natives/print có TUI rendering, nhưng chưa có theme data layer); (2) AIM thêm **standard semantic palette**: `{ accent, accentBright, warmMix, bg, fg, toolPendingBg, toolSuccessBg, toolErrorBg, customMsgBg, ... }`; (3) **theme JSON** — data thuần, load runtime; (4) **render layer** — natives/print resolve var → ANSI color; (5) đổi theme = swap JSON, không đụng code; (6) nối pkg (themes là 1 trong 4 extension kinds).

## Kiến trúc (ASCII)

```
  THEME JSON (data thuần — semantic vars)
    {
      "accent": "#7aa2f7",
      "accentBright": "#a9b1d6",
      "toolPendingBg": "#1a1b26",
      "toolSuccessBg": "#9ece6a",
      "toolErrorBg": "#f7768e",
      "customMsgBg": "#e0af68",
      ...
    }
         │
         ▼ LOAD (runtime — không rebuild)
    RENDER LAYER (natives/print)
      resolve var → ANSI color → ink <Text color={theme.toolSuccessBg}>
         │
         ▼
  ĐỔI THEME = SWAP JSON (không đụng code — toàn bộ UI đổi)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg index.ts — themes là 1 trong 4 extension kinds (PackageKind)
//   (theme = data package — nền)
// ✅ packages/desktop — IPC (theme config truyền renderer)
// ✅ packages/print pi-main.ts — extensions + themes load (nền)
// ✅ natives/print — ink/TUI rendering (render target)

// ❌ THIẾU: standard semantic palette (accent/toolSuccessBg/...)
// ❌ THIẾU: theme JSON load + var → ANSI resolve
// ❌ THIẾU: render layer dùng theme var (hiện hardcoded color?)
```

## Implementation

```typescript
// packages/print/src/theme.ts (NEW)
import { readFileSync } from "node:fs";

/** Standard semantic palette — đầy đủ cho toàn bộ UI. */
export interface SemanticTheme {
  accent: string; accentBright: string; warmMix: string;
  bg: string; fg: string; muted: string;
  toolPendingBg: string; toolSuccessBg: string; toolErrorBg: string;
  customMsgBg: string;
  // ... mở rộng khi thêm UI element
}

/** Load theme JSON — data thuần, runtime swap. */
export function loadTheme(path: string): SemanticTheme {
  return JSON.parse(readFileSync(path, "utf8")) as SemanticTheme;
}

/** Default theme — fallback khi thiếu. */
export const DEFAULT_THEME: SemanticTheme = {
  accent: "#7aa2f7", accentBright: "#a9b1d6", warmMix: "#e0af68",
  bg: "#1a1b26", fg: "#c0caf5", muted: "#565f89",
  toolPendingBg: "#24283b", toolSuccessBg: "#9ece6a", toolErrorBg: "#f7768e",
  customMsgBg: "#e0af68",
};
// ink component: <Text backgroundColor={theme.toolSuccessBg}>✓</Text>
// /theme <name> → loadTheme(pkg/theme.json) → re-render toàn bộ UI (không rebuild).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đổi theme = đổi data (không rebuild) | ❌ TUI-specific (không agent-agnostic) |
| ✅ Semantic naming — ý nghĩa rõ (toolSuccessBg) | ❌ Palette phải complete (thiếu var = broken UI) |
| ✅ User custom theme (JSON thuần) | ❌ Var → ANSI resolve cần terminal support |
| ✅ Nối pkg themes kind sẵn | ❌ Tốt nhất cursor màu 256/truecolor |

## Khác các hướng gần

| | AIM Semantic-Color-Vars | AIN Theme-Discovery-Manifest | AIO Worktree-Theme-Dev |
|---|---|---|---|
| Trọng tâm | Biến ngữ nghĩa render UI | Discover theme package | Phát triển theme trong worktree |
| Cơ chế | Standard palette + JSON load | pi.themes manifest + override | Git worktree branch |
| Quan hệ | Render layer (dùng theme) | Discovery (tìm theme) | Dev workflow (tạo theme) |

## Khi nào chọn

- Muốn user đổi toàn bộ TUI qua 1 file JSON (không rebuild)
- Cần semantic naming (ý nghĩa, không giá trị thô)
- Theme = data thuần tách code
- Guard: palette complete, default fallback, var→ANSI resolve, truecolor terminal, validate JSON
