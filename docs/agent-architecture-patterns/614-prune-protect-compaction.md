# Hướng WP: Prune-Protect Compaction — compact với PRUNE_MINIMUM + PRUNE_PROTECT guards bảo vệ phần quan trọng; tool output truncate 2k

> **Nguồn gốc:** opencode `compaction` (PRUNE_MINIMUM guard: không compact dưới minimum entries; PRUNE_PROTECT: bảo vệ entry được mark protect; tool output truncate 2k chars); "PRUNE_MINIMUM prevent over-prune", "PRUNE_PROTECT guard important entries", "tool output truncated to 2k" | **Coupling:** 🟡 — thêm prune guards + truncate vào compaction pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (compaction + spill sẵn — chưa có PRUNE_MINIMUM/PROTECT guards + 2k truncate) | **Effort:** 2 tuần

## Nguồn gốc

**opencode** compaction có **hai guard** chống mất dữ liệu quan trọng: (1) **PRUNE_MINIMUM**: compact không bao giờ rút history xuống dưới **minimum entries** (vd ≥ 3 entry giữ) — chống over-prune (compact quá aggressively → gần empty). (2) **PRUNE_PROTECT**: entry được **mark protect** (vd system instruction, critical decision) → **không compact** (luôn giữ nguyên). Ngoài ra: **tool output truncate 2k** — khi tool trả output dài (vd build log 10k), **truncate còn 2k chars** trước khi lưu vào history (giữ head/tail, drop middle). Nguyên tắc: **guard chống over-prune + protect critical + truncate verbose**.

## Mô tả

mya prune-protect compaction: (1) **PRUNE_MINIMUM**: compact → check remaining entries ≥ minimum → nếu dưới → không compact thêm. (2) **PRUNE_PROTECT**: entry mark `protect: true` → compact skip (giữ nguyên). (3) **Truncate 2k**: tool output > 2k → truncate (giữ head + tail, drop middle, thêm `...[truncated]...`). (4) **Compact order**: prune non-protect entries (cũ nhất trước) → respect minimum → respect protect. mya có compaction + spill — WP thêm **PRUNE_MINIMUM guard** + **PRUNE_PROTECT guard** + **2k truncate**.

## Kiến trúc

```
  HISTORY (10 entries, sắp compact)
  ┌─[0] system instruction   (protect: true) ── PROTECTED ┐
  ├─[1] user: "refactor"                       ───────────┤
  ├─[2] tool: build log (12k chars) ── TRUNCATE 2k ──────┤
  ├─[3] agent: "found 3 issues"  (protect: true) PROTECTED│
  ├─[4] tool: grep result                      ───────────┤
  ├─[5-9] ...                                  ───────────┤
  └───────────────────────────────────────────────────────┘
        │
        ▼
  ┌─── STEP 1: TRUNCATE tool output (>2k) ───────────────┐
  │  entry[2] build log 12k → truncate:                   │
  │  head(1k) + "...[truncated 10k chars]..." + tail(1k)  │
  │  → 2k chars (save 10k token)                           │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── STEP 2: PRUNE (compact non-protect) ──────────────┐
  │  compact entries: skip protect, prune cũ nhất trước   │
  │  entry[1] (non-protect, cũ) → summarize → prune       │
  │  entry[0] (PROTECT) → GIỮ NGUYÊN                       │
  │  entry[3] (PROTECT) → GIỮ NGUYÊN                       │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── STEP 3: PRUNE_MINIMUM guard ──────────────────────┐
  │  remaining entries = 4 (2 protect + 2 recent)         │
  │  minimum = 3 → 4 ≥ 3 → OK (không over-prune)          │
  │  nếu remaining < minimum → STOP (không compact thêm)  │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — session/history (nền — WP compact ở đây)
// ✅ packages/core spill.ts — spill management (nền — WP truncate analog)
// ✅ packages/core redact.ts — redaction (nền — WP truncate sibling)

// ❌ THIẾU: PRUNE_MINIMUM guard (không compact dưới minimum)
// ❌ THIẾU: PRUNE_PROTECT guard (entry protect → không compact)
// ❌ THIẾU: tool output truncate 2k (head+tail, drop middle)
```

