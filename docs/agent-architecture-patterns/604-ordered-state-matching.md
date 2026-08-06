# Hướng WF: Ordered State Matching — segment khớp state theo thứ tự: status regex, meter threshold gte/lte rồi chọn fg/bg palette

> **Nguồn gốc:** pi-bar `segment state matcher` (ordered rules: status dùng regex, meter dùng gte/lte threshold, palette fg/bg); "match segment state in order", "status regex", "meter gte/lte threshold", "select fg/bg palette by matched state" | **Coupling:** 🟢 — thêm ordered state-matcher vào bar/TUI segment renderer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (TUI + render sẵn — chưa có ordered state-rule engine + palette selector) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-bar** render status bar bằng **segment** — mỗi segment hiển thị 1 metric (status, meter, label). Mỗi segment có **state rules** xếp theo thứ tự: rule đầu khớp sẽ thắng. Có 2 loại rule: (1) **Status regex** — giá trị dạng string → match `regex` (vd `^error$`, `^warn:`). (2) **Meter threshold** — giá trị dạng số → match `gte`/`lte` (vd `cpu >= 90`). Khi rule khớp → chọn **palette** (foreground + background color) cho segment đó. Nguyên tắc: **ordered match** — rule đánh theo thứ tự, first-match-wins, mỗi loại giá trị (status/meter) có matcher riêng.

## Mô tả

mya ordered state matching: (1) **Segment config**: mỗi segment khai báo danh sách rule (theo thứ tự) + default palette. (2) **Matcher theo loại**: status → regex test; meter → gte/lte threshold. (3) **Ordered scan**: duyệt rule theo thứ tự → rule đầu khớp → lấy palette. (4) **Fallback**: không rule khớp → default palette. (5) **Render**: segment render với palette đã chọn (fg/bg). mya có TUI + terminal render — WF thêm **state-rule engine** + **ordered matcher** + **palette selector**.

## Kiến trúc

```
  SEGMENT (vd: build status)
  ┌─ rules (ordered): ─────────────────────────────────┐
  │  [0] status regex "^(error|fail)" → palette: red    │
  │  [1] status regex "^warn"          → palette: yellow│
  │  [2] meter gte 90 (cpu%)           → palette: red   │
  │  [3] meter gte 70                  → palette: yellow│
  │  default                           → palette: green │
  └───────────────┬─────────────────────────────────────┘
                  │ (giá trị hiện tại)
                  ▼
  ┌─── ORDERED SCAN (first-match-wins) ──────────────────┐
  │  value = "error: build failed"                        │
  │  rule[0] regex "^(error|fail)" → MATCH ✅ → STOP      │
  │  → palette = red (fg=white, bg=red)                   │
  │                                                        │
  │  value = cpu 95%                                       │
  │  rule[0] status regex → no (not string)                │
  │  rule[1] status regex → no                             │
  │  rule[2] meter gte 90 → 95 >= 90 → MATCH ✅ → STOP     │
  │  → palette = red                                       │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── RENDER segment với palette ───────────────────────┐
  │  [\x1b[37;41m error: build failed \x1b[0m]  (white on red)│
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tui — terminal UI render (nền — WF segment render ở đây)
// ✅ packages/print — text/print output (nền — WF palette/color)
// ✅ packages/core telemetry.ts — metric values (nền — WF meter threshold source)

// ❌ THIẾU: segment state-rule engine (ordered rule list + default)
// ❌ THIẾU: status regex matcher (string value → regex test)
// ❌ THIẾU: meter threshold matcher (number → gte/lte)
// ❌ THIẾU: palette selector (matched rule → fg/bg color)
```

## Implementation

```typescript
// packages/tui/src/ordered-state-matching.ts (MỚI)
interface Palette { fg: string; bg: string }

type StateRule =
  | { kind: "status"; regex: string; palette: Palette }   // string → regex
  | { kind: "meter"; gte?: number; lte?: number; palette: Palette }; // number → threshold

interface SegmentConfig {
  rules: StateRule[];      // ordered — first match wins
  default: Palette;        // fallback
}

function matchRule(rule: StateRule, value: string | number): boolean {
  if (rule.kind === "status") {
    return typeof value === "string" && new RegExp(rule.regex).test(value);
  }
  // meter
  if (typeof value !== "number") return false;
  if (rule.gte !== undefined && !(value >= rule.gte)) return false;
  if (rule.lte !== undefined && !(value <= rule.lte)) return false;
  return true;
}

function matchSegment(config: SegmentConfig, value: string | number): Palette {
  for (const rule of config.rules) {
    if (matchRule(rule, value)) return rule.palette; // first-match-wins
  }
  return config.default; // fallback
}

// Usage:
// const seg: SegmentConfig = {
//   rules: [
//     { kind: "status", regex: "^(error|fail)", palette: { fg: "white", bg: "red" } },
//     { kind: "meter", gte: 90, palette: { fg: "white", bg: "red" } },
//   ],
//   default: { fg: "white", bg: "green" },
// };
// const palette = matchSegment(seg, "error: build failed"); // → red
```

## Được

- ✅ Visual state一目了然 (color = state — error đỏ, warn vàng, ok xanh)
- ✅ Ordered precedence (rule trước ưu tiên — first-match-wins rõ ràng)
- ✅ Đa năng (status regex + meter threshold cùng engine)
- ✅ Configurable (palette/rule khai báo, không hardcode)

## Mất

- ❌ Rule order fragility (sai thứ tự → match sai — debug khó)
- ❌ Regex cost (nhiều rule regex → compile/test mỗi render)
- ❌ Palette clash (fg/bg trùng → text không đọc được)
- ❌ Config verbosity (nhiều segment → dài config)

## Khác

Khác **static color** (segment luôn 1 màu) — WF **dynamic palette** theo state value. Khác **WG keyed-status-catchall** (key "*" fallback render) — WF là **ordered rule match** (rule list, không key map). Khác **threshold alert** (chỉ cảnh báo) — WF **render visual** (palette cho segment).

## Khi nào chọn

- TUI/status bar hiển thị metric thay đổi state (error/warn/ok) theo thời gian
- Muốn visual feedback tức thì (color = state, user nhìn 1 cái biết)
- Nối packages/tui + packages/print + packages/core telemetry.ts; guard rule-order-test (test first-match-wins), regex-compile-cache (cache RegExp — không recompile mỗi render), và palette-contrast (fg/bg đủ contrast — đọc được); WF = ordered state matching, kết hợp WG keyed-status-catchall (fallback render) + 555 UI permission-mode (visual state display)
