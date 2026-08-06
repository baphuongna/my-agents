# Hướng IU: Emergent Behavior Detection — phát hiện hành vi nổi lên ngoài ý

> **Nguồn gốc:** "Emergent Abilities of LLMs" (Wei et al. 2022); Park et al. "Generative Agents" (2023); "Multi-Agent Emergent Behavior" (DeepMind); Steels; epistemic monitoring; 103 agent-drift
> **Coupling:** 🟡 — chạm telemetry + agent loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit + drift detection sẵn — thiếu anomaly baseline + behavioral guard)
> **Effort:** 2-3 tuần

## Nguồn gốc

Emergent behavior: hệ multi-agent phát sinh hành vi **không được lập trình trực tiếp** — Wei et al. (2022): khả năng "emerge" ở quy mô lớn (reasoning, in-context learning). Park et al. (2023, "Generative Agents"): agent xã hội tự tổ chức party, lan truyền tin — behavior không ai code. DeepMind multi-agent: agents học coordination strategy ngoài ý định. Nguy cơ: hành vi nổi lên có thể **có lợi** (self-organization) hoặc **có hại** (reward hacking 102, agent-drift 103, runaway loop JF 266). Phát hiện: establish **behavioral baseline** (normal pattern), monitor deviation (anomaly detection), flag khi agent làm việc ngoài distribution mong đợi.

## Mô tả

mya emergent detection: theo dõi hành vi agent (tool call frequency, resource use, message patterns) → build baseline → flag anomaly. Ví dụ: agent tự nhiên gọi shell 50 lần/phút (baseline = 5) → alert (có thể runaway JF 266 hoặc drift 103). Hoặc: 2 subagent bắt đầu chat liên tục với nhau (emergent coordination — có thể có lợi hoặc trốn rủi ro). Dùng audit log (198) làm data source. Nối IU → khi anomaly → escalation tree (46) hoặc circuit-breaker (42).

## Kiến trúc

```
  AGENT(s) chạy  ──►  TELEMETRY (audit 198, metrics)
        │                    ▼
        │           ┌──────────────────┐
        │           │  BASELINE (norm) │
        │           │  tool/resource/  │
        │           │  msg patterns    │
        │           └────────┬─────────┘
        │                    │ compare live vs baseline
        │                    ▼
        │           ┌──────────────────┐
        │           │  ANOMALY DETECT  │
        │           │  z-score > 3σ?   │
        │           │  new pattern?    │
        │           └────────┬─────────┘
        │                    │ flag
        │           ┌────────▼─────────┐
        │           │  RESPONSE        │
        │           │  → alert (227)   │
        │           │  → throttle      │
        │           │  → circuit-brk 42│
        │           │  → escalate 46   │
        │           └──────────────────┘
        ▼
  HUMAN reviews: beneficial (keep) or harmful (stop)
```

```
mya: audit 198 + drift 103 sẵn — thiếu: behavioral baseline + anomaly scoring + response automation
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 198 audit-trails — log mọi hành vi (sẵn — data source)
// ✅ 103 agent-drift — detect drift (sẵn — 1 loại anomaly)
// ✅ 42 circuit-breaker — stop on failure (sẵn — response)
// ✅ 46 escalation-tree — escalate (sẵn — response)
// ✅ 227 notifications — alert (sẵn)

// ❌ THIẾU: behavioral baseline (normal distribution per agent)
// ❌ THIẾU: anomaly scoring (z-score / isolation forest)
// ❌ THIẾU: novel-pattern detection (unseen behavior → flag)
// ❌ THIẾU: automated response policy (anomaly → throttle/stop)
```

## Implementation

```typescript
// packages/observe/src/emergence.ts (NEW)
interface BehaviorSample {
  agentId: string;
  toolCallsPerMin: number;
  tokenPerMin: number;
  messagesSent: number;
  ts: number;
}

export class EmergenceDetector {
  private baseline = new Map<string, { mean: number; std: number }>();

  // Train baseline from historical audit (198)
  train(history: BehaviorSample[]): void {
    const grouped = groupBy(history, (s) => s.agentId);
    for (const [id, samples] of grouped) {
      const freq = samples.map((s) => s.toolCallsPerMin);
      this.baseline.set(id, { mean: avg(freq), std: stddev(freq) });
    }
  }

  // Score live sample — flag if z-score > threshold
  check(sample: BehaviorSample): Anomaly | null {
    const base = this.baseline.get(sample.agentId);
    if (!base) return { kind: "novel", agent: sample.agentId }; // unseen agent
    const z = (sample.toolCallsPerMin - base.mean) / (base.std || 1);
    if (z > 3) {
      // High anomaly → may be runaway (JF 266) or drift (103)
      return { kind: "spike", agent: sample.agentId, zScore: z };
    }
    return null;
  }

  async respond(anomaly: Anomaly): Promise<void> {
    await notify("emergent-behavior", anomaly); // 227
    if (anomaly.kind === "spike") await circuitBreaker.trip(anomaly.agent); // 42
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện hành vi ngoài ý trước khi gây hại (Park 2023) | ❌ Baseline cần dữ liệu lịch sử đủ |
| ✅ Bắt reward-hacking (102) / drift (103) sớm | ❌ False positive — flag hành vi hợp lệ |
| ✅ Hữu ích: phát hiện beneficial emergence | ❌ Novel pattern khó phân loại (hại/lợi?) |
| ✅ Nối 198/42/46/227 (đã sẵn) | ❌ Overhead: monitoring + scoring mỗi agent |

## Khác các hướng gần

| | 103 Agent Drift | JF (266) Runaway | IU: Emergent Detect |
|---|---|---|---|
| Mục | Drift (goal shift) | Infinite loop | **Bất kỳ behavior ngoài distribution** |
| Detect | Output compare | Loop counter | **Baseline z-score + novel** |
| Scope | Per-agent | Per-loop | **System-wide multi-agent** |

## Khi nào chọn

- Multi-agent system — hành vi phức tạp khó dự đoán
- Agent có autonomy cao — cần safety net
- Đã có audit (198) — muốn phân tích behavioral pattern
- Nối 103 drift + JF (266) runaway + 42 circuit-breaker
