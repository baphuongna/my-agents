# Hướng ACF: Thread Inject or Summarize — kết quả side thread đưa về main theo hai chế độ: inject nguyên văn hoặc summarize giữ key decisions

> **Nguồn gốc:** pi-btw (extensions/btw.ts) | **Coupling:** 🟢 — thêm handoff bridge, main loop không đổi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có compress/summarize + session-utils custom entry — chưa có inject/summarize handoff) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-btw** đưa kết quả side thread về main agent theo **hai chế độ**: **`/btw:inject`** gửi **nguyên văn thread** (dùng khi **wording/tradeoffs chính xác quan trọng** — ví dụ so sánh phương án cần giữ nguyên lý luận), hoặc **`/btw:summarize`** gửi **bản rút gọn** giữ **key decisions / plans / insights / risks / action items**. Điểm mấu chốt về độ tin cậy: **thread được reset sau khi handoff thành công**, nhưng được **preserve nếu inject fail** để retry — không mất dữ liệu khi handoff lỗi. Nguyên tắc: **handoff có chủ đích theo độ chính xác cần thiết, reset chỉ sau thành công**.

## Mô tả

mya thread inject or summarize: (1) **inject mode** — nối toàn bộ side-thread transcript vào prompt main (dưới dạng context block, có đánh dấu nguồn), giữ nguyên wording; (2) **summarize mode** — chạy summarizer (packages/prompts compressors.ts đã có summarizeCompressor + rankBriefBlocks) ép transcript về **5 nhóm: decisions / plans / insights / risks / action items**; (3) **handoff ack** — chỉ reset thread khi main session nhận thành công (append vào history xong mới clear); (4) **retry preserve** — nếu inject/summarize throw (session đóng, prompt fail), transcript giữ nguyên để retry. Nối ACE (side-thread) — ACF là cổng ra của ACE.

## Kiến trúc

```
  SIDE THREAD TRANSCRIPT (ACE)
       ▼
  HANDOFF MODE
    ├─ inject    ──▶ nguyên văn (wording/tradeoffs quan trọng)
    └─ summarize ──▶ rút gọn giữ: decisions · plans · insights
                       risks · action items
       ▼
  APPEND VÀO MAIN SESSION (history)
       │  thành công?
       ├─ ✅ → reset thread (transcript = [])
       └─ ❌ → PRESERVE thread (retry — không mất dữ liệu)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts compressors.ts — summarizeCompressor (nền — ACF summarize mode)
// ✅ packages/prompts ranked-compaction.ts — rankBriefBlocks + selectRankedBriefBlocks
//   (nền — giữ key blocks khi rút gọn)
// ✅ packages/core session-utils.ts — EntryKind "custom" (inject có thể ghi custom entry)
// ✅ packages/core session.ts — ArrayHistory.append (nền — inject vào history)
// ✅ packages/intercom — inline-message UI (nền — hiển thị handoff)

// ❌ THIẾU: inject mode (nguyên văn thread vào main prompt)
// ❌ THIẾU: summarize theo 5 nhóm cố định (decisions/plans/insights/risks/actions)
// ❌ THIẾU: handoff ack + reset-only-after-success + retry preserve
```
## Implementation
```typescript
// packages/agent/src/thread-handoff.ts (MỚI)
import { appendEntry, type SessionEntry } from "@my-agent/core";
import { summarizeCompressor } from "@my-agent/prompts";
export type HandoffMode = "inject" | "summarize";
export interface HandoffResult {
  ok: boolean;
  /** Bản đã đưa vào main (để audit). */
  delivered: string;
  /** false = chưa thành công — caller phải preserve thread. */
  committed: boolean;
}
const SUMMARY_GROUPS = ["decisions", "plans", "insights", "risks", "action_items"] as const;
/** Rút gọn transcript về 5 nhóm key — analog summarizeCompressor. */
export function summarizeThread(transcript: string[], maxGroups = SUMMARY_GROUPS.length): string {
  const lines = transcript.map((l) => `- ${l}`).join("\n");
  // Implementer: gọi summarizeCompressor thật; đây là shape chuẩn đầu ra.
  return [
    "## Side thread (summary)",
    "### decisions", "…", "### plans", "…", "### insights", "…",
    "### risks", "…", "### action_items", "…",
    `(raw ${lines.length} chars — đã rút gọn)`,
  ].join("\n");
}
/** Handoff side thread vào main session. */
export async function handoff(
  transcript: string[],
  mode: HandoffMode,
  append: (entry: SessionEntry) => void,
  summarize: (t: string[]) => Promise<string> = async (t) => summarizeThread(t),
): Promise<HandoffResult> {
  try {
    const delivered =
      mode === "inject"
        ? `## Side thread (verbatim)\n${transcript.map((l) => `- ${l}`).join("\n")}`
        : await summarize(transcript);
    // Append vào main history — thành công mới reset.
    append({
      id: crypto.randomUUID(),
      parentId: null,
      kind: "custom",
      role: "system",
      content: delivered,
    });
    return { ok: true, delivered, committed: true };
  } catch (err) {
    // Handoff fail — KHÔNG reset thread; caller giữ nguyên để retry.
    return { ok: false, delivered: "", committed: false };
  }
}
//        if (r.committed) transcript = []; // reset sau thành công
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Inject giữ wording/tradeoffs chính xác | ❌ Inject phình main context (toàn bộ thread) |
| ✅ Summarize giữ 5 nhóm key — context gọn | ❌ Summarize có thể mất chi tiết quan trọng |
| ✅ Reset chỉ sau thành công — không mất dữ liệu | ❌ Cần append entry custom vào history (contract mới) |
| ✅ Retry preserve — handoff fail không phải redo | ❌ Summarize phụ thuộc model (chi phí + latency) |

## Khác các hướng gần

| | Prompt compression (prompts/compress.ts) | ACF: Thread Handoff |
|---|---|---|
| Đầu vào | History main session | **Transcript side thread riêng** |
| Mục đích | Giảm context window khi đầy | **Đưa kết quả side về main có chủ đích** |
| Chế độ | Compress toàn bộ | **Inject (nguyên văn) / Summarize (5 nhóm)** |
| Reset | Không có khái niệm | **Reset thread chỉ sau khi committed** |

## Khi nào chọn

- Side thread (ACE) đã có kết quả cần đưa về main — cần chọn độ chính xác
- Wording/tradeoffs quan trọng (so sánh phương án) → inject; ngược lại → summarize
- Muốn đảm bảo không mất dữ liệu khi handoff lỗi (preserve + retry)
- Guard: inject phải đánh dấu nguồn, summarize giữ 5 nhóm cố định, reset có ack
