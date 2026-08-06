# Hướng ACC: Overflow Recovery Grace Period — hai giai đoạn chờ: grace ngắn (5s) cho agent_end terminal đầu tiên sau prompt() resolve, rồi mới full recovery timeout (120s)

> **Nguồn gốc:** pi-crew (extension/runtime/overflow-recovery.ts) | **Coupling:** 🟡 — thêm 2-pha recovery vào turn lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có runTurn + preflight — chưa có overflow recovery tracker) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew** `OverflowRecoveryTracker` dùng **hai giai đoạn chờ**: (1) **grace period ngắn (5s)** — sau khi `prompt()` resolve, chờ `agent_end` terminal **đầu tiên** trong vòng 5s; (2) nếu không thấy → **full recovery timeout (120s)** — chờ tối đa 120s cho agent_end. Mục đích: **tránh false-positive** — agent kết thúc tự nhiên nhưng events (agent_end) về **muộn** (network lag, provider delay) — nếu recovery timeout quá ngắn (chỉ 5s) sẽ tưởng lỗi overflow và khởi động recovery nhầm. Grace ngắn bao phủ case phổ biến (agent_end về trong 5s), full timeout bao phủ case muộn. Nguyên tắc: **2-pha chờ — grace ngắn cho agent_end sớm (tránh false positive), full timeout cho agent_end muộn (không bỏ cuộc sớm)**.

## Mô tả

mya overflow recovery grace period: sau khi `prompt()` resolve, `OverflowRecoveryTracker` chờ agent_end qua **2 giai đoạn**: (1) **grace 5s** — agent_end trong 5s → turn kết thúc bình thường (không recovery); (2) hết 5s chưa thấy → **full recovery timeout 120s** — chờ thêm tới 120s; agent_end tới trong khoảng này → turn kết thúc (dù muộn); quá 120s → **recovery** (coi là overflow). mya có packages/core loop.ts (runTurn + terminal states) + preflight (context overflow check) — ACC thêm **recovery tracker 2-pha** (grace + full timeout) + **terminal detection** (agent_end theo dõi).

## Kiến trúc

```
  prompt() RESOLVE (agent gọi xong — chờ terminal)
       │
       ▼
  OVERFLOW RECOVERY TRACKER (2-pha chờ)
  ┌──────────────────────────────────────────────────┐
  │  PHA 1 — GRACE PERIOD (5s)                       │
  │    agent_end trong 5s ──► turn kết thúc (bình thường)│
  │    (không recovery — tránh false positive)       │
  │                                                  │
  │  hết 5s chưa thấy agent_end ──►                  │
  │                                                  │
  │  PHA 2 — FULL RECOVERY TIMEOUT (120s)            │
  │    agent_end trong 120s ──► turn kết thúc (muộn) │
  │    quá 120s ──► RECOVERY (coi là overflow)       │
  └──────────────────────────────────────────────────┘
  → agent_end sớm: không false-positive
  → agent_end muộn: không bỏ cuộc sớm
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core loop.ts — runTurn + TurnTerminal (nền — ACC terminal states)
// ✅ packages/core session-utils.ts — preflightContextWindow (nền — ACC overflow context)
// ✅ packages/agent index.ts — agent turn lifecycle (nền — ACC prompt() resolve)
// ✅ packages/core time.ts — nowWallclock + invariant-time (nền — ACC timeout đo)

// ❌ THIẾU: recovery tracker (2-pha chờ — grace + full timeout)
// ❌ THIẾU: agent_end terminal detection (theo dõi terminal event riêng)
// ❌ THIẾU: recovery trigger (quá 120s → khởi động overflow recovery)
```

## Implementation

