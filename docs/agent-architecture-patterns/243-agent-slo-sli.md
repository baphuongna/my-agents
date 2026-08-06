# Hướng II: Agent SLO/SLI — mục tiêu chất lượng + error budget

> **Nguồn gốc:** Google SRE "Site Reliability Engineering" (SLI/SLO/error budget); "The SRE Workbook"; Microsoft Azure SLA; OpenTelemetry SLO monitoring
> **Coupling:** 🟢 — SLO engine lớp ngoài, runtime metric-only
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (telemetry + cost sẵn — thiếu SLO target + error budget + burn-rate alert)
> **Effort:** 2-3 tuần

## Nguồn gốc

SLO/SLI là nền tảng Google SRE (Beyer et al. "Site Reliability Engineering", 2016): **SLI** (Service Level Indicator) — metric đo chất lượng (latency p99, error rate, success rate). **SLO** (Objective) — target cho SLI (vd: "99% request < 2s"). **Error budget** — khoảng dư sai sót: nếu SLO 99% → 1% budget cho lỗi; dùng hết → *đóng băng feature*, tập trung stability. **Burn rate** — tốc độ tiêu budget (nhanh = nguy hiểm). Azure SLA ( contractual). OpenTelemetry — instrument SLI metric → SLO dashboard. Cho agent: SLI = latency/cost/success/task-completion; SLO = target; budget điều phối ưu tiên (reliability vs velocity).

Khác **131 watchdog** (EA — kiểm tra *sức khỏe* process) — II đo *chất lượng dịch vụ* theo target chính thức. Khác **127 agentic-finops** (DW — quản *chi phí*) — II rộng hơn: latency + success + cost. Nối **128 otel-observability**, **245 capacity-planning** (IK — SLO drive capacity), **244 incident-runbooks** (IJ — SLO breach → runbook).

## Mô tả

mya SLO/SLI: (1) định nghĩa **SLI** từ telemetry (core/telemetry.ts) — latency turn, task success rate, cost per task; (2) đặt **SLO** target (vd: "95% turn < 30s, 90% task success, cost < $0.50/task"); (3) track **error budget** — khi breach → alert (227), throttle feature deploy, hoặc degrade (route cheaper model — 178). mya đã có telemetry snapshot + cost (core/cost.ts) — thiếu SLO target definition + error budget tracking + burn-rate alert.

## Kiến trúc

```
  TELEMETRY STREAM (mỗi turn/task)
   · latency: 28s · success: true · cost: $0.42
   · latency: 45s · success: false · cost: $0.88  ← breach!
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  SLO ENGINE                                    │
  │                                               │
  │  SLI (measured, rolling window):              │
  │   · latency p95: 38s   (SLO target: < 30s) ❌  │
  │   · task success: 87%  (SLO target: > 90%) ❌  │
  │   · cost/task: $0.55   (SLO target: < $0.50) ❌│
  │                                               │
  │  ERROR BUDGET (SLO 90% → 10% budget):          │
  │   · consumed: 8.5% of 10%                     │
  │   · burn rate: 3.2x (FAST — danger!)           │
  │   · projected exhaustion: 2 days              │
  └────────┬─────────────────────────────────────┘
           │
     ┌─────┴──────┬──────────────┐
     ▼            ▼              ▼
  ┌────────┐ ┌──────────┐ ┌────────────────┐
  │ ALERT  │ │ FREEZE   │ │ DEGRADE        │
  │ (227)  │ │ feature  │ │ route cheaper  │
  │ page   │ │ deploy   │ │ model (178)    │
  └────────┘ └──────────┘ └────────────────┘
```

```
mya: telemetry + cost sẵn — thiếu SLO target + error budget + burn-rate alert
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/telemetry.ts — TelemetrySnapshot (per-kind counts + timing — SLI data!)
// ✅ packages/core/src/cost.ts — computeCost (per-task USD — SLI data!)
// ✅ packages/core/src/iteration-budget.ts — hard cap (related but per-task, not SLO)
// ✅ 128 otel-observability — metric export (sẵn)
// ✅ 127 agentic-finops (DW) — cost governance (overlap)
// ✅ 131 agent-watchdog (EA) — health check (reactive)

// ❌ THIẾU: SLO target definition (latency/success/cost per service)
// ❌ THIẾU: error budget tracker (consumed / remaining / burn rate)
// ❌ THIẾU: burn-rate alert (budget depleting fast → page)
// ❌ THIẾU: SLO-driven action (freeze / degrade / route — 178)
```

## Implementation

```typescript
// packages/core/src/slo.ts (NEW)
interface SLO {
  name: string;              // "turn-latency"
  indicator: "latency" | "success" | "cost";
  target: number;            // p95 < 30s, success > 0.9
  windowMs: number;          // rolling window (e.g. 24h)
  objective: number;         // 0.95 → 5% error budget
}

interface BudgetStatus {
  consumed: number;          // fraction of error budget used [0,1]
  burnRate: number;          // >1 = faster than sustainable
  projectedExhaustionMs: number;
}

class SLOEngine {
  constructor(private slos: SLO[], private telemetry: TelemetrySnapshot) {}

  evaluate(): Map<string, BudgetStatus> {
    const out = new Map<string, BudgetStatus>();
    for (const slo of this.slos) {
      const actual = this.measureSLI(slo);            // from telemetry
      const errorRate = Math.max(0, slo.target - actual) / slo.target;
      const budget = errorRate / (1 - slo.objective); // fraction of budget consumed
      out.set(slo.name, {
        consumed: budget,
        burnRate: this.burnRate(slo),
        projectedExhaustionMs: this.project(slo, budget),
      });
    }
    return out;
  }

  isBreached(slo: SLO, status: BudgetStatus): boolean {
    return status.consumed >= 1.0 || status.burnRate > 2; // budget gone OR burning 2x fast
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chất lượng đo được, có target (Google SRE) | ❌ SLO target tuning khó (too strict = always breach) |
| ✅ Error budget điều phối velocity vs reliability | ❌ Cold-start (cần data để đặt SLO ban đầu) |
| ✅ Burn-rate alert — phát hiện sớm (trước hết budget) | ❌ Over-engineering (SLO cho service nhỏ = overkill) |
| ✅ Nối telemetry + cost (data sẵn) | ❌ Gaming (throttle để "đạt" SLO thay vì fix thật) |

## Khác các hướng gần

| | 131 Watchdog (EA) | 127 FinOps (DW) | II: Agent SLO/SLI |
|---|---|---|---|
| Mục | Sức khỏe process | Chi phí | **Chất lượng dịch vụ** |
| Metric | Probe/health | Cost/token | **Latency + success + cost** |
| Action | Restart | Budget cap | **Error budget → freeze/degrade** |

## Khi nào chọn

- Agent chạy production — cần target chất lượng chính thức
- Cần cân bằng velocity (feature) vs reliability
- Multi-stakeholder — SLO là ngôn ngữ chung (dev vs ops)
- Nối 245 capacity-planning (SLO drive capacity) + 244 incident-runbook (SLO breach)
