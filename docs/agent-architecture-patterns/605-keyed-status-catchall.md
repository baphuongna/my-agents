# Hướng WG: Keyed Status Catchall — key "*" làm fallback render; ignore regex loại nhiễu đã biết

> **Nguồn gốc:** pi-bar `keyed status config` (key "*" fallback, ignore-regex noise filter); "key * as catchall fallback", "ignore regex to filter known noise", "status key map → render rule" | **Coupling:** 🟢 — thêm keyed status map + catchall vào bar/TUI renderer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (TUI render sẵn — chưa có keyed status map + ignore-regex + catchall) | **Effort:** 1 tuần

## Nguồn gốc

**pi-bar** render status theo **key map** — mỗi status key (vd `running`, `idle`, `error`) ánh xạ tới 1 render rule (icon, color, label). Đặc biệt: (1) **Key `"*"`** làm **catchall** — bất kỳ status nào không có key riêng → rơi vào `*` (default render, không crash). (2) **Ignore regex** — danh sách regex lọc **nhiễu đã biết** (vd status debug spam `^debug:`, internal heartbeat `^ping$`) → match ignore → **không render** (skip). Nguyên tắc: **keyed match + catchall safety + noise filter** — status có key thì render theo key, không có thì fallback `*`, nhiễu thì bỏ qua.

## Mô tả

mya keyed status catchall: (1) **Status map**: `Record<string, RenderRule>` — key → rule (icon/color/label). (2) **Catchall `*`**: key `*` luôn có → fallback cho status không match. (3) **Ignore list**: danh sách regex → status match → skip (không render). (4) **Lookup order**: ignore check trước → nếu match ignore → skip; else key lookup → có key dùng key, không có dùng `*`. mya có TUI render — WG thêm **keyed status map** + **catchall fallback** + **ignore-regex noise filter**.

## Kiến trúc

```
  STATUS VALUE đến renderer
        │
        ▼
  ┌─── 1. IGNORE-REGEX CHECK ─────────────────────────┐
  │  ignoreList = [/^debug:/, /^ping$/, /^internal/]    │
  │  value = "debug: cache hit"                          │
  │  → match /^debug:/ → SKIP (không render) ✅          │
  │  value = "running" → không match ignore → tiếp       │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── 2. KEY LOOKUP (keyed map) ──────────────────────┐
  │  statusMap = {                                       │
  │    "running": { icon: "●", color: "green" },         │
  │    "error":   { icon: "✖", color: "red" },           │
  │    "*":       { icon: "○", color: "gray" },  ← CATCHALL│
  │  }                                                   │
  │  value = "running" → key "running" MATCH → green ●   │
  │  value = "syncing" → key "syncing" MISS → "*" → gray ○│
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── RENDER ─────────────────────────────────────────┐
  │  catchall: [○ syncing]  (gray — không crash, fallback)│
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tui — terminal UI render (nền — WG status render ở đây)
// ✅ packages/print — output formatting (nền — WG icon/label)
// ✅ packages/core telemetry.ts — status values (nền — WG status source)

// ❌ THIẾU: keyed status map (key → render rule)
// ❌ THIẾU: catchall key "*" (fallback — không crash)
// ❌ THIẾU: ignore-regex noise filter (skip known noise)
```

## Implementation

```typescript
// packages/tui/src/keyed-status-catchall.ts (MỚI)
interface RenderRule { icon: string; color: string; label?: string }

interface StatusRendererConfig {
  map: Record<string, RenderRule>; // key → rule ("*" bắt buộc)
  ignoreRegex: RegExp[];           // noise filter → skip render
}

function renderStatus(config: StatusRendererConfig, value: string): RenderRule | null {
  // 1. ignore-regex check — skip known noise
  if (config.ignoreRegex.some(re => re.test(value))) return null;

  // 2. key lookup — exact key first, "*" catchall fallback
  return config.map[value] ?? config.map["*"];
}

// Usage:
// const config: StatusRendererConfig = {
//   map: {
//     running: { icon: "●", color: "green" },
//     error: { icon: "✖", color: "red" },
//     "*": { icon: "○", color: "gray" }, // catchall — bắt buộc
//   },
//   ignoreRegex: [/^debug:/, /^ping$/],
// };
// const rule = renderStatus(config, "syncing"); // → catchall { icon:"○", color:"gray" }
// const rule2 = renderStatus(config, "debug: cache hit"); // → null (ignored)
```

## Được

- ✅ Catchall safety (status lạ không crash — fallback `*`)
- ✅ Noise filter (nhiễu đã biết skip — không spam UI)
- ✅ Keyed clarity (status → rule trực tiếp, dễ debug)
- ✅ Extensible (thêm key mới chỉ cần thêm map entry)

## Mất

- ❌ Catchall ambiguity (status lạ rơi `*` — có thể che bug)
- ❌ Ignore false-positive (ignore regex quá rộng → status hợp lệ bị skip)
- ❌ Map maintenance (status mới → phải thêm key, quên → catchall)
- ❌ Key exact-match only (status gần giống nhưng khác key → miss)

## Khác

Khác **WF ordered-state-matching** (ordered rule list, first-match-wins, regex+threshold) — WG là **keyed map** (exact key lookup + `*` catchall, đơn giản hơn). Khác **static render** (1 rule cho tất cả) — WG **keyed + catchall** (status → rule riêng, lạ → fallback). Khác **filter-only** (chỉ ignore) — WG **ignore + render** (lọc nhiễu rồi render cái còn lại).

## Khi nào chọn

- Status dạng enum/discrete (running/idle/error) → keyed map trực quan
- Muốn safety (status lạ không crash — catchall `*`)
- Có nhiễu đã biết cần filter (debug/ping/internal — skip)
- Nối packages/tui + packages/print + packages/core telemetry.ts; guard catchall-required (`*` bắt buộc — test thiếu `*` → error), ignore-regex-specificity (không viết regex quá rộng — test false-positive), và key-exhaustive-test (test mọi status key có rule); WG = keyed status catchall, kết hợp WF ordered-state-matching (ordered rule alternative) + 555 UI permission-mode (status display)
