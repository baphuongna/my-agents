# Hướng TX: Debounced Memory Queue — queue tin nhắn vào batch debounce 30s, LLM extract fact ngoài luồng rồi ghi atomically

> **Nguồn gốc:** deer-flow `src/memory/` (`MemoryMiddleware`, memory queue, debounce window), atomic temp-file + rename pattern; "queue user+final-AI messages", "debounce 30s batch", "LLM extract facts off the hot loop", "atomic write temp+rename" | **Coupling:** 🟢 — thêm memory middleware debounce queue vào message pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (memory store sẵn — chưa có debounce queue + off-loop extract + atomic rename) | **Effort:** 2-3 tuần

## Nguồn gốc

**deer-flow** có `MemoryMiddleware` đứng giữa message pipeline. Khi user gửi tin và AI trả lời final, middleware **không extract fact ngay** — mà **queue** hai loại message (user input + final AI output) vào hàng đợi, rồi **debounce 30s**: đợi cửa sổ im lặng (30 giây không có message mới) trước khi batch xử lý. Khi timer fire, batch message được gửi cho LLM **ngoài luồng chính** (off-loop, không block agent turn), LLM extract facts/context (đóng gói thông tin quan trọng), kết quả **ghi atomically** — viết temp-file rồi `rename` (POSIX atomic rename) — đảm bảo không bao giờ có file nửa vời. Nguyên tắc: **extract chậm nhưng đúng lúc** (debounce gom đủ context), **không block luồng** (off-loop), **ghi toàn-or-không** (atomic).

## Mô tả

mya debounced memory queue: (1) **Queue**: mỗi user message + final AI message → push vào queue (timestamp). (2) **Debounce 30s**: timer reset mỗi khi message mới đến; chỉ fire sau 30s im lặng. (3) **Off-loop extract**: timer fire → batch message → LLM extract facts (ngoài agent turn, không delay user). (4) **Atomic write**: facts → temp-file → `rename` (không nửa vời). mya có memory store + pipeline — TX thêm **message queue** + **debounce timer** + **off-loop extractor** + **atomic-writer**.

## Kiến trúc

```
  user msg ──┐                              final AI msg ──┐
             ▼                                             ▼
  ┌─── MEMORY QUEUE (push + timestamp) ─────────────────────────┐
  │  [{role:user, ...}, {role:ai, ...}, {role:user, ...}, ...]    │
  └────────────────────────┬───────────────────────────────────┘
                           │ (debounce 30s — reset mỗi message mới)
                           ▼
  ┌─── DEBOUNCE TIMER (off-loop) ──────────────────────────────┐
  │  30s im lặng → FIRE → batch toàn queue                       │
  └────────────────────────┬───────────────────────────────────┘
                           │ (LLM extract — ngoài agent turn)
                           ▼
  ┌─── EXTRACT (LLM off-loop) ──────────────────────────────────┐
  │  batch → LLM → facts: ["user thích dark mode", "dùng Rust"]   │
  └────────────────────────┬───────────────────────────────────┘
                           │ (atomic write: temp + rename)
                           ▼
  ┌─── ATOMIC PERSIST ──────────────────────────────────────────┐
  │  write facts.tmp → rename → facts.json (POSIX atomic)         │
  │  → không bao giờ nửa vời                                      │
  └────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory brain-store — durable store (nền — TX ghi facts vào đây)
// ✅ packages/memory pipeline.ts — memory pipeline (nền — TX queue ở đây)
// ✅ packages/agent subagent — off-loop work (nền — TX extract ngoài turn)
// ✅ core.time — deterministic timer (nền — TX debounce timestamp)

// ❌ THIẾU: message queue (push user+final-AI msg, timestamp)
// ❌ THIẾU: debounce timer (reset-on-message, fire after 30s idle)
// ❌ THIẾU: off-loop extractor (batch → LLM → facts)
// ❌ THIẾU: atomic-writer (temp-file + rename, POSIX)
```

## Implementation

```typescript
// packages/memory/src/debounced-memory-queue.ts (MỚI)
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

interface QueuedMessage { role: string; content: string; ts: number }

class DebouncedMemoryQueue {
  private queue: QueuedMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private now: () => number,
    private debounceMs: number,                                          // 30_000
    private extract: (batch: QueuedMessage[]) => Promise<string[]>,      // LLM off-loop
    private factsPath: string,
  ) {}

  enqueue(role: string, content: string): void {
    this.queue.push({ role, content, ts: this.now() });
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);              // drain
    const facts = await this.extract(batch);          // off-loop LLM
    const tmp = `${this.factsPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ facts, ts: this.now() }, null, 2), 'utf8');
    renameSync(tmp, this.factsPath);                  // POSIX atomic
  }
}

// Usage:
// mem.enqueue('user', 'tôi dùng Rust cho backend');
// mem.enqueue('ai', 'đã tạo Rust project ...');
// → 30s im lặng → batch → LLM extract → atomic rename → facts.json
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không block agent turn (extract off-loop) | ❌ Debounce delay (fact trễ 30s) |
| ✅ Batch đủ context (gom nhiều message → extract chính xác hơn) | ❌ Timer leak nếu không clear (process exit) |
| ✅ Atomic write (không nửa vời) | ❌ LLM cost (extract mỗi batch) |
| ✅ Idle-trigger (chỉ extract khi im lặng, không spam) | ❌ Crash giữa extract → mất batch (cần retry) |

## Khác các hướng gần

| | Sync extract (moi) | Background dream-cycle | TX: Debounced-Queue |
|---|---|---|---|
| Cái gì | Extract ngay mỗi message | Extract định kỳ async | **Debounce queue → off-loop extract** |
| Block luồng | ✅ (sync) | ❌ | **❌ (off-loop)** |
| Timing | Ngay | Định kỳ | **Idle-gated (30s im lặng)** |

## Khi nào chọn

- Agent có nhiều message liên tiếp → extract từng cái tốn kém/sai
- Muốn fact chính xác (gom đủ context mới extract)
- Không muốn block agent turn (extract off-loop)
- Nối packages/memory pipeline.ts + brain-store + core.time (deterministic debounce); guard timer cleanup (clear trên process exit/abort), crash-recovery (retry batch nếu extract fail), và atomic-correctness (temp trong cùng filesystem để rename atomic); TX = debounced memory queue, kết hợp 547 UA memory-persistence-hooks (persist qua session lifecycle) + dream-cycle (định kỳ consolidate facts)
