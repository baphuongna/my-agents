# Hướng IJ: Incident Runbook — playbook khắc phục tự động

> **Nguồn gốc:** PagerDuty "incident response runbook"; "SRE runbook/playbook"; AWS "runbook automation"; "ChatOps incident response"
> **Coupling:** 🟡 — runbook engine kích hoạt khi incident, agent loop đổi nhẹ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (retry 203 + self-heal 169 + DLQ 231 sẵn — thiếu runbook registry + auto-trigger)
> **Effort:** 2-3 tuần

## Nguồn gốc

Incident runbook (PagerDuty, SRE Workbook): tài liệu **playbook từng bước** khắc phục sự cố cụ thể — khi alert X xảy ra → chạy step 1, 2, 3. AWS "runbook automation" — thay manual → script tự động (Systems Manager Automation). ChatOps — runbook chạy qua chat command ("@bot runbook db-oom-recovery"). Cho agent: khi SLO breach (243), anomaly (236), hoặc alert (227) → agent tự động tìm runbook phù hợp → thực thi auto-remediation steps. Runbook = declarative: trigger condition + sequential steps + verification + escalation nếu fail.

Khác **169 self-healing** (agent *tự nghĩ ra* cách sửa) — IJ là *playbook định sẵn* (human-authored, deterministic). Khác **203 retry-loops** (retry cơ bản) — IJ phức tạp hơn (nhiều step, conditional, verify). Nối **231 DLQ** (HW — runbook cho DLQ requeue), **243 SLO** (II — breach → runbook), **203 retry** (step trong runbook), **226 approval-gates** (runbook destructive → human confirm).

## Mô tả

mya incident runbook: (1) **registry** — thư viện runbook (YAML/TS): mỗi runbook có trigger condition (anomaly type, SLO breach, error pattern) + steps (retry, rollback, scale, notify) + verify + escalate-on-fail; (2) **match engine** — khi incident xảy ra (236 anomaly / 243 SLO breach / 227 alert) → tìm runbook phù hợp; (3) **executor** — chạy steps theo thứ tự, verify mỗi step, nếu fail → escalate (226 human / 42 circuit-breaker). mya đã có retry (203) + self-heal (169) + DLQ (231) — IJ tổng hợp thành **coordinated playbook system**.

## Kiến trúc

```
  INCIDENT (anomaly 236 / SLO breach 243 / alert 227)
   · "memory poisoning detected" (236 IB score 0.97)
        │
        ▼
  ┌──────────────────────────────────────────────┐
  │  RUNBOOK MATCH ENGINE                          │
  │  trigger: anomaly.type === "memory_poisoning"  │
  │  → matched: RB-memory-rollback                 │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
  ┌──────────────────────────────────────────────┐
  │  RUNBOOK EXECUTOR (sequential + verify)        │
  │                                               │
  │  RB-memory-rollback:                           │
  │   step 1: snapshot current state (IH)          │
  │   step 2: restore last clean snapshot (IH)     │
  │   step 3: verify memory healthy ✓              │
  │   step 4: notify operator (227)               │
  │   step 5: audit incident (198)                 │
  │                                               │
  │  IF any step FAILS:                            │
  │   → escalate to human (226) + page on-call     │
  └──────────────────┬───────────────────────────┘
                     │
                     ▼
              INCIDENT RESOLVED (auto) hoặc ESCALATED (human)
```

```
mya: retry 203 + self-heal 169 + DLQ 231 sẵn — thiếu runbook registry + match engine + executor
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 203 failure-detection-retry-loops — retry/backoff (step cơ bản trong runbook)
// ✅ 169 self-healing-agents — auto-repair (agent nghĩ ra — khác runbook định sẵn)
// ✅ 231 dead-letter-queue (HW) — DLQ requeue (runbook candidate)
// ✅ 42 circuit-breaker — stop on failure (runbook fallback)
// ✅ 226 human-approval-gates — escalate (runbook escalation step)
// ✅ 227 agent-notifications-alerts — notify (runbook step)

// ❌ THIẾU: runbook registry (declarative playbook library)
// ❌ THIẾU: match engine (incident → matching runbook)
// ❌ THIẾU: runbook executor (sequential steps + verify + escalate-on-fail)
// ❌ THIẾU: post-incident audit + runbook improvement loop
```

## Implementation

```typescript
// packages/agent/src/runbook.ts (NEW)
interface RunbookStep {
  action: string;            // "rollback-memory" / "restart-session" / "notify"
  verify?: () => Promise<boolean>;  // confirm step succeeded
  onFailure: "abort" | "continue" | "escalate";
}

interface Runbook {
  id: string;
  trigger: { type: string; match: (incident: Incident) => boolean };
  steps: RunbookStep[];
  requiresApproval?: boolean;   // destructive → human confirm (226)
}

class RunbookEngine {
  constructor(private registry: Runbook[], private audit: AuditLog) {}

  async handle(incident: Incident): Promise<"resolved" | "escalated"> {
    const rb = this.registry.find((r) => r.trigger.match(incident));
    if (!rb) return "escalated"; // no runbook → human

    if (rb.requiresApproval && !(await this.approvalGate(rb))) return "escalated";

    for (const step of rb.steps) {
      try {
        await this.execute(step);
        if (step.verify && !(await step.verify())) {
          if (step.onFailure === "escalate") return "escalated";
        }
      } catch (e) {
        if (step.onFailure === "abort" || step.onFailure === "escalate") return "escalated";
      }
    }
    this.audit.append({ type: "runbook.resolved", id: rb.id, incident });
    return "resolved";
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Auto-remediation (PagerDuty/SRE — MTTR giảm) | ❌ Runbook authoring (human phải viết trước) |
| ✅ Deterministic (khác self-heal heuristic) | ❌ Stale runbook (incident mới chưa có playbook) |
| ✅ Coordinated (nhiều step có thứ tự + verify) | ❌ Over-automation (wrong runbook → hại thêm) |
| ✅ Nối retry 203 + DLQ 231 + self-heal 169 | ❌ Escalation storm (nhiều incident cùng lúc) |

## Khác các hướng gần

| | 169 Self-Healing | 203 Retry Loops | IJ: Incident Runbook |
|---|---|---|---|
| Nguồn | Agent tự nghĩ | Retry cơ bản | **Playbook định sẵn** |
| Phức tạp | Adaptive | Đơn giản | **Multi-step + verify** |
| Khi | Lỗi lạ/novel | Lỗi tạm thời | **Pattern đã biết** |

## Khi nào chọn

- Có incident lặp lại (cùng pattern) — cần auto-remediation
- MTTR (mean-time-to-resolve) quan trọng — agent resolve thay đợi human
- SLO (243) breach → runbook tự động kích hoạt
- OK với human-authored runbook (không phải agent tự nghĩ — nối 169 cho novel)