## Implementation

```typescript
// packages/core/src/prune-protect-compaction.ts (MỚI)
interface HistoryEntry { id: string; role: string; content: string; protect?: boolean }

const TRUNCATE_LIMIT = 2000;
const PRUNE_MINIMUM = 3;

// truncate tool output > 2k (head + tail, drop middle)
function truncateOutput(content: string, limit = TRUNCATE_LIMIT): string {
  if (content.length <= limit) return content;
  const head = Math.floor(limit / 2);
  const tail = limit - head;
  return content.slice(0, head) + `\n...[truncated ${content.length - limit} chars]...\n` + content.slice(-tail);
}

// compact respecting PRUNE_PROTECT + PRUNE_MINIMUM
function pruneProtectCompact(
  history: HistoryEntry[],
  shouldCompact: (e: HistoryEntry) => boolean,
): HistoryEntry[] {
  const kept: HistoryEntry[] = [];
  const pruned: HistoryEntry[] = [];

  for (const entry of history) {
    if (entry.protect) { kept.push(entry); continue; }          // PRUNE_PROTECT → luôn giữ
    (shouldCompact(entry) ? pruned : kept).push(entry);
  }

  // PRUNE_MINIMUM: nếu kept < minimum → khôi phục pruned gần nhất
  while (kept.length < PRUNE_MINIMUM && pruned.length > 0) {
    kept.unshift(pruned.pop()!); // khôi phục từ cuối (gần nhất)
  }

  // summarize pruned thành 1 summary entry
  if (pruned.length > 0) {
    const summary: HistoryEntry = {
      id: `summary-${Date.now()}`,
      role: "system",
      content: `[Compacted ${pruned.length} entries]`,
    };
    return [summary, ...kept];
  }
  return kept;
}

// Usage:
// history = history.map(e => e.role === "tool" ? { ...e, content: truncateOutput(e.content) } : e);
// history = pruneProtectCompact(history, e => e.role === "user"); // prune user entries cũ
```

## Được

- ✅ Chống over-prune (PRUNE_MINIMUM → không compact quá aggressively)
- ✅ Protect critical (PRUNE_PROTECT → system instruction/decision không mất)
- ✅ Token save (truncate 2k → verbose output không phình context)
- ✅ Safe compact (guard → compact an toàn, không mất dữ liệu quan trọng)

## Mất

- ❌ Truncate info loss (middle drop → có thể mất debug info)
- ❌ Protect sprawl (quá nhiều protect → compact không hiệu quả)
- ❌ Minimum tuning (PRUNE_MINIMUM cứng → context vẫn đầy nếu quá cao)
- ❌ Truncate boundary (cắt ngang token/word → output méo)

## Khác

Khác **606 WH threshold-auto-compaction** (trigger + dual summary) — WP **guard-based** (protect/minimum, không trigger threshold). Khác **366 NB seamless-compaction** (todo checkpoint) — WP **guard + truncate** (chống mất, không chỉ checkpoint). Khác **plain summarize** (compact tất cả) — WP **selective prune** (protect giữ, non-protect prune).

## Khi nào chọn

- Compaction có risk mất critical (system instruction, decision) → cần protect
- Tool output verbose (build log, grep) → cần truncate 2k
- Muốn chống over-prune (minimum guard → không empty history)
- Nối packages/core session.ts + spill.ts + redact.ts; guard protect-marking-discipline (chỉ mark protect khi thực sự critical), truncate-head-tail (giữ context đầu+cuối), và minimum-tuning (PRUNE_MINIMUM theo context size); WP = prune-protect compaction, kết hợp 606 WH threshold-auto-compaction (trigger) + 366 NB seamless-compaction (checkpoint)
