# Hướng AGP: Transcript Bounded Store — bash transcript store ghi command + output với enforceMaxLines/MaxBytes, truncate command cũ để session shell không phình vô hạn

> **Nguồn gốc:** pi-powerline-footer | **Coupling:** 🟢 — storage layer thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có spill.ts truncation + session JSONL, nhưng KHÔNG có bounded transcript store cho shell) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-powerline-footer** lưu bash transcript (command + output) trong một store **bounded**: mỗi entry đếm `totalLines`/`totalBytes` tích lũy; khi vượt ngưỡng (`enforceMaxLines`/`enforceMaxBytes`), **truncate command cũ nhất** (FIFO eviction) cho tới khi nằm trong budget. Mục tiêu: session shell chạy lâu không phình file vô hạn (memory leak / disk bloat). Truncate theo cả dòng VÀ byte — đảm bảo cả 2 ràng buộc được tôn trọng.

Nguyên tắc: **bounded store** (có cap lines + bytes); **FIFO eviction** (bỏ cũ nhất trước); **đếm tích lũy** (totalLines/totalBytes cập nhật mỗi write); **session shell không phình vô hạn**.

## Mô tả

Với mya, packages/core có `spill.ts` (truncate payload lớn `[TRUNCATED: ... MAX_SPILL_BYTES]`) và session JSONL, nhưng **chưa có** bounded transcript store chuyên cho shell history với: (1) **enforceMaxLines + enforceMaxBytes** song song, (2) **FIFO eviction** command cũ khi vượt cap, (3) **đếm tích lũy** totalLines/totalBytes. Pattern này quan trọng cho tool `bash` chạy lâu — transcript phình nhanh nếu không cap.

## Kiến trúc (ASCII)

```
  bash(cmd) → push {cmd, output, lines, bytes}
                    │
                    ▼
  totalLines += lines; totalBytes += bytes
                    │
                    ▼
  ┌─ totalLines > MAX_LINES  OR  totalBytes > MAX_BYTES? ─┐
  │ YES → shift() (xóa entry cũ nhất)                      │
  │       → totalLines -= old.lines; totalBytes -= old.bytes│
  │       → lặp tới khi trong budget                        │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/spill.ts — truncate payload lớn (MAX_SPILL_BYTES, line 84-90)
// ✅ packages/core/src/session.ts — session JSONL append
// ✅ packages/memory/src/backends.ts — FileBackend append-only markdown
// ⚠️ KHÔNG có bounded transcript store (enforceMaxLines + enforceMaxBytes + FIFO)
// ❌ KHÔNG có totalLines/totalBytes tích lũy + eviction command cũ
```

## Implementation

```typescript
// packages/tools/src/transcript-store.ts (NEW)
export interface TranscriptEntry { cmd: string; output: string; lines: number; bytes: number; at: number; }

export class BoundedTranscript {
  private entries: TranscriptEntry[] = [];
  private totalLines = 0;
  private totalBytes = 0;

  constructor(
    private readonly maxLines = 10_000,
    private readonly maxBytes = 2 * 1024 * 1024,   // 2 MiB
  ) {}

  push(cmd: string, output: string, at = Date.now()): void {
    const lines = output.split("\n").length;
    const bytes = Buffer.byteLength(cmd + output, "utf8");
    const entry: TranscriptEntry = { cmd, output, lines, bytes, at };
    this.entries.push(entry);
    this.totalLines += lines; this.totalBytes += bytes;
    this.enforce();
  }

  private enforce(): void {
    while (this.entries.length > 0 && (this.totalLines > this.maxLines || this.totalBytes > this.maxBytes)) {
      const old = this.entries.shift()!;            // FIFO: bỏ cũ nhất trước
      this.totalLines -= old.lines;
      this.totalBytes -= old.bytes;
    }
  }

  snapshot(): readonly TranscriptEntry[] { return this.entries; }
  stats(): { lines: number; bytes: number; count: number } {
    return { lines: this.totalLines, bytes: this.totalBytes, count: this.entries.length };
  }
}
// bash tool → transcript.push(cmd, stdout); không bao giờ phình vô hạn.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Session shell không phình vô hạn | ❌ Mất history cũ khi vượt cap (FIFO) |
| ✅ Cap cả dòng VÀ byte (2 ràng buộc) | ❌ Đếm từng entry (overhead nhẹ) |
| ✅ Đếm tích lũy → biết total ngay | ❌ Output khổng lồ 1 entry có thể vượt cap ngay |

## Khác các hướng gần

| | AGP Transcript Bounded | AHB Git-Backed Memory | AGS Singleton |
|---|---|---|---|
| Trọng tâm | Cap shell history | Memory markdown version-controlled | Chia sẻ 1 instance |
| Cơ chế | FIFO eviction + cap | Git commit per project | globalThis Symbol.for |
| Quan hệ | Nối storage bounded | Nối memory persistence | Nối instance sharing |

## Khi nào chọn

- Tool `bash` chạy lâu — transcript phình nhanh nếu không cap
- Cần bounded store theo cả dòng và byte
- Muốn FIFO eviction (cũ nhất ra trước) cho history shell
- Guard: maxLines + maxBytes song song, đếm tích lũy, enforce sau mỗi push
