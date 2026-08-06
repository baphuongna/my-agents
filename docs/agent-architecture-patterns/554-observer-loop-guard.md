# Hướng UH: Observer Loop Guard — throttle + tail-sampling + re-entrancy guard cho vòng lặp tool observation

> **Nguồn gốc:** ECC `pre:observe observe-runner.js` (throttle, tail-sampling, re-entrancy guard); "observe-runner loop", "throttle observation", "tail-sampling to prevent memory explosion", "re-entrancy guard" | **Coupling:** 🟡 — thêm guard vào observation/telemetry loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (telemetry + audit sẵn — chưa có throttle + tail-sampling + re-entrancy guard) | **Effort:** 2-3 tuần

## Nguồn gốc

**ECC** `observe-runner.js` chạy vòng lặp **observation** — liên tục quan sát tool execution (log, metric, trace). Nguy hiểm: vòng lặp quan sát có thể **memory-explosion** — mỗi tool-call sinh observation event, nếu không kiểm soát → event chất đống, processOOM. Ba lớp phòng vệ: (1) **Throttle** — giới hạn tần suất observation (vd max 100 event/giây, dư drop). (2) **Tail-sampling** — không giữ mọi event; giữ **đuôi gần** (recent N) + sample ngẫu nhiên (vd 10%); event cũ + đại trà bị drop, giữ representative. (3) **Re-entrancy guard** — observation trigger tool → tool trigger observation → **đệ quy vô hạn**; guard chặn observation bắt đầu lại khi đang observe (flag `observing=true`). Nguyên tắc: **observe an toàn** — throttle, sample, chặn đệ quy.

## Mô tả

mya observer loop guard: (1) **Observation loop**: mỗi tool-call → event (type, data, ts). (2) **Throttle**: max event/rate → dư drop (đếm token-bucket). (3) **Tail-sampling**: giữ recent-N + random sample%, drop phần còn lại. (4) **Re-entrancy guard**: đang observe → không trigger observe lại (break recursive). mya có telemetry + audit — UH thêm **throttle** + **tail-sampler** + **re-entrancy-guard**.

## Kiến trúc

```
  TOOL-CALL → OBSERVATION EVENT
        │
        ▼
  ┌─── 1. RE-ENTRANCY GUARD ─────────────────────────────────┐
  │  if (observing) return;  // chặn đệ quy observe→tool→obs   │
  │  observing = true;                                         │
  └───────────────────────┬─────────────────────────────────┘
                          │
                          ▼
  ┌─── 2. THROTTLE (token-bucket) ───────────────────────────┐
  │  rate > 100/s? → DROP (giới hạn băng thông)                │
  └───────────────────────┬─────────────────────────────────┘
                          │
                          ▼
  ┌─── 3. TAIL-SAMPLING ─────────────────────────────────────┐
  │  giữ: recent-N (đuôi gần) + random 10% (representative)   │
  │  drop: phần cũ + đại trà → tránh memory explosion         │
  └───────────────────────┬─────────────────────────────────┘
                          │
                          ▼
  ┌─── OBSERVATION BUFFER (bounded, không OOM) ──────────────┐
  │  [e₁, e₂, ..., e₅₀₀] (capped) → audit/telemetry consume  │
  │  observing = false;                                        │
  └────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core telemetry.ts — telemetry (nền — UH observation ở đây)
// ✅ packages/audit — audit trail (nền — UH observation sink)
// ✅ packages/core spill.ts — spill management (nền — UH bounded buffer analog)
// ✅ packages/core budget.ts — budget/limit (nền — UH throttle analog)

// ❌ THIẾU: throttle (token-bucket rate limit)
// ❌ THIẾU: tail-sampler (recent-N + random%)
// ❌ THIẾU: re-entrancy guard (observing flag, break recursion)
```

## Implementation

```typescript
// packages/core/src/observer-loop-guard.ts (MỚI)
interface ObsEvent { type: string; data: unknown; ts: number }

class ObserverLoopGuard {
  private buffer: ObsEvent[] = [];
  private observing = false;
  private tokens: number;
  private lastRefill = 0;

  constructor(
    private maxBuffer: number,     // vd 500 (tail)
    private sampleRate: number,    // vd 0.1 (10% random)
    private maxRate: number,       // vd 100 event/s (throttle)
    private refillMs: number,      // vd 1000
    private now: () => number,
  ) {
    this.tokens = maxRate;
  }

  // re-entrancy guard + throttle + tail-sample
  observe(event: ObsEvent): void {
    if (this.observing) return; // re-entrancy guard
    this.observing = true;
    try {
      this.refillTokens();
      if (this.tokens <= 0) return;        // throttle: drop
      this.tokens--;
      if (Math.random() > this.sampleRate) return; // tail-sample: drop most
      this.buffer.push(event);
      if (this.buffer.length > this.maxBuffer) this.buffer.shift(); // bounded tail
    } finally {
      this.observing = false;
    }
  }

  private refillTokens(): void {
    const t = this.now();
    if (t - this.lastRefill >= this.refillMs) {
      this.tokens = this.maxRate;
      this.lastRefill = t;
    }
  }

  drain(): ObsEvent[] { return this.buffer.splice(0); }
}

// Usage:
// guard.observe({type:'tool-call', data:{tool:'read'}, ts:now()});
// → throttle (100/s) + sample (10%) + re-entrancy-safe + bounded (500)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không memory explosion (bounded + sample) | ❌ Data loss (throttle/sample drop event) |
| ✅ Re-entrancy safe (không đệ quy vô hạn) | ❌ Sampling bias (random có thể miss event quan trọng) |
| ✅ Throttle băng thông (không flood) | ❌ Rate tuning (max-rate chủ quan) |
| ✅ Tail-recent (giữ context gần nhất) | ❌ Observing flag overhead (check mỗi event) |

## Khác các hướng gần

| | Log-everything | Ring-buffer | UH: Observer-Guard |
|---|---|---|---|
| Cái gì | Giữ mọi event | Bounded overwrite | **Throttle + tail-sample + re-entrancy** |
| Memory | ❌ (OOM risk) | ✅ | **✅ (sampled bounded)** |
| Re-entrancy | ❌ (đệ quy) | ❌ | **✅ guard** |

## Khi nào chọn

- Observation/telemetry loop chạy liên tục → nguy cơ memory explosion
- Observation trigger tool → tool trigger observation (đệ quy) → cần representative sample (không log mọi event)
- Nối packages/core telemetry.ts + spill.ts + budget.ts + packages/audit; guard tail-sample-fairness (luôn giữ error event, không chỉ random), throttle-tuning (rate theo throughput thực), và re-entrancy-detection (log khi guard block — phát hiện recursive pattern); UH = observer loop guard, kết hợp 549 UC strategic-compact (compact observation buffer) + packages/core spill (overflow handling)
