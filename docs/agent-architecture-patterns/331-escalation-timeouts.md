# Hướng LS: Escalation Timeouts — hard deadline buộc escalate khi agent stuck

> **Nguồn gốc:** Incident escalation (PagerDuty, SLA-based escalation policy); hard deadline / timeout; circuit breaker deadline; "two-minute drill" (ops escalation); SLA breach escalation; SLI/SLO error budget deadline
> **Coupling:** 🟢 — thêm escalation timer vào agent loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (timeout/throttle sẵn — chưa có escalation chain)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Incident escalation** (PagerDuty): khi alert không ack trong X phút → escalate lên cấp cao hơn (L1 → L2 → manager). **SLA escalation**: deadline vi phạm → auto-escalate. Nguyên tắc: **hard deadline** + **escalation chain** — không đợi vô hạn. PagerDuty escalation policy: "if not acknowledged within 5 minutes, notify next level". Ops runbook: "two-minute drill" — nếu không resolve trong 2 phút → escalate. Khác plain **timeout** (fail/retry) — escalation **chuyển cho người/cấp cao hơn**; khác **291 cancel propagation** (cancel) — LS **chuyển sở hữu**; khác **174 failover** (chuyển provider) — LS **chuyển cho human/agent cấp cao**.

## Mô tả

mya escalation: mỗi task có **hard deadline** (VD 5 phút). Nếu agent không complete trong deadline → escalate: tự retry với subagent cao cấp → nếu vẫn stuck → human notification. Escalation chain: agent L1 → agent L2 (model mạnh hơn, thêm context) → human (HR 226). mya có timeout/throttle (196) — LS thêm **escalation chain** (không chỉ fail mà chuyển cho cấp phù hợp). Giảm stuck-to-forever, đảm bảo task không treo vô hạn.

## Kiến trúc

```
  TASK (deadline: 5 phút)
        │
        ▼
  AGENT L1 chạy ──── timer tick ────
        │
   ┌────┴────────────┐
   │ done?            │
   ├── yes → COMPLETE │
   └── no, deadline?  │
        │
   ┌────┴────┐
   │ < 50%   │ ← cảnh báo (warn)
   │ 50-100% │ ← chuẩn bị escalate
   │ > 100%  │ ← HARD DEADLINE → ESCALATE
   └────┬────┘
        ▼
  ESCALATION CHAIN:
   L1 agent → L2 agent (model mạnh hơn) → human (HR 226)
        │
        ▼
  CONTEXT HANDOFF: task + progress + lỗi gặp → L2/human
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 196 rate-limiting-quotas — timeout/throttle (nền)
// ✅ 174 fault-tolerance-failover — failover (provider)
// ✅ 203 GU retry — retry (khi lỗi)
// ✅ 54 handoff — context transfer (escalation context)
// ✅ 226 HR human-approval — human gate (cuối escalation chain)
// ✅ 291 cancel-propagation — cancel (kết hợp)

// ❌ THIẾU: hard deadline per task (escalation trigger)
// ❌ THIẾU: escalation chain (L1 → L2 → human)
// ❌ THIẾU: progress-based escalation (warn tại 50%, escalate tại 100%)
// ❌ THIẾU: context handoff khi escalate (progress + lỗi)
```

## Implementation

```typescript
// packages/agent/src/escalation.ts (NEW)
interface EscalationTier { agent: string; deadlineMs: number; }

class EscalationChain {
  constructor(private tiers: EscalationTier[]) {}

  async run(task: Task): Promise<Result> {
    for (const tier of this.tiers) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), tier.deadlineMs); // hard deadline
      try {
        return await runAgent(tier.agent, task, ctrl.signal);
      } catch (e) {
        if (e instanceof DeadlineExceeded) {
          task.context = { ...task.context, partialProgress: task.progress, lastError: e.message };
          continue; // escalate lên tier kế
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    // hết chain → human (HR 226)
    return await humanApproval.escalate(task);
  }
}

// Progress-based warning
function checkProgress(elapsedMs: number, deadlineMs: number): 'ok' | 'warn' | 'escalate' {
  const ratio = elapsedMs / deadlineMs;
  if (ratio > 1) return 'escalate';
  if (ratio > 0.5) return 'warn';
  return 'ok';
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không stuck-to-forever (hard deadline) | ❌ Deadline quá chặt → escalate thừa |
| ✅ Tự chuyển cấp phù hợp (L1→L2→human) | ❌ Context handoff overhead |
| ✅ Human chỉ bị gọi khi cần (PagerDuty) | ❌ Tier phải tune (đâu chuyển cấp nào) |
| ✅ Progress-based warn (chuẩn bị sớm) | ❌ False escalation noise |

## Khác các hướng gần

| | 196 Rate Limiting | 174 Failover | 291 Cancel | LS: Escalation |
|---|---|---|---|---|
| Khi stuck | 429 (chặn) | Chuyển provider | Cancel task | **Chuyển cấp cao hơn** |
| Mục | Bảo vệ | Tiếp tục | Dừng | **Giải quyết bằng cấp phù hợp** |
| Human? | ❌ | ❌ | ❌ | ✅ cuối chain |
| Deadline | ❌ | ❌ | ❌ | ✅ hard |

## Khi nào chọn

- Task có SLA/deadline — không thể treo vô hạn
- Muốn tự chuyển cấp phù hợp (L1→L2→human) thay vì chỉ fail
- Human chỉ bị gọi khi agent không giải quyết được
- Kết hợp 291 cancel (dừng) + LS (chuyển); tune deadline + tier để giảm false escalation
