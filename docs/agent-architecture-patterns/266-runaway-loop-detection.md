# Hướng JF: Runaway Loop Detection — phát hiện vòng lặp vô hạn/dao động

> **Nguồn gốc:** "Livelock/Livelock detection"; "Oscillation in feedback systems"; actor mailbox overflow; circuit-breaker (42); "Infinite loop guard" (203); control theory stability
> **Coupling:** 🟡 — chạm agent loop + telemetry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (203 retry-limit + 42 circuit-breaker sẵn — thiếu oscillation/loop-signature detect)
> **Effort:** 2-3 tuần

## Nguồn gốc

Runaway loop: agent **lặp vô hạn hoặc dao động** — gọi cùng tool, cùng lỗi, sửa rồi hỏng rồi sửa. Livelock (vs deadlock): process hoạt động nhưng không tiến — 2 agent nhường nhau mãi. Oscillation (control theory): feedback loop dao động — A tăng → B giảm → A tăng... không converge. Nguyên nhân: (1) retry vô hạn khi lỗi không tự hết (203); (2) 2 agent mutually-blocking (đợi nhau); (3) LLM sửa code → test fail → sửa ngược → fail khác → loop; (4) reward signal feedback. Phát hiện: **loop signature** (hash state — thấy lặp), **cycle detection** (graph cycle), **progress metric** (no forward progress sau N steps).

## Mô tả

mya runaway detection: theo dõi agent loop — hash mỗi step state, detect lặp (cùng hash sau N step = loop). Hoặc: progress metric (task complete% không tăng sau 5 step → stuck). Oscillation: 2 subagent ping-pong message không dừng → cycle detect. Khi phát hiện → circuit-breaker (42) trip, DLQ (HW 231) quarantine, escalation (46) nhủ người. Nối IU (255) emergent-detection: runaway = 1 dạng emergent anomaly. Nối 203 retry: hard cap retry + loop detect.

## Kiến trúc

```
  AGENT LOOP: edit→test→edit→test... hashes: h1,h2,h1,h2,h1 → CYCLE!
  ┌──────────────────────────────────────────────────────┐
                     │ detect cycle (hash repeats)
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  RUNAWAY DETECTOR                                     │
  │  1. STATE-HASH HISTORY: [h1,h2,h1,h2,h1] → cycle!    │
  │  2. PROGRESS METRIC: complete% flat 5 steps → stuck   │
  │  3. TOOL-REPEAT: same tool call x10 → flag            │
  │  4. OSCILLATION: 2 agents ping-pong → cycle detect    │
  └──────────────────┬───────────────────────────────────┘
                     │ runaway detected
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ CIRCUIT   │          │ DLQ (HW 231)     │
  │ BREAKER 42│          │ quarantine task  │
  │ → trip    │          │ → alert (227)    │
  │ → esc (46)│          │ "stopped"        │
  └───────────┘          └──────────────────┘
```

```
mya: 203 retry-limit + 42 circuit-breaker sẵn — thiếu: state-hash cycle detect + progress metric + oscillation detect
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 203 failure-detection-retry-loops — hard retry cap (sẵn)
// ✅ 42 circuit-breaker — stop on repeated fail (sẵn)
// ✅ HW (231) dead-letter-queue — quarantine (documented)
// ✅ 46 escalation-tree — escalate (sẵn)
// ✅ IU (255) emergent-detection — anomaly base (documented)

// ❌ THIẾU: state-hash history (cycle detection)
// ❌ THIẾU: progress metric (flat = stuck)
// ❌ THIẾU: tool-repeat counter (same call x N)
// ❌ THIẾU: oscillation detect (2-agent ping-pong)
```

## Implementation

```typescript
// packages/runtime/src/runaway.ts (NEW)
import { createHash } from "node:crypto";

export class RunawayDetector {
  private history: string[] = [];      // state-hash per step
  private lastProgress = -1;
  private flatSteps = 0;
  private toolCounts = new Map<string, number>();

  constructor(
    private maxRepeats = 3,      // same hash seen N times = loop
    private maxFlat = 5,         // no progress N steps = stuck
    private maxToolRepeat = 10,  // same tool N times = flag
  ) {}

  // Called each agent step
  check(state: AgentState, progress: number, toolName: string): Runaway | null {
    // 1. State-hash cycle detection
    const hash = sha(JSON.stringify(state));
    this.history.push(hash);
    const repeats = this.history.filter((h) => h === hash).length;
    if (repeats >= this.maxRepeats) return { kind: "cycle", hash };

    // 2. Progress metric — flat = stuck
    if (progress <= this.lastProgress) this.flatSteps++; else this.flatSteps = 0;
    this.lastProgress = progress;
    if (this.flatSteps >= this.maxFlat) return { kind: "stuck", flatSteps };

    // 3. Tool-repeat counter
    this.toolCounts.set(toolName, (this.toolCounts.get(toolName) ?? 0) + 1);
    if (this.toolCounts.get(toolName)! >= this.maxToolRepeat) return { kind: "tool-repeat", toolName };

    return null;
  }

  async onRunaway(r: Runaway): Promise<void> {
    await circuitBreaker.trip();      // 42
    await dlq.quarantine(r);          // HW 231
    await notify("runaway-detected", r); // 227
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dừng vòng lặp vô hạn (tiết kiệm token) | ❌ False positive (legitimate retry loop) |
| ✅ Phát hiện dao động (control theory) | ❌ State-hash collision (different state same hash) |
| ✅ Progress metric — biết stuck chính xác | ❌ Hash overhead per step |
| ✅ Nối 42 circuit-breaker + HW (231) DLQ | ❌ Tuning thresholds (maxRepeats/maxFlat) |

## Khác các hướng gần

| | 203 Retry Loops | 42 Circuit-Breaker | JF: Runaway Detect |
|---|---|---|---|
| Mục | Cap retry count | Stop on fail-rate | **Detect loop/oscillation** |
| Detect | Counter | Failure rate | **State-hash cycle + progress** |
| Livelock | ❌ | ❌ | ✅ |

## Khi nào chọn

- Agent lặp vô hạn (edit→fail→edit→fail)
- 2 subagent dao động (mutually blocking)
- Cần tiết kiệm token (dừng loop sớm)
- Nối IU (255) emergent + 203 retry + 42 circuit-breaker + HW (231) DLQ
