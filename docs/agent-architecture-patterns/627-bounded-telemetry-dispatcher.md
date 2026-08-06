# Hướng XC: Bounded Telemetry Dispatcher — telemetry MLflow chạy pipeline async có queue giới hạn 100, backpressure drop event cũ; llmPayload off/summary/full

> **Nguồn gốc:** rpiv-mono (telemetry dispatcher); "MLflow pipeline async", "queue limit 100, backpressure drop oldest", "llmPayload off/summary/full" | **Coupling:** 🟡 — thêm async telemetry dispatcher có bound | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (telemetry + audit sẵn — chưa có bounded async queue + backpressure + llmPayload mode) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** đẩy telemetry về **MLflow** qua pipeline **async** (không block agent loop — fire và queue). Bảo vệ 3 lớp: (1) **Queue giới hạn 100** — buffer event tối đa 100, không phình memory. (2) **Backpressure drop oldest** — khi queue đầy, **drop event cũ nhất** (FIFO overwrite) → event mới vẫn vào, cũ bị hy sinh (ưu tiên recent). (3) **llmPayload mode** ∈ {off, summary, full} — kiểm soát payload LLM log: off (không log payload), summary (chỉ metadata/token count), full (log toàn bộ prompt/response) — cân bằng observability vs privacy/cost. Nguyên tắc: **telemetry không bao giờ block** + **bound memory** + **payload control**.

## Mô tả

mya bounded telemetry dispatcher: (1) event enqueue vào async queue (cap 100). (2) worker async drain queue → đẩy sink (MLflow/audit). (3) queue đầy → drop oldest (backpressure). (4) llmPayload mode quyết định log gì. mya có telemetry + audit — XC thêm **bounded async queue** + **backpressure drop** + **llmPayload mode**.

## Kiến trúc

```
  TELEMETRY EVENT (tool-call, llm, ...)
        │
        ▼
  ┌─── ASYNC QUEUE (cap 100) ────────────────────────────┐
  │  [e₁, e₂, ..., e₁₀₀]                                   │
  │  enqueue: queue đầy? → DROP oldest (e₁ out) → push e₁₀₁ │  ← backpressure
  └───────────────────────┬───────────────────────────────┘
                          │ (worker async drain, không block agent)
                          ▼
  ┌─── llmPayload FILTER ─────────────────────────────────┐
  │  mode=off     → skip payload                           │
  │  mode=summary → { tokens, model } (metadata only)      │
  │  mode=full    → { prompt, response } (toàn bộ)         │
  └───────────────────────┬───────────────────────────────┘
                          ▼
  ┌─── SINK (MLflow / audit) ─────────────────────────────┐
  │  async write (best-effort, không block agent loop)     │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core telemetry.ts — telemetry (nền — XC event ở đây)
// ✅ packages/audit — audit sink (nền — XC sink)
// ✅ 554 UH observer-loop-guard — bounded sample (relate)

// ❌ THIẾU: async bounded queue (cap 100)
// ❌ THIẾU: backpressure drop oldest
// ❌ THIẾU: llmPayload mode (off/summary/full)
```

## Implementation

```typescript
// packages/core/src/telemetry-dispatcher.ts (MỚI)
interface TelemetryEvent { type: string; data: unknown; ts: number }
type LlmPayloadMode = "off" | "summary" | "full";

class BoundedTelemetryDispatcher {
  private queue: TelemetryEvent[] = [];
  private dropped = 0;
  constructor(private cap: number, private mode: LlmPayloadMode, private sink: (e: TelemetryEvent) => Promise<void>) {}

  // enqueue (backpressure: drop oldest khi đầy)
  emit(event: TelemetryEvent): void {
    event = this.filterPayload(event); // llmPayload mode
    if (this.queue.length >= this.cap) { this.queue.shift(); this.dropped++; } // drop oldest
    this.queue.push(event);
    void this.drain(); // async, không block
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const e = this.queue.shift()!;
      try { await this.sink(e); }
      catch { /* best-effort, không block agent */ }
    }
  }

  // llmPayload filter
  private filterPayload(e: TelemetryEvent): TelemetryEvent {
    if (e.type !== "llm") return e;
    if (this.mode === "off") return { type: "llm", data: null, ts: e.ts };
    if (this.mode === "summary") return { type: "llm", data: { model: (e.data as any)?.model, tokens: (e.data as any)?.tokens }, ts: e.ts };
    return e; // full
  }

  stats(): { pending: number; dropped: number } { return { pending: this.queue.length, dropped: this.dropped }; }
}

// Usage:
// const disp = new BoundedTelemetryDispatcher(100, "summary", sinkToMLflow);
// disp.emit({ type: "tool-call", data: {...}, ts: now() }); // async, không block
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không block agent (async queue + drain) | ❌ Drop event (backpressure mất event cũ) |
| ✅ Bounded memory (cap 100, không OOM) | ❌ Best-effort (sink fail silent) |
| ✅ Payload control (off/summary/full) | ❌ Mode tuning (full tốn storage/privacy) |
| ✅ Backpressure ưu tiên recent (drop oldest) | ❌ Drop bias (event cũ lost, có thể quan trọng) |

## Khác các hướng gần

| | Sync telemetry | Unbounded async | XC: Bounded-Dispatcher |
|---|---|---|---|
| Block agent | ✅ (sync) | ❌ | **❌ async** |
| Memory | bounded | ❌ OOM risk | **✅ cap 100** |
| Payload | all | all | **✅ off/summary/full** |

## Khi nào chọn

- Telemetry về external sink (MLflow) cần async, không block agent loop
- Cần bound memory (cap queue) + backpressure drop + payload control
- Nối packages/core telemetry.ts + packages/audit + 554 UH observer-loop-guard; guard drop-priority (ưu tiên giữ error/critical event, không chỉ random oldest), sink-retry (best-effort nhưng retry giới hạn), và mode-privacy-default (default summary, không full trừ config rõ); XC = bounded telemetry dispatcher, kết hợp 554 UH observer-loop-guard (throttle + sample) + packages/core telemetry.ts (event source)