```typescript
// packages/core/src/overflow-recovery.ts (MỚI)
import { nowWallclock } from "./time.js";

export type RecoveryOutcome =
  | { kind: "ended"; waitMs: number }          // agent_end tới trong grace/full
  | { kind: "recovered"; waitMs: number };     // quá full timeout → overflow recovery

const GRACE_MS = 5000;   // grace ngắn: agent_end sớm (tránh false positive)
const FULL_MS = 120_000; // full recovery timeout: agent_end muộn

/** Overflow recovery tracker — 2-pha chờ agent_end terminal. */
export class OverflowRecoveryTracker {
  private terminalSeen = false;

  /** Đăng ký: agent_end terminal đầu tiên → đánh dấu đã kết thúc. */
  onTerminal(): void { this.terminalSeen = true; }

  /** Chờ terminal qua 2 pha: grace 5s → full 120s. */
  async waitForTerminal(promptResolvedAt: number): Promise<RecoveryOutcome> {
    // PHA 1: GRACE 5s — agent_end trong 5s → kết thúc bình thường
    const graceEnd = promptResolvedAt + GRACE_MS;
    while (nowWallclock() < graceEnd) {
      if (this.terminalSeen) return { kind: "ended", waitMs: nowWallclock() - promptResolvedAt };
      await sleep(100);
    }
    if (this.terminalSeen) return { kind: "ended", waitMs: nowWallclock() - promptResolvedAt };

    // PHA 2: FULL 120s — agent_end muộn vẫn được chờ (không bỏ cuộc sớm)
    const fullEnd = promptResolvedAt + FULL_MS;
    while (nowWallclock() < fullEnd) {
      if (this.terminalSeen) return { kind: "ended", waitMs: nowWallclock() - promptResolvedAt };
      await sleep(500);
    }
    return { kind: "recovered", waitMs: nowWallclock() - promptResolvedAt }; // quá 120s → recovery
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// Usage:
// const tracker = new OverflowRecoveryTracker();
// const resolvedAt = nowWallclock();
// turnEvents.on("terminal", () => tracker.onTerminal());
// const outcome = await tracker.waitForTerminal(resolvedAt);
// outcome.kind === "ended"     // agent_end tới (sớm hoặc muộn) — turn kết thúc bình thường
// outcome.kind === "recovered" // quá 120s — thật sự overflow → khởi động recovery
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không false-positive (agent_end muộn 3s không bị tưởng overflow) | ❌ Chờ lâu (agent_end thật sự mất → chờ 120s) |
| ✅ Không bỏ cuộc sớm (agent_end muộn 60s vẫn được chờ) | ❌ 2 timeout phải tune (5s/120s — phụ thuộc provider latency) |
| ✅ Phân biệt rõ (ended vs recovered — outcome có kind) | ❌ Terminal miss (agent_end không bao giờ emit → luôn recovery) |
| ✅ Đo được waitMs (metric — biết agent_end chậm bao nhiêu) | ❌ Poll loop (sleep 100/500ms — nhẹ nhưng thêm code) |

## Khác các hướng gần

| | Chờ 1 timeout ngắn (5s) | Chờ 1 timeout dài (120s) | ACC: 2-Pha Grace |
|---|---|---|---|
| agent_end 3s | false-positive recovery | chờ phí | **grace 5s → ended** |
| agent_end 60s | recovery nhầm | chờ được | **full → ended** |
| Thật sự overflow | recovery nhanh | chờ 120s mới recovery | **chờ 120s (đổi chậm lấy chắc)** |
| Latency nhận | tune 1 số | tune 1 số | **2 số (grace + full)** |

## Khi nào chọn

- Agent kết thúc tự nhiên nhưng events về muộn (provider/network lag) — hay false-positive overflow
- Muốn phân biệt "kết thúc muộn" và "thật sự kẹt" (không recovery nhầm)
- Đã có runTurn + terminal states (packages/core loop.ts) — chỉ thêm tracker
- Nối packages/core loop.ts + session-utils.ts (preflight) + time.ts; guard timeout-calibration (5s/120s theo latency provider thật), terminal-source (agent_end từ đúng nguồn — không lẫn với event khác), và recovery-action (recovered → hành động rõ: compact/retry — không im lặng); ACC = overflow recovery grace period, kết hợp 756 ACB delivery-coordinator-flush (agent_end qua coordinator — defer đúng thứ tự) + 100 prompt-compression (recovery → compact context)
