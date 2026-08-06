# Hướng ACS: State-MD Lifecycle Frontmatter — STATE.md mang YAML frontmatter lifecycle (active_phase, next_action, progress) mà status-line hook đọc mỗi render

> **Nguồn gốc:** get-shit-done (docs/STATE-MD-LIFECYCLE.md) | **Coupling:** 🟡 — thêm frontmatter contract cho state file | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có session-meta + goals — chưa có STATE.md frontmatter lifecycle) | **Effort:** 1-2 tuần

## Nguồn gốc

**get-shit-done** dùng **STATE.md mang YAML frontmatter lifecycle**: `active_phase`, `next_action`, `next_phases`, `progress.percent` — mà **status-line hook đọc mỗi render** để hiển thị tiến độ. Parser **chỉ nhận single-line YAML flow** (không chấp nhận block multi-line — giữ đơn giản, deterministic), và **progress bar dùng phase-dimension vì plan-dimension bị biased optimistic** — đếm phase hoàn thành phản ánh thực tế hơn đếm theo plan (plan thường lạc quan). Nguyên tắc: **state file có header máy đọc được, render từ đó, đo theo phase thực tế không theo plan ước lượng**.

## Mô tả

mya state-md lifecycle frontmatter: (1) **frontmatter contract** — STATE.md bắt đầu bằng YAML frontmatter: `active_phase`, `next_action`, `next_phases: [...]`, `progress: { percent }`; (2) **parser single-line** — chỉ chấp nhận YAML flow trên một dòng (`progress: { percent: 40 }`) — không parse block multi-line, fail nhanh khi sai format; (3) **status-line hook** — mỗi render đọc frontmatter → hiển thị phase hiện tại + next action + progress bar; (4) **phase-dimension progress** — % = phase hoàn thành / tổng phase (không phải theo plan ước lượng — chống optimistic bias). Nối session-meta.ts (đã có) — STATE.md là dạng session meta file-backed.

## Kiến trúc

```
  STATE.md
    ---
    active_phase: implement
    next_action: "viết test cho auth"
    next_phases: [review, verify]
    progress: { percent: 40 }
    ---
    (body — chi tiết trạng thái)
       ▼
  PARSER (single-line YAML flow — deterministic)
    frontmatter ──▶ { active_phase, next_action, next_phases, progress }
       ▼
  STATUS-LINE HOOK (mỗi render)
    [implement 40%] ▶ next: viết test cho auth
  PROGRESS = phase-dimension (không phải plan-dimension)
    plan lạc quan ──▶ biased optimistic ──▶ KHÔNG dùng cho bar
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print session-meta.ts — session meta (nền — state file contract)
// ✅ packages/memory roles.ts — GoalsRole + systemPromptBlock (nền — next_action analog)
// ✅ packages/core session-utils.ts — SessionEntry (nền — state persist)
// ✅ packages/core laneboard.ts — freshness classification (nền — status line)
// ✅ packages/memory lifecycle.ts — LifecycleManager (nền — phase management)
// ✅ packages/memory sqlite-consolidate.ts — lifecycleTick (nền — phase progression)

// ❌ THIẾU: STATE.md frontmatter contract (active_phase/next_action/progress)
// ❌ THIẾU: single-line YAML flow parser
// ❌ THIẾU: phase-dimension progress (không plan-dimension)
```
## Implementation
```typescript
// packages/print/src/state-md.ts (MỚI)
export interface StateFrontmatter {
  active_phase: string;
  next_action: string;
  next_phases: string[];
  progress: { percent: number };
}
/** Parse frontmatter — CHỈ single-line YAML flow, deterministic. */
export function parseStateFrontmatter(text: string): StateFrontmatter | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const lines = block.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const out: Partial<StateFrontmatter> = {};
  for (const line of lines) {
    // active_phase: implement — single-line key: value
    const kv = /^([a-z_]+):\s*(.+)$/.exec(line.trim());
    if (!kv) return null; // không phải single-line flow → từ chối (fail nhanh)
    const key = kv[1]!;
    const val = kv[2]!.trim();
    if (key === "active_phase" || key === "next_action") out[key] = val;
    else if (key === "next_phases") {
      // [review, verify] — array flow trên 1 dòng
      if (!(val.startsWith("[") && val.endsWith("]"))) return null;
      out.next_phases = val.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "progress") {
      // { percent: 40 } — map flow trên 1 dòng
      const m = /^\{\s*percent:\s*(\d{1,3})\s*\}$/.exec(val);
      if (!m) return null;
      out.progress = { percent: Number.parseInt(m[1]!, 10) };
    }
  }
  if (!out.active_phase || !out.next_action || !out.next_phases || !out.progress) return null;
  return out as StateFrontmatter;
}
/** Phase-dimension progress — phase hoàn thành / tổng phase. */
export function phaseProgress(fm: StateFrontmatter, donePhases: string[]): number {
  const total = [fm.active_phase, ...fm.next_phases].length;
  const done = donePhases.filter((p) => p !== fm.active_phase).length;
  return Math.round((done / Math.max(total, 1)) * 100);
}
/** Status-line render — hook đọc mỗi render. */
export function renderStatusLine(fm: StateFrontmatter, donePhases: string[]): string {
  const pct = phaseProgress(fm, donePhases);
  const bar = "█".repeat(Math.round(pct / 10)).padEnd(10, "░");
  return `[${fm.active_phase} ${bar} ${pct}%] ▶ next: ${fm.next_action}`;
}
//        if (fm) renderStatusLine(fm, donePhases) → status bar
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Máy đọc được trạng thái — render/audit deterministic | ❌ Single-line flow giới hạn format (không multi-line) |
| ✅ Phase-dimension chống optimistic bias | ❌ Phase list phải cập nhật đúng — lệch là progress sai |
| ✅ Fail nhanh khi format sai — không parse mơ hồ | ❌ Frontmatter phải được giữ đồng bộ với body |
| ✅ Status-line hook đơn giản — đọc mỗi render | ❌ Progress % thủ công (percent) có thể bị khai sai |

## Khác các hướng gần

| | GoalsRole (memory/roles.ts) | ACS: STATE.md Frontmatter |
|---|---|---|
| Nơi lưu | Memory entries (goals role) | **STATE.md frontmatter (file)** |
| Nội dung | Danh sách goal active | **Phase + next action + progress %** |
| Render | systemPromptBlock | **Status-line hook mỗi render** |
| Progress | Không có | **Phase-dimension (chống optimistic)** |

## Khi nào chọn

- Task dài nhiều phase — cần file state máy đọc được để hook render
- Muốn progress bar phản ánh thực tế (phase-dimension) không bị plan lạc quan đánh lừa
- Đã có session-meta + goals — thêm frontmatter contract
- Guard: parser single-line fail nhanh, phase list đồng bộ, progress tính từ phase thật
