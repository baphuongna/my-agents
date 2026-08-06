# Hướng AEM: Inline Data Escaping — payload JSON escape `<>&` rồi nhúng vào template HTML, chống XSS

> **Nguồn gốc:** pi-diff-review | **Coupling:** 🟢 — lớp render, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn thực hành escape trong web/desktop; thiếu helper chuẩn) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-diff-review** (src/ui.ts): payload JSON được **escape `<>&`** rồi nhúng trực tiếp vào template HTML (đặt tại `__INLINE_DATA__`) cùng **app.js inline** — mục đích **tránh XSS khi truyền dữ liệu review vào native window**. Vì dữ liệu review (diff text, comment, file path) là **content từ bên ngoài** (git, repo của user, có thể chứa HTML/script), nhúng thẳng vào HTML qua placeholder mà không escape sẽ mở lỗ hổng: kẻ tạo file có tên `"><script>...` hoặc nội dung diff chứa markup độc hại sẽ thực thi trong window.

Pattern = **defense-in-depth cho native window**: (1) JSON stringify payload; (2) escape `<`, `>`, `&` (đủ để chống phá vỡ tag/entity); (3) nhúng tại marker `__INLINE_DATA__`; (4) app.js đọc marker, `JSON.parse` lại — vì `<>&` đã escape nên không thể thoát khỏi script context. Quan trọng: escape **đúng chiều** — đủ để an toàn trong HTML script block, nhưng không phá dữ liệu (JSON.parse phục hồi nguyên vẹn sau khi browser decode entity).

## Mô tả

Với mya, pattern = **inline data injection helper** cho desktop/web UI (review window AEI hoặc web dashboard): (1) **escapeInline** — `escapeHtml` tối thiểu `<>&` (đúng thứ cần cho script-context safety); (2) **embed** — sinh template `const __INLINE_DATA__ = "…escaped…";` hoặc `<script id="__INLINE_DATA__" type="application/json">…</script>`; (3) **decode** — app.js đọc + `JSON.parse`; (4) **scan trước khi embed** — nối `prompts/inject.ts` scan (payload từ repo là untrusted — chạy qua injection scanner) + `core/threat-scan.ts` (đã có invisible unicode strip + NFKC — dùng chung). Lưu ý mya web: `packages/web` dùng React (đã escape mặc định khi render text) — pattern này cần cho **nhúng JSON vào HTML template** (window tĩnh, SSR, hay placeholder), không phải cho React JSX. Đây là pattern **boundary hygiene**: dữ liệu lạ không bao giờ nhúng thô.

## Kiến trúc (ASCII)

```
  PAYLOAD (diff, comments, paths — untrusted từ repo)
    │
    ▼ SCAN (prompts/inject.ts + core/threat-scan — block injection)
    ▼ JSON.stringify
    ▼ ESCAPE < > &  (chống phá vỡ tag/entity trong HTML)
    │
    ▼ EMBED vào template HTML
  <script>const __INLINE_DATA__ = "…escaped json…";</script>
  + app.js inline đọc marker
    │
    ▼ browser decode entity + JSON.parse → payload nguyên vẹn
  (kẻ tạo file "<script>" chỉ thành chuỗi text — không thực thi)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/threat-scan.ts — invisible unicode strip + NFKC
//   (dùng chung cho payload trước khi embed)
// ✅ packages/prompts/src/inject.ts — scan injection (context untrusted)
// ✅ packages/web — React (escape mặc định khi render text — khác path)
// ✅ packages/desktop — IPC contract (payload qua bridge đã validate)
// ✅ packages/rpc — framing (message boundary)

// ❌ THIẾU: helper escapeInline chuẩn (`<>&`) cho inline JSON
// ❌ THIẾU: embed marker + decode helper dùng chung web/desktop
// ❌ THIẾU: quy tắc "mọi payload lạ qua scan trước khi embed"
```

## Implementation

```typescript
// packages/print/src/inline-data.ts (NEW)
/** Escape tối thiểu cho inline JSON trong HTML script context. */
export function escapeInline(json: string): string {
  return json
    .replace(/&/g, "&amp;")   // phải trước — tránh double-escape
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Sinh template HTML với payload nhúng an toàn. */
export function embedInlineData(payload: unknown, marker = "__INLINE_DATA__"): string {
  const json = JSON.stringify(payload);
  const safe = escapeInline(json);               // `<>&` không phá vỡ context
  return [
    `<script id="${marker}" type="application/json">`,
    safe,
    `</script>`,
  ].join("");
}

/** Đọc lại payload từ marker (browser side — decode entity + parse). */
export function readInlineData(marker = "__INLINE_DATA__"): unknown {
  const el = document.getElementById(marker);
  if (!el?.textContent) return null;
  const decoded = el.textContent
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  return JSON.parse(decoded);   // phục hồi nguyên vẹn
}
// Quy tắc: payload từ repo → scan (inject.ts/threat-scan) → escapeInline → embed
// React path (packages/web JSX) không cần — escape mặc định; chỉ cần cho template
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống XSS khi nhúng dữ liệu lạ vào window | ❌ Escape thủ công dễ sót chiều (cần test) |
| ✅ Payload nguyên vẹn sau roundtrip (JSON.parse) | ❌ `<>&` chỉ an toàn script-context — không phải HTML attribute |
| ✅ Đã có threat-scan + inject — thêm bước embed | ❌ Nếu dùng sai chỗ (nhúng vào innerHTML) vẫn lỗ |
| ✅ Helper nhỏ — áp được web + desktop | ❌ Double-escape nếu escape nhiều lần (thứ tự phải chuẩn) |

## Khác các hướng gần

| | AEM Inline Escaping | AFC Memory Scanner | ADQ Rewrite Registry |
|---|---|---|---|
| Trọng tâm | Chống XSS khi embed | Chống memory poisoning | Quyết định rewrite |
| Cơ chế | escape `<>&` + JSON roundtrip | Pattern block + secret scan | 3 đường quyết định |
| Quan hệ | Lớp render (AEI) | Lớp lưu trữ (khác miền) | Khác miền (output) |

## Khi nào chọn

- Window/UI nhúng JSON payload từ nguồn không tin cậy (repo, git)
- Template HTML có placeholder dữ liệu (không phải React JSX path)
- Đã có threat-scan/inject — thêm bước escape trước embed
- Muốn defense-in-depth: scan + escape + parse lại nguyên vẹn