# Hướng IB: Behavior Anomaly — phát hiện hành vi agent lệch baseline

> **Nguồn gốc:** Datadog Watchdog "anomaly detection"; RAGAS "agent trajectory analysis"; paper "AgentMonitor: Enable Efficient, Affordable + Real-time Monitoring" (arXiv 2024); Datadog "LLM Observability" + AIOps
> **Coupling:** 🟢 — lớp quan sát ngoài, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit + telemetry sẵn — thiếu baseline profile + anomaly score)
> **Effort:** 2-3 tuần

## Nguồn gốc

Anomaly detection trong AIOps (Datadog Watchdog): học **baseline** từ historical metric (latency, error rate, throughput) rồi flag deviation ngoài normal band. Áp vào LLM agent: **AgentMonitor** (arXiv 2024) — monitor trajectory theo thời gian thực, "efficient + affordable" bằng cách so sánh agent behavior hiện tại với baseline đã học. RAGAS thêm **trajectory analysis** — đánh giá agent theo dõi có "đi lạc" khỏi path bình thường không. Điểm cốt lõi: agent bình thường có *mẫu hành vi* (tool call sequence, token count, duration, success rate); lệch baseline → khả năng prompt injection (200), reward hacking (102), drift (103), hoặc compromise.

Khác **131 watchdog** (EA — kiểm tra *sức khỏe* process: sống/chết/latency) — IB phân tích *hành vi* (pattern hành động có bình thường không). Khác **235 moderation** (IA — lọc *nội dung text*) — IB phát hiện *hành vi bất thường* (gọi tool lạ, token spike, vòng lặp). Nối **103 agent-drift** (drift dần), **200 prompt-injection** (đột ngột lệch = injection), **198 audit** (data source cho baseline).

## Mô tả

mya behavior anomaly: thu thập trajectory từ **audit log (198)** + **telemetry (core/telemetry.ts)** — mỗi turn ghi: tool calls, token count, duration, success/fail, model. Học **baseline profile** (rolling window — median/percentile cho mỗi metric + tool-call pattern frequency). Mỗi turn mới → so sánh với baseline → **anomaly score** (z-score / Mahalanobis). Score cao → alert (227), có thể tự can thiệp (circuit-breaker 42, watchdog restart 131). Ví dụ: agent đột nhiên gọi `shell` 10x trong 1 turn (baseline = 0) → anomaly → có thể bị injection.

## Kiến trúc

```
  AGENT TRAJECTORY (mỗi turn)
   · tool calls: [find, read, edit, shell, shell, shell]  ← spike!
   · tokens: 45k (baseline median 8k)                      ← spike!
   · duration: 120s (baseline 15s)                         ← spike!
   · success: false (baseline 95%)                         ← drop!
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  ANOMALY ENGINE                               │
  │                                               │
  │  BASELINE (rolling 7-day window from 198)     │
  │   · token median, p95                        │
  │   · tool-call frequency distribution          │
  │   · duration percentiles                      │
  │   · success rate                              │
  │                                               │
  │  SCORE: z-score per metric → combined          │
  │   · token: z=4.2  (4.2σ above median!)        │
  │   · shell:  freq 10x vs baseline 0.1x         │
  │   · combined score: 0.97 (HIGH)               │
  └────────┬─────────────────────────────────────┘
           │
     ┌─────┴──────┬──────────────┐
     ▼            ▼              ▼
  ┌────────┐ ┌──────────┐ ┌──────────────┐
  │ ALERT  │ │ CIRCUIT  │ │ ROLLBACK     │
  │ (227)  │ │ BREAKER  │ │ last-good    │
  │ page   │ │ (42)     │ │ (136)        │
  └────────┘ └──────────┘ └──────────────┘
```

```
mya: audit + telemetry stream sẵn — thiếu baseline learner + anomaly scorer
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — append-only event log (trajectory data source)
// ✅ packages/core/src/telemetry.ts — TelemetrySnapshot (per-kind counts + timing)
// ✅ 131 agent-watchdog (EA) — health check (sẵn — nhưng reactive, không học baseline)
// ✅ 103 agent-drift — drift detection (documented)
// ✅ 42 circuit-breaker — auto-stop on repeated failure
// ✅ packages/core/src/iteration-budget.ts — token/iteration caps (hard limit)

// ❌ THIẾU: baseline learner (rolling window median/percentile per metric)
// ❌ THIẾU: anomaly scorer (z-score / Mahalanobis on trajectory)
// ❌ THIẾU: tool-call pattern frequency model (normal sequence distribution)
// ❌ THIẾU: alert integration (anomaly → 227 notification)
```

## Implementation

```typescript
// packages/audit/src/anomaly.ts (NEW)
interface TurnMetrics {
  toolCalls: string[];      // ["find","read","edit","shell"]
  tokenCount: number;
  durationMs: number;
  success: boolean;
}

interface Baseline {
  tokenMedian: number; tokenP95: number;
  durationMedian: number;
  toolFreq: Map<string, number>;   // tool → avg count per turn
  successRate: number;
}

class BehaviorAnomaly {
  private baseline: Baseline | null = null;

  // Learn baseline from audit log (rolling 7-day window)
  learn(history: TurnMetrics[]): void {
    const tokens = history.map(h => h.tokenCount).sort((a,b) => a-b);
    this.baseline = {
      tokenMedian: percentile(tokens, 0.5),
      tokenP95: percentile(tokens, 0.95),
      durationMedian: percentile(history.map(h => h.durationMs), 0.5),
      toolFreq: avgToolFreq(history),
      successRate: history.filter(h => h.success).length / history.length,
    };
  }

  score(turn: TurnMetrics): number {
    if (!this.baseline) return 0;
    const zToken = zScore(turn.tokenCount, this.baseline.tokenMedian, this.baseline.tokenP95);
    const shellSpike = (turn.toolCalls.filter(t => t === "shell").length) /
                       (this.baseline.toolFreq.get("shell") ?? 0.1);
    // combined anomaly score [0,1]
    return clamp(0.5 * sigmoid(zToken) + 0.5 * sigmoid(shellSpike - 3));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện injection/drift/hack sớm (AgentMonitor) | ❌ Cần historical data (cold start — chưa có baseline) |
| ✅ Proactive — trước khi hại xảy ra | ❌ False positive (behavior hợp lệ nhưng hiếm) |
| ✅ Data-driven (học, không hardcode rule) | ❌ Baseline drift (concept drift — relearn) |
| ✅ Audit + telemetry stream sẵn (1 phần) | ❌ Compute cost (rolling window stats) |

## Khác các hướng gần

| | 131 Watchdog (EA) | 103 Drift | IB: Behavior Anomaly |
|---|---|---|---|
| Mục | Sức khỏe process | Drift dần dài hạn | **Lệch baseline real-time** |
| Cách | Probe + healthcheck | Trend analysis | **Statistical scoring** |
| Data | Live probe | History | **Trajectory vs baseline** |

## Khi nào chọn

- Agent chạy autonomous dài hạn (cần phát hiện lệch sớm)
- Lo ngại prompt injection / compromise / reward hacking (200, 102)
- Có đủ historical trajectory để học baseline
- Muốn alert chủ động trước khi hại xảy ra (nối 131 EA + 42 circuit-breaker)
