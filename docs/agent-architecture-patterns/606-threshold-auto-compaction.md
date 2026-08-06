# Hướng WH: Threshold Auto-Compaction — auto compact khi quá contextWindow-reserveTokens; CompactionEntry lưu firstKeptEntryId + split-turn dual summary

> **Nguồn gốc:** pi `auto compaction` (trigger khi token vượt contextWindow - reserveTokens; `CompactionEntry` lưu `firstKeptEntryId`; split-turn dual summary) | **Coupling:** 🟡 — thêm threshold trigger + CompactionEntry + dual summary vào session/history | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (session/history + compaction sẵn — chưa có threshold auto-trigger + CompactionEntry + split-turn dual summary) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi** quản lý context bằng **auto-compaction** — không đợi user, không đợi overflow, mà **trigger proactively** khi token usage vượt `contextWindow - reserveTokens` (giữ reserve cho response). Khi trigger: tạo `CompactionEntry` — một marker đặc biệt lưu `firstKeptEntryId` (entry đầu tiên được giữ sau compact, tạo "anchor" để biết history bắt đầu từ đâu). Điểm độc đáo: **split-turn dual summary** — thay vì 1 summary chung, tách thành 2 phần: (1) summary **trước ngắt** (context cũ), (2) summary **sau ngắt** (context gần), giữ cả 2 góc nhìn. Nguyên tắc: **threshold-triggered + anchored + dual-perspective**.

## Mô tả

mya threshold auto-compaction: (1) **Threshold check**: mỗi turn → estimate token usage; nếu `usage > contextWindow - reserveTokens` → trigger compact. (2) **CompactionEntry**: tạo entry đánh dấu compact point, lưu `firstKeptEntryId` (anchor). (3) **Split-turn dual summary**: tách history thành 2 segment → summarize riêng → dual summary (góc cũ + góc gần). (4) **Replace**: history cũ → dual summary + CompactionEntry + entries từ firstKept. (5) **Resume**: agent tiếp tục với context gọn, anchor rõ ràng. mya có session/history + spill — WH thêm **threshold auto-trigger** + **CompactionEntry** + **split-turn dual summary**.

## Kiến trúc

```
  TURN N: estimate token usage
        │
        ▼
  ┌─── THRESHOLD CHECK ──────────────────────────────────┐
  │  if (tokenUsage > contextWindow - reserveTokens)      │
  │     → TRIGGER COMPACT (proactive, không đợi overflow) │
  │  else → tiếp tục turn bình thường                      │
  └───────────────┬─────────────────────────────────────┘
                  ▼ (trigger)
  ┌─── SPLIT-TURN (chia history thành 2 segment) ────────┐
  │  segment A (cũ): entry 1..M                            │
  │  segment B (gần): entry M+1..N                         │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── DUAL SUMMARY (summarize riêng từng segment) ──────┐
  │  summaryA = "turns 1-15: thiết lập project, API design"│
  │  summaryB = "turns 16-22: fix bug auth, test pass"     │
  │  → 2 góc nhìn (cũ: bối cảnh, gần: chi tiết hiện tại)   │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── COMPACTION ENTRY (anchor) ────────────────────────┐
  │  CompactionEntry {                                      │
  │    firstKeptEntryId: entry M+1,  ← anchor              │
  │    summaryA: "...", summaryB: "...",                   │
  │    compactedAt: turn N                                  │
  │  }                                                      │
  │  new history = [CompactionEntry, entry M+1..N]         │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — session history (nền — WH compact ở đây)
// ✅ packages/core spill.ts — spill management (nền — WH overflow handling)
// ✅ packages/ai estimate — token estimation (nền — WH threshold check)
// ✅ packages/core budget.ts — budget/limit (nền — WH reserveTokens)

// ❌ THIẾU: threshold auto-trigger (contextWindow - reserveTokens check mỗi turn)
// ❌ THIẾU: CompactionEntry (anchor marker + firstKeptEntryId)
// ❌ THIẾU: split-turn dual summary (2 segment → 2 summary)
```

## Implementation

```typescript
// packages/core/src/threshold-auto-compaction.ts (MỚI)
interface CompactionEntry {
  type: "compaction";
  firstKeptEntryId: string;  // anchor — entry đầu kept
  summaryA: string;          // dual: segment cũ
  summaryB: string;          // dual: segment gần
  compactedAt: number;
}

interface HistoryEntry { id: string; role: string; content: string }

async function maybeAutoCompact(
  history: HistoryEntry[],
  estimateTokens: (entries: HistoryEntry[]) => number,
  contextWindow: number,
  reserveTokens: number,
  summarize: (entries: HistoryEntry[]) => Promise<string>,
  splitAt: number,
): Promise<HistoryEntry[]> {
  const usage = estimateTokens(history);
  if (usage <= contextWindow - reserveTokens) return history; // chưa vượt threshold

  // split-turn: chia history thành 2 segment
  const segmentA = history.slice(0, splitAt); // cũ
  const segmentB = history.slice(splitAt);     // gần

  // dual summary (riêng từng segment)
  const [summaryA, summaryB] = await Promise.all([
    summarize(segmentA),
    summarize(segmentB),
  ]);

  const compaction: CompactionEntry = {
    type: "compaction",
    firstKeptEntryId: segmentB[0]?.id ?? history[0]!.id, // anchor
    summaryA,
    summaryB,
    compactedAt: history.length,
  };

  return [compaction as unknown as HistoryEntry, ...segmentB]; // dual summary + kept entries
}

// Usage:
// history = await maybeAutoCompact(history, estTokens, 200000, 8000, summarize, splitAt);
// → trigger khi usage > 192000; CompactionEntry anchor + dual summary
```

## Được

- ✅ Proactive (trigger trước overflow — không crash, không truncate cắt ngang)
- ✅ Anchor clarity (`firstKeptEntryId` — biết history bắt đầu đâu sau compact)
- ✅ Dual perspective (summary cũ = bối cảnh, summary gần = chi tiết — không mất góc nhìn)
- ✅ Reserve safety (giữ reserveTokens cho response — không overflow mid-generation)

## Mất

- ❌ Token estimation error (sai estimate → trigger sai thời điểm)
- ❌ Dual summary cost (2 lần summarize → tốn 2x token/time)
- ❌ Split-point choice (splitAt chủ quan — chia sai → summary méo)
- ❌ Compaction cascade (compact xong vẫn vượt → compact lại — cascade)

## Khác

Khác **549 UC strategic-compact** (compact khi reminder) — WH **threshold-triggered** (proactive, auto). Khác **366 NB seamless-compaction** (todo-state checkpoint) — WH **dual summary** (2 góc nhìn, không chỉ work-state). Khác **543 TW durable-context-projection** (capture durable + re-project) — WH **summarize + anchor** (compact history, giữ anchor).

## Khi nào chọn

- Session dài → context sắp đầy → cần compact proactive (không đợi overflow)
- Cần dual perspective (bối cảnh cũ + chi tiết gần — không gộp 1 summary chung)
- Muốn anchor rõ ràng (firstKeptEntryId — debug/resume biết history bắt đầu đâu)
- Nối packages/core session.ts + spill.ts + packages/ai estimate + budget.ts; guard token-estimate-accuracy (calibrate estimate vs actual — test), reserve-tuning (reserveTokens đủ cho response — test), và split-point-stability (splitAt theo entry boundary — không cắt ngang turn); WH = threshold auto-compaction, kết hợp 366 NB seamless-compaction (work-state checkpoint) + 543 TW durable-context-projection (durable survive)
