# Hướng AKS: Pairing Theme Basics — bộ theme theo cặp sáng/tối (neapple/neapple-light, onedark-pro/onedark-pro-light, e-ink/e-ink-dark) cùng semantic vars cho cả light và dark mode, một bộ token ngữ nghĩa render được cả hai nền

> **Nguồn gốc:** pi-themes-worktree (themes/neapple.json, themes/neapple-light.json) | **Coupling:** 🟢 — data convention, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có pkg themes + print; thiếu pairing convention) | **Effort:** 1 tuần

## Nguồn gốc

**pi-themes-worktree** có **bộ theme theo cặp sáng/tối**: (1) **cặp theme** — `neapple` / `neapple-light`, `onedark-pro` / `onedark-pro-light`, `e-ink` / `e-ink-dark` — mỗi theme tối có bản sáng tương ứng cùng tên; (2) **cùng semantic vars cho cả light và dark mode** — cả hai dùng chung một bộ token ngữ nghĩa (background, foreground, accent, border, syntax…) — chỉ giá trị màu khác; (3) **một bộ token ngữ nghĩa render được cả hai nền** — UI code không đổi khi đổi dark/light — chỉ đổi theme file (cùng tên token, giá trị khác); (4) **đủ cặp cho mọi style** — e-ink (đen trắng), gruvbox-light, monokai-pro, noctis-lux, solarized-osaka, tokyo-dark…

Giá trị: (1) **UI không đổi theo mode** — semantic vars ổn định, chỉ giá trị đổi; (2) **chuyển mode rẻ** — đổi theme file cùng cặp là xong; (3) **nhất quán** — dark và light cùng bộ token, không lệch cấu trúc; (4) **test dễ** — render theo token, không phụ thuộc mode.

## Mô tả

Với mya, pattern = **light/dark theme pairing**: (1) **semantic token set** — một bộ token cố định: `background`, `foreground`, `accent`, `border`, `selection`, `syntax.keyword`, `syntax.string`… — mọi theme (dark lẫn light) đều khai báo đủ cùng token names (nối AKR — schema pin); (2) **pairing convention** — theme tối `X` đi với `X-light` (hoặc `X-dark` cho bản tối) — cùng `$schema`, cùng token names, khác giá trị; (3) **mode switch** — user đổi dark/light → chọn theme trong cặp (metadata `dark: true/false` — nối AKR) — UI render cùng token, không đổi code; (4) **contrast check** — validator đo contrast (background vs foreground) cho cả 2 bản — bảo đảm đọc được cả hai nền; (5) nơi gắn — `packages/pkg` (themes — pairing metadata), `packages/print` (render theo token). Đây là pattern **semantic-token stability**: UI phụ thuộc token name, không phụ thuộc mode — mode chỉ là chọn bộ giá trị.

## Kiến trúc (ASCII)

```
  SEMANTIC TOKEN SET (cố định — mọi theme khai báo đủ)
  ├─ background · foreground · accent · border · selection
  └─ syntax.keyword · syntax.string · syntax.comment · error · success
    │
    ▼ CẶP SÁNG/TỐI (cùng token names — khác giá trị)
  ├─ neapple.json       (dark: true)   background: #1c1c1e  foreground: #e4e4e7
  ├─ neapple-light.json (dark: false)  background: #fafafa  foreground: #1c1c1e
  ├─ onedark-pro.json / onedark-pro-light.json
  └─ e-ink.json / e-ink-dark.json
    │
    ▼ MODE SWITCH — đổi theme trong cặp (UI code KHÔNG đổi)
    ▼ CONTRAST CHECK — validator đo background vs foreground cả 2 bản
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg/src/index.ts — PackageKind "themes" (nơi thêm pairing metadata)
// ✅ packages/print/src/mya-bridge.ts — UI render (nơi dùng semantic tokens)
// ✅ packages/core/src/canonical-json.ts — canonical JSON (nền — parse theme)
// ✅ packages/eval/src/harness.ts — harness (nơi chạy contrast check như test)

// ❌ THIẾU: semantic token set chuẩn (cùng names cho cả light/dark)
// ❌ THIẾU: pairing convention (X ↔ X-light/X-dark — metadata dark flag)
// ❌ THIẾU: contrast validator (đo background/foreground cả 2 bản)
```

