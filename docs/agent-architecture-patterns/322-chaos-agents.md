# Hướng LJ: Chaos Agents — chaos engineering cho LLM agent, inject lỗi tool/latency

> **Nguồn gốc:** "Chaos Engineering" (Netflix Chaos Monkey); fault injection testing (FIT); "Principles of Chaos"; "resilience testing"; "game days"; dependency failure simulation
> **Coupling:** 🟡 — chạm tool layer + agent-loop (fault injection)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool-call + agent-loop + retry sẵn — thiếu fault injector + chaos harness + steady-state verify)
> **Effort:** 3-4 tuần

## Nguồn gốc

Chaos Engineering (Netflix Chaos Monkey, 2011): **proactively inject failure** vào prod để verify system chịu được. "Principles of Chaos": (1) define steady-state hypothesis, (2) vary real-world events (kill node, add latency), (3) run experiments, (4) automate continuously. FIT (Fault Injection Testing): inject lỗi (timeout, 500, network drop). Game days: tập diễn sự cố. Cho agent: inject **LLM failure** (rate-limit, timeout), **tool failure** (tool returns error), **latency** (slow response), **bad output** (malformed JSON). Cốt lõi: **agent sẽ fail trong prod** — test trước bằng chaos → biết agent phản ứng thế nào → fix retry/fallback.

## Mô tả

mya chaos: fault injector chèn vào tool/provider layer → (1) **define steady-state** (task success rate > 95%); (2) **inject** — LLM timeout, tool error, latency spike, malformed JSON; (3) **observe** — agent retry? fallback? crash?; (4) **verify** — steady-state maintained? Nếu không → fix (retry, fallback model 178, graceful degrade). Nối 327 interruptible (abort under chaos), 322→323 load-testing (chaos + load), 118 error-analysis (post-chaos root-cause).

## Kiến trúc

```
  STEADY-STATE HYPOTHESIS:
  "agent completes task successfully ≥ 95% under normal load"

  ┌──────────────────────────────────────────────────────┐
  │  CHAOS EXPERIMENT (fault injector)                   │
  │                                                      │
  │  Inject: (randomly / scheduled)                      │
  │   · LLM timeout (provider hangs 10s)                 │
  │   · LLM rate-limit (429)                             │
  │   · tool error (read returns EACCES)                 │
  │   · latency spike (tool +3s)                         │
  │   · malformed JSON (LLM returns garbage)             │
  │   · partial output (LLM truncates)                   │
  └──────────────────┬───────────────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  OBSERVE agent behavior under fault                  │
  │  · retry? (with backoff?)                            │
  │  · fallback model? (178 routing)                     │
  │  · crash / hang?                                     │
  │  · graceful degrade? (inform user, partial result)   │
  └──────────────────┬───────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ✅ STEADY-STATE HELD        ❌ STEADY-STATE VIOLATED
  (success ≥ 95%)            (crash / hang / <95%)
  → chaos passed              → FIX: add retry/fallback
                              → re-run chaos until pass
```

```
mya: tool-call + agent-loop + retry sẵn — thiếu fault injector + chaos harness + steady-state verify
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 3-tools — tool-call (sẵn — injection target)
// ✅ 2-providers — LLM call (sẵn — injection target)
// ✅ agent-loop retry (sẵn — resilience under test)
// ✅ 178 dynamic-routing — fallback model (documented)

// ❌ THIẾU: fault injector (timeout/error/latency/ malformed)
// ❌ THIẾU: chaos harness (define experiment, run, observe)
// ❌ THIẾU: steady-state hypothesis (success threshold)
// ❌ THIẾU: fault types catalog (LLM/tool/latency/malformed)
```

## Implementation

```typescript
// packages/agent/src/chaos.ts (NEW)
type FaultType = "llm-timeout" | "llm-ratelimit" | "tool-error" | "latency-spike" | "malformed-json";

interface ChaosPlan { faults: { type: FaultType; rate: number }[]; steadyStatePct: number; runs: number; }

export class ChaosHarness {
  constructor(private realProvider: ModelProvider, private realTools: Map<string, Tool>) {}

  async run(plan: ChaosPlan, taskRunner: () => Promise<boolean>): Promise<{ passed: boolean; successRate: number }> {
    let successes = 0;
    for (let i = 0; i < plan.runs; i++) {
      // Maybe inject a fault this run
      this.maybeInject(plan.faults);
      const ok = await taskRunner().catch(() => false);
      if (ok) successes++;
      this.reset();
    }
    const successRate = (successes / plan.runs) * 100;
    return { passed: successRate >= plan.steadyStatePct, successRate };
  }

  private maybeInject(faults: { type: FaultType; rate: number }[]): void {
    for (const f of faults) {
      if (Math.random() < f.rate) this.inject(f.type);
    }
  }

  private inject(type: FaultType): void {
    switch (type) {
      case "llm-timeout":
        this.realProvider.generate = async () => { await sleep(15_000); return ""; }; // hang
        break;
      case "tool-error":
        for (const t of this.realTools.values()) {
          t.run = async () => ({ ok: false, output: { error: "chaos: EACCES" } });
        }
        break;
      case "malformed-json":
        this.realProvider.generate = async () => "{ broken json";
        break;
      case "latency-spike":
        // wrap tool with delay
        break;
    }
  }
  private reset(): void { /* restore originals */ }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Verify resilience trước prod (Netflix) | ❌ Chaos experiment complexity |
| ✅ Tìm hidden bug (retry/fallback gap) | ❌ False alarm (chaos too aggressive) |
| ✅ Steady-state hypothesis — objective SLO | ❌ Injection may corrupt state (cleanup) |
| ✅ Game-day readiness | ❌ Time-consuming (many runs) |

## Khác các hướng gần

| | 321 Flaky Stabilization | 323 Load-Testing | LJ: Chaos Agents |
|---|---|---|---|
| Mục | Ổn định test | Bão hòa capacity | **Inject fault → verify resilience** |
| Phá | Unintentional | Volume | **Intentional (FIT)** |
| Verify | Test pass | Throughput | **Steady-state held** |

## Khi nào chọn

- Agent sẽ chạy prod — cần verify chịu lỗi (chaos)
- Retry/fallback đã có — test xem có work không
- Game-day / pre-incident rehearsal
- Nối 327 interruptible + 323 load-testing + 118 error-analysis + 178 routing (fallback)
