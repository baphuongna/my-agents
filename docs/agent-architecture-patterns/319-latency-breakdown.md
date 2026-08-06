# Hướng LG: Latency Breakdown — phân tích độ trễ theo stage, gán LLM/tool/model

> **Nguồn gốc:** Distributed tracing (OpenTelemetry); "critical path analysis" (CPM); flame graphs (Brendan Gregg); latency attribution; "Time to First Token" (TTFT); service-level SLO budget
> **Coupling:** 🟢 — instrumentation layer, không đổi logic
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (agent-loop + provider + tool-call sẵn — thiếu per-stage timing + budget attribution + flame graph)
> **Effort:** 2-3 tuần

## Nguồn gốc

Distributed tracing (OTel): mỗi operation = span (start/end) → đo latency + gán cho service. Flame graph (Gregg): stack visual — chiều ngang = time, thấy function nào tốn nhiều nhất. **TTFT** (Time to First Token): LLM metric — độ trễ đến token đầu (vs total). Latency attribution: total = LLM + tool + queue + network → **phân** xem ai tốn bao nhiêu. SLO budget: SLA = 5s → mỗi stage có "budget" → vượt → alert. Critical path (CPM): chỉ stage trên đường dài nhất mới ảnh hưởng total. Cốt lõi: **total latency không nói gì** — phải phân theo stage → biết đâu slow → tối ưu đúng chỗ.

## Mô tả

mya latency breakdown: mỗi agent turn → đo **per-stage** timing: (1) **queue** (chờ trước gọi LLM), (2) **LLM generate** (TTFT + total), (3) **tool exec** (per tool), (4) **serialize/network**. Attribution: gán cho LLM-model (provider), tool-name, stage. Output: breakdown bar (LLM 60%, tool 30%, queue 10%) + critical path. Nối LF (318) token-trace (span timing), 320 cost-per-step (cost cũng breakdown), 178 dynamic-routing (route ảnh hưởng latency).

## Kiến trúc

```
  TURN TOTAL: 3.2s
   │
   │  BREAKDOWN:
   ├─ queue (wait):       0.2s  (6%)   ▓▓
   ├─ LLM generate:       2.1s  (66%)  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
   │    ├ TTFT:           0.8s         (first token)
   │    └ stream rest:    1.3s
   ├─ tool.read:          0.3s  (9%)   ▓▓▓
   ├─ tool.test (vitest): 0.5s  (16%)  ▓▓▓▓▓▓
   └─ serialize/net:      0.1s  (3%)   ▓

  ATTRIBUTION:
  ┌──────────────────────────────────────────────┐
  │ by model:  gpt-4o → 2.1s (66%)               │
  │ by tool:   read → 0.3s, test → 0.5s          │
  │ by stage:  LLM dominant → optimize model/route│
  └──────────────────────────────────────────────┘

  CRITICAL PATH: queue→LLM→test = 2.8s (read is parallel, not on path)
  BOTTLENECK: LLM (66%) → route to faster model (178) or cache (166)
```

```
mya: agent-loop + provider + tool-call sẵn — thiếu per-stage timing + attribution + critical path
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — agent-loop (sẵn)
// ✅ 2-providers — LLM call (sẵn)
// ✅ 3-tools — tool-call (sẵn)
// ✅ 178 dynamic-model-routing — route affects latency (documented)

// ❌ THIẾU: per-stage timing (queue, TTFT, tool, net)
// ❌ THIẾU: attribution (by model / by tool / by stage)
// ❌ THIẾU: critical path (which stages on longest chain)
// ❌ THIẾU: breakdown visual (bar + flame graph)
```

## Implementation

```typescript
// packages/agent/src/latency.ts (NEW)
interface StageTiming { stage: string; kind: "queue"|"llm"|"tool"|"net"; model?: string; tool?: string; ms: number; parallel: boolean; deps: string[]; }

export class LatencyBreakdown {
  private stages: StageTiming[] = [];
  record(s: StageTiming): void { this.stages.push(s); }

  // Total = critical path (longest dependency chain, not sum of parallel)
  total(): number {
    const memo = new Map<string, number>();
    const byStage = new Map(this.stages.map((s) => [s.stage, s]));
    const longest = (name: string): number => {
      if (memo.has(name)) return memo.get(name)!;
      const s = byStage.get(name)!;
      const depMax = Math.max(0, ...s.deps.map((d) => longest(d)));
      const val = depMax + s.ms;
      memo.set(name, val);
      return val;
    };
    return Math.max(...this.stages.map((s) => longest(s.stage)));
  }

  // Attribution — group by kind/model/tool
  attribution(): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const s of this.stages) {
      const key = s.model ?? s.tool ?? s.kind;
      groups[key] = (groups[key] ?? 0) + s.ms;
    }
    return groups;
  }

  // Bottleneck — stage with largest share
  bottleneck(): { stage: string; pct: number } {
    const total = this.stages.reduce((a, s) => a + s.ms, 0);
    const top = [...this.stages].sort((a, b) => b.ms - a.ms)[0];
    return { stage: top.stage, pct: Math.round((top.ms / total) * 100) };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết stage nào slow (Gregg flame graph) | ❌ Instrumentation overhead (small) |
| ✅ Critical path — tối ưu đúng chỗ (CPM) | ❌ Parallel stages harder to model |
| ✅ Attribution (model/tool) — root cause | ❌ Distributed timing clock skew |
| ✅ SLO budget — alert khi vượt | ❌ Storage for trace data |

## Khác các hướng gần

| | LF (318) Token Trace | 320 Cost-Per-Step | LG: Latency Breakdown |
|---|---|---|---|
| Đo | Token + span | Cost | **Per-stage timing** |
| Gán | Span | Step | **Model / tool / stage** |
| Tối ưu | Debug | FinOps | **Bottleneck + critical path** |

## Khi nào chọn

- Agent chậm — cần biết stage nào slow để tối ưu
- SLO/SLA monitoring (budget per stage, alert)
- Tối ưu routing (178 — route slow stage sang model khác)
- Nối LF (318) token-trace + 320 cost-per-step + 178 dynamic-routing