## Implementation

```typescript
// packages/pkg/src/theme-pair.ts (NEW)
export interface SemanticTheme {
  name: string;
  dark: boolean;
  colors: Record<string, string>;      // CÙNG token names cho cả light và dark
}

export interface ThemePair {
  base: SemanticTheme;                 // bản chính
  partner: SemanticTheme;              // bản sáng/tối tương ứng — cùng tên
}

/** Pairing convention — tìm bạn đời của theme theo quy ước tên. */
export function findPartner(
  theme: SemanticTheme,
  all: SemanticTheme[],
): SemanticTheme | null {
  const names = theme.dark
    ? [`${theme.name}-light`, `${theme.name}-light`]          // neapple → neapple-light
    : [theme.name.replace(/-light$/, ""), `${theme.name.replace(/-light$/, "")}-dark`];
  return all.find((t) => t.name === names[0] || t.name === names[1]) ?? null;
}

/** Cùng token names — dark và light phải khai báo đủ cùng semantic vars. */
export function assertSameTokens(a: SemanticTheme, b: SemanticTheme): string[] {
  const aKeys = new Set(Object.keys(a.colors));
  const bKeys = new Set(Object.keys(b.colors));
  const missingInB = [...aKeys].filter((k) => !bKeys.has(k));
  const missingInA = [...bKeys].filter((k) => !aKeys.has(k));
  return [...missingInA.map((k) => `"${k}" thiếu trong ${a.name}`), ...missingInB.map((k) => `"${k}" thiếu trong ${b.name}`)];
}

/** Contrast check — background vs foreground phải đủ tương phản (WCAG-ish). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Validate cặp — cùng token names + contrast đạt ngưỡng cho cả hai. */
export function validatePair(pair: ThemePair, minContrast = 4.5): { ok: boolean; reasons: string[] } {
  const reasons = assertSameTokens(pair.base, pair.partner);
  for (const t of [pair.base, pair.partner]) {
    const ratio = contrastRatio(t.colors.background ?? "#000000", t.colors.foreground ?? "#ffffff");
    if (ratio < minContrast) reasons.push(`${t.name}: contrast ${ratio.toFixed(2)} < ${minContrast}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Mode switch — đổi theme trong cặp, UI render cùng token names. */
export function switchMode(current: SemanticTheme, pair: ThemePair): SemanticTheme {
  return current.dark === pair.base.dark ? pair.partner : pair.base;
}
// Nối AKR: theme file có $schema + dark metadata — pairing là convention trên schema
// Nối print: render theo token names — switchMode đổi theme, UI code không đổi
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ UI không đổi theo mode — semantic vars ổn định | ❌ Mỗi theme phải làm 2 bản — tốn công gấp đôi |
| ✅ Chuyển mode rẻ — đổi file cùng cặp | ❌ Tên cặp lệch quy ước (không -light/-dark) — không tìm được partner |
| ✅ Nhất quán — cùng token names, không lệch cấu trúc | ❌ Contrast đo hex — màu alpha/var() không đo được |
| ✅ Contrast kiểm được — cả 2 bản đọc được | ❌ Token set thêm token — 2 bản đều phải cập nhật |

## Khác các hướng gần

| | AKS Theme Pairing | AKR Theme Schema | 416 Ontology Packs |
|---|---|---|---|
| Trọng tâm | Cặp sáng/tối cùng token | Schema pin theme | Packs semantic data |
| Cơ chế | Naming convention + contrast | $schema + validator | Packs type/verbs |
| Quan hệ | Convention trên nền AKR | Nền cho AKS | Khác miền (KG) |

## Khi nào chọn

- UI cần cả light và dark — muốn một bộ token render cả hai
- Nhiều theme — pairing convention giữ nhất quán (tên, token, contrast)
- Muốn đổi mode không đụng code (chỉ đổi theme file)
- Guard: cùng token names, dark flag metadata, contrast ≥ ngưỡng, tìm partner theo quy ước tên