# Hướng UC: Strategic Compact Reminder — đếm tool-call + usage trong transcript, gợi ý /compact đúng mốc logic

> **Nguồn gốc:** ECC `suggest-compact.js` (transcript scanning, tool-call count, usage tracking, /compact suggestion); "watch tool-call count and usage in transcript", "suggest /compact at logical milestone", "compact after exploration, before execution" | **Coupling:** 🟢 — thêm compact-suggestor vào loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (compress + idle-trigger sẵn — chưa có tool-call-count + milestone logic + suggestion) | **Effort:** 2 tuần

## Nguồn gốc

**ECC** `suggest-compact.js` không compact tự động theo token-count tĩnh (dễ compact sai lúc — giữa một task đang chạy). Thay vào đó nó **theo dõi transcript**: đếm **tool-call** (bao nhiêu tool đã chạy) và **usage** (token đã tiêu). Khi usage gần ngưỡng, nó **chờ mốc logic** — ví dụ: sau khi agent **thăm dò xong** (exploration phase: search/read nhiều tool-call nhưng chưa edit), **trước khi bắt đầu thực thi** (execution phase: edit/write). Gợi ý `/compact` vào đúng khoảng trống logic này: agent đã hiểu context (thăm dò xong), sắp hành động (thực thi) → compact không cắt giữa chừng công việc. Nguyên tắc: **compact theo milestone, không theo token-count mù**.

## Mô tả

mya strategic compact reminder: (1) **Transcript scan**: đếm tool-call (read/search/write/exec) + token usage. (2) **Usage threshold**: token gần limit → flag "sắp cần compact". (3) **Milestone detect**: phát hiện phase transition (exploration→execution: read-heavy sang write-heavy). (4) **Suggest**: ở mốc logic + usage cao → gợi ý `/compact` (sau thăm dò, trước thực thi). mya có compress + idle-trigger — UC thêm **tool-call-counter** + **usage-tracker** + **milestone-detector** + **suggestion**.

## Kiến trúc

```
  TRANSCRIPT (agent chạy)
        │
        ▼
  ┌─── SCAN (mỗi turn) ─────────────────────────────────────┐
  │  tool-call count:  read=12, search=5, write=0, exec=0   │
  │  token usage:      45k / 50k limit → 90% (GẦN NGƯỠNG)   │
  └───────────────────────┬─────────────────────────────────┘
                          │ (usage > threshold)
                          ▼
  ┌─── MILESTONE DETECT ────────────────────────────────────┐
  │  phase = exploration (read/search heavy, chưa write)     │
  │  next phase = execution (sắp write/exec)                 │
  │  → MỐC LOGIC: exploration xong, execution chưa bắt đầu  │
  └───────────────────────┬─────────────────────────────────┘
                          │ (milestone + usage cao)
                          ▼
  ┌─── SUGGEST /compact ────────────────────────────────────┐
  │  "💡 Usage 90%. Bạn đã thăm dò xong.                    │
  │   Gợi ý /compact trước khi bắt đầu edit."                │
  │  → compact ở khoảng trống an toàn (không cắt giữa task)  │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts compress.ts — transcript compact (nền — UC trigger cái này)
// ✅ packages/prompts idle-trigger.ts — idle detection (nền — UC milestone analog)
// ✅ packages/core budget.ts — token budget (nền — UC usage tracker)
// ✅ packages/core iteration-budget.ts — iteration count (nền — UC tool-call count)

// ❌ THIẾU: tool-call-counter (đếm read/search/write/exec theo loại)
// ❌ THIẾU: milestone-detector (phase transition exploration→execution)
// ❌ THIẾU: suggestion logic (milestone + usage → suggest /compact)
```

## Implementation

```typescript
// packages/agent/src/strategic-compact.ts (MỚI)
type ToolKind = 'read' | 'search' | 'write' | 'exec';

interface TranscriptStats {
  toolCalls: Record<ToolKind, number>;
  usageRatio: number; // 0..1
}

class StrategicCompactReminder {
  constructor(private usageThreshold: number) {} // vd 0.85

  // classify tool → kind
  private kind(toolName: string): ToolKind {
    if (/read|cat|ls|find|search|grep/.test(toolName)) return 'read';
    if (/write|edit|patch|mkdir/.test(toolName)) return 'write';
    if (/exec|run|bash|shell/.test(toolName)) return 'exec';
    return 'read';
  }

  // detect milestone: exploration → execution transition
  private detectMilestone(calls: Record<ToolKind, number>): boolean {
    const explore = calls.read + calls.search;
    const execute = calls.write + calls.exec;
    // exploration heavy, execution bắt đầu (1+ write/exec vừa xuất hiện)
    return explore >= 8 && execute >= 1;
  }

  suggest(stats: TranscriptStats): string | null {
    if (stats.usageRatio < this.usageThreshold) return null;
    if (!this.detectMilestone(stats.toolCalls)) return null; // chưa tới mốc logic
    return `💡 Usage ${(stats.usageRatio * 100).toFixed(0)}%. ` +
      `Thăm dò xong (${stats.toolCalls.read + stats.toolCalls.search} read/search). ` +
      `Gợi ý /compact trước khi bắt đầu thực thi.`;
  }

  scan(transcript: { tool: string }[], usageRatio: number): string | null {
    const calls: Record<ToolKind, number> = { read: 0, search: 0, write: 0, exec: 0 };
    for (const t of transcript) calls[this.kind(t.tool)]++;
    return this.suggest({ toolCalls: calls, usageRatio });
  }
}

// Usage:
// const hint = compact.scan(transcript, 0.92);
// → "💡 Usage 92%. Thăm dò xong (17 read/search). Gợi ý /compact trước khi thực thi."
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Compact đúng lúc (mốc logic, không cắt giữa task) | ❌ Milestone heuristic (phase detect có thể sai) |
| ✅ Giữ context quan trọng (sau thăm dò → đã hiểu) | ❌ Suggestion fatigue (gợi ý quá nhiều → ignore) |
| ✅ Usage-aware (không compact thừa khi token còn nhiều) | ❌ Threshold tuning (usage + tool-count chủ quan) |
| ✅ UX chủ động (agent biết khi nào compact) | ❌ Tool classification (tool mới không match pattern) |

## Khác các hướng gần

| | Auto-compact (token) | Manual /compact | UC: Strategic-Reminder |
|---|---|---|---|
| Cái gì | Token > limit → compact | User tự gọi | **Milestone + usage → gợi ý** |
| Timing | Token-blind | User quyết định | **Mốc logic (exploration→execution)** |
| Cắt giữa task | ✅ (có thể) | ❌ (user chủ động) | **❌ (đợi mốc an toàn)** |

## Khi nào chọn

- Session dài → token phình → cần compact nhưng sợ cắt giữa task
- Agent có phase rõ (thăm dò rồi thực thi) → mốc logic detect được
- Muốn UX chủ động (gợi ý thay vì tự compact mù)
- Nối packages/prompts compress.ts + idle-trigger.ts + packages/core budget.ts + iteration-budget.ts; guard milestone accuracy (phase heuristic test thực tế), suggestion fatigue (chỉ suggest 1 lần mỗi milestone, không spam), và threshold tuning (usage + tool-count điều chỉnh theo model context window); UC = strategic compact reminder, kết hợp 547 UA PreCompact-hook (save state trước khi compact gợi ý) + 545 TY config (threshold reloadable)
