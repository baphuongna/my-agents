# Hướng AIQ: Lifetime Usage Accumulator — token usage nuôi bằng `lifetimeUsage` từ `onAssistantUsage`/`message_end` thay vì đọc `session.state.messages`, sống sót qua compaction

> **Nguồn gốc:** pi-subagents2 | **Coupling:** 🟢 — tracking thuần, không đụng turn loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn accumulation theo turn; thiếu lifetime + cacheWrite) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents2** đếm token dùng **lifetime accumulator** — `lifetimeUsage { input, output, cacheWrite }` được **nuôi bởi `onAssistantUsage`** (event từ `message_end`) **thay vì đọc `session.state.messages`**. Lý do: upstream **thay array khi compact** — đọc lại messages sau compaction sẽ mất usage của các turn cũ. Accumulator sống độc lập với history nên **sống sót qua compaction**, và **tránh đếm cacheRead lũy tiến 5-15x** (mỗi turn re-read prompt-cache cũ cộng dồn vào input — đếm qua messages sẽ phóng đại).

Nguyên tắc: **usage phải là accumulator do event feed (append-only), không phải phép chiếu từ history** — history là mutable (compaction thay array), accumulator là immutable counter; event nguồn là `message_end`/`onAssistantUsage` (nơi provider báo usage thật), không phải snapshot state; tách cacheRead/cacheWrite khỏi input để không đếm lại token cache.

## Mô tả

Với mya, pattern = **lifetime accumulator nối runtime**: (1) **core/types `TokenUsage`** đã có `input/output/cacheRead/cacheCreation` — nền đúng; (2) **loop.ts** đã đọc `ev.usage` ở turn-end và tính `computeCost` — nhưng là per-turn, không phải lifetime; (3) **print/runtimes/pi-in-process.ts** có `accumulatedUsage {tokensIn, tokensOut, costUsd}` nuôi từ `message_end` (đúng pattern) — nhưng **reset mỗi `prompt()`** → không phải lifetime, không sống qua compaction; (4) **CostTrackerImpl** (cost-tracker.ts) ghi per-session nhưng in-memory + per-turn_end; (5) AIP thêm **lifetime accumulator cấp session** — không reset ở prompt boundary, giữ qua compaction, tách cacheRead (không cộng vào input) + cacheWrite (đếm riêng). Nối gateway `/status` (subagent tokens) + `/agents` panel để hiển thị lifetime usage thay vì per-turn.

## Kiến trúc (ASCII)

```
  PROVIDER STREAM
    │  message_end / onAssistantUsage (usage thật từ provider)
    ▼
  LIFETIME ACCUMULATOR (cấp session, append-only)
    { input:  += msg.usage.input
      output: += msg.usage.output
      cacheWrite: += msg.usage.cacheWrite   // đếm riêng
      cacheRead:  += msg.usage.cacheRead }  // KHÔNG cộng vào input
    ▲ không đọc session.state.messages (history mutable — compaction thay array)
    │
    ├─ COMPACTION ──► accumulator SỐNG SÓT (không reset, không mất usage cũ)
    └─ UI / status / analytics đọc lifetimeUsage (không phải per-turn)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core types.ts — TokenUsage { input, output, cacheRead, cacheCreation }
// ✅ packages/core loop.ts — đọc ev.usage turn-end + computeCost (per-turn)
// ✅ packages/print/src/runtimes/pi-in-process.ts — accumulatedUsage từ message_end
//   (đúng pattern nhưng reset mỗi prompt — chưa lifetime)
// ✅ packages/print/src/runtimes/cost-tracker.ts — CostTrackerImpl (per-session)
// ✅ packages/core budget.ts — tree-accounting (spend/release — nền analytics)

// ❌ THIẾU: lifetime accumulator không reset ở prompt boundary
// ❌ THIẾU: cacheRead tách khỏi input (tránh đếm lũy tiến 5-15x)
// ❌ THIẾU: cacheWrite đếm riêng (giống lifetimeUsage { input, output, cacheWrite })
```

## Implementation

```typescript
// packages/core/src/lifetime-usage.ts (NEW)
export interface LifetimeUsage {
  input: number;
  output: number;
  cacheRead: number;    // đếm riêng — KHÔNG cộng vào input
  cacheWrite: number;
  turns: number;
}
/** Accumulator append-only — sống qua compaction vì không đọc history. */
export class LifetimeAccumulator {
  private u: LifetimeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  /** Feed từ message_end/onAssistantUsage — nguồn duy nhất. */
  feed(usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): void {
    this.u.input += usage.input ?? 0;
    this.u.output += usage.output ?? 0;
    this.u.cacheRead += usage.cacheRead ?? 0;      // không trộn vào input
    this.u.cacheWrite += usage.cacheWrite ?? 0;
    this.u.turns++;
  }
  /** Đọc bất kỳ lúc nào — kể cả sau compaction. */
  snapshot(): LifetimeUsage { return { ...this.u }; }
  /** Không reset ở prompt boundary — chỉ reset khi session mới. */
  reset(): void { this.u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }; }
}
// print/runtimes/pi-in-process.ts: thay accumulatedUsage reset-per-prompt
// bằng instance lifetime; turn_end báo cáo snapshot() thay vì per-turn.
// Gateway /status: trả lifetime usage thay vì per-turn tokens.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sống qua compaction — usage không mất khi history bị thay | ❌ Acc không sync với history nếu event bị miss (cần nguồn tin cậy) |
| ✅ Tránh cacheRead lũy tiến 5-15x — input đúng nghĩa | ❌ Phân biệt cacheWrite/cacheRead phụ thuộc provider báo đủ |
| ✅ Chi phí lifecycle chính xác (budget/cost theo lifetime) | ❌ Session dài → số lớn — cần đơn vị hiển thị (K/M token) |
| ✅ Nối CostTracker + budget tree-accounting | ❌ In-memory — cần persist nếu muốn lịch sử |

## Khác các hướng gần

| | AIQ Lifetime Usage | AIV Usage Quota | AJP Tracking Analytics |
|---|---|---|---|
| Trọng tâm | Đếm đúng usage qua compaction | Bảo vệ quota provider | Analytics command |
| Nguồn | message_end events | API calls + file | Command execution |
| Quan hệ | Số liệu gốc cho quota/analytics | Người tiêu thụ usage | Người tiêu thụ usage |

## Khi nào chọn

- Cần token usage chính xác qua compaction (session dài, multi-turn)
- Provider báo cacheRead/cacheWrite — muốn tránh double-count
- Đã có TokenUsage + accumulatedUsage per-turn — nâng thành lifetime
- Guard: nguồn event duy nhất (message_end), không đọc history, cacheRead tách riêng