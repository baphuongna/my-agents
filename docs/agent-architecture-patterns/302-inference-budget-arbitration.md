# Hướng KP: Inference Budget Arbitration — phân token theo priority, multi-agent tranh chấp

> **Nguồn gốc:** Weighted Fair Queuing (WFQ); QoS/priority scheduling; bandwidth/CPU arbitration; budget allocation
> **Coupling:** 🟡 — cần pool token-budget chia sẻ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cost-budget sẵn — thiếu arbitration nhiều agent)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Arbitration** (WFQ/QoS): tài nguyên khan hiếm (bandwidth, CPU) phân theo **trọng số ưu tiên** — request priority cao được nhiều share. Weighted Fair Queuing: mỗi flow có weight, share ∝ weight — công bằng theo trọng số. QoS (DiffServ): traffic priority (high/normal/best-effort). Budget allocation (org finance): phòng ban tranh chấp ngân sách → phân theo priority/quota. Nguyên tắc: nhiều agent tranh token budget chung → **phân theo priority** — agent ưu tiên cao (user-facing) được nhiều token, agent thấp (background) ít — không để 1 agent cạn ngân sách chung.

## Mô tả

mya budget arbitration: nhiều agent (user session, background eval, subagent) chia token budget (44). Mỗi agent có **priority/weight** — user-facing cao, background thấp. Arbitrator phát token theo weight; khi budget cạn → agent thấp bị **throttle/deny** trước, bảo vệ agent cao. Nối 192 token-economics + 167 per-task-cost-attribution. Khác 44 cost-budget (giới hạn tổng): KP **phân giữa agent tranh chấp** — fair theo priority, không ai "chiếm" hết.

## Kiến trúc

```
  TOKEN BUDGET (chia sẻ, 44): 100k tokens / giờ
        │
        ▼
  ┌─────────── ARBITRATOR (WFQ) ────────────┐
  │  agent       weight   share              │
  │  ───────     ──────   ─────              │
  │  user-chat   5        50k  (ưu tiên cao) │
  │  subagent    3        30k                │
  │  bg-eval     2        20k  (ưu tiên thấp)│
  └──────────────┬──────────────────────────┘
                 ▼
  budget CẠN (hết 100k):
        throttle theo thứ tự ưu tiên THẤP → CAO
        bg-eval bị deny/throttle TRƯỚC
        → user-chat được bảo vệ (không bị bg cướp)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 44 cost-budget — budget tổng (nền KP)
// ✅ 192 token-economics — token theo dõi
// ✅ 167 per-task-cost-attribution — cost theo task (mỗi agent)
// ✅ 127 agentic-finops — finops (mục tiêu kiểm soát)
// ✅ 46 escalation-tree — priority (KP phân theo priority)

// ❌ THIẾU: shared budget pool (nhiều agent tranh)
// ❌ THIẾU: WFQ weight allocation (share ∝ priority)
// ❌ THIẾU: throttle order (thấp-để-cai → bảo vệ cao)
// ❌ THIẾU: preemption (agent cao cướp từ agent thấp khi cạn)
```

## Implementation

```typescript
// packages/agent/src/budget-arbitrator.ts (NEW)
interface AgentBudget { id: string; weight: number; used: number; }

class BudgetArbitrator {
  private agents = new Map<string, AgentBudget>();
  constructor(private total: number, private windowMs = 3_600_000) {}

  register(id: string, weight: number): void { this.agents.set(id, { id, weight, used: 0 }); }

  // Yêu cầu token — phê duyệt theo weight + còn budget
  request(id: string, tokens: number): number {
    const me = this.agents.get(id)!;
    const totalWeight = [...this.agents.values()].reduce((s, a) => s + a.weight, 0);
    const myShare = (me.weight / totalWeight) * this.total;
    const remaining = myShare - me.used;

    if (remaining >= tokens) { me.used += tokens; return tokens; }           // đủ share
    if (this.globalRemaining() > 0 && remaining > 0) {                       // mượn dư
      me.used += remaining; return remaining;
    }
    return 0; // deny (agent này bị throttle — bảo vệ agent ưu tiên cao)
  }

  private globalRemaining(): number {
    const used = [...this.agents.values()].reduce((s, a) => s + a.used, 0);
    return this.total - used;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân công theo priority (WFQ/QoS proven) | ❌ Weight cần tune (priority tuning) |
| ✅ Bảo vệ agent ưu tiên cao (không bị cướp) | ❌ Agent thấp bị deny/throttle (chậm) |
| ✅ Fair theo trọng số (không ai chiếm hết) | ❌ Cần pool chia sẻ (state chung) |
| ✅ Nối 44/192/167 (budget + attribution) | ❌ Preemption phức tạp (cướp giữa chừng) |

## Khác các hướng gần

| | 44 Cost Budget | 196 Rate Limiting | KP: Budget Arbitration |
|---|---|---|---|
| Giới hạn | Tổng 1 agent | QPS / req | **Chia giữa nhiều agent** |
| Phân phối | ❌ | ❌ | ✅ theo weight/priority |
| Bảo vệ | ❌ | ❌ | ✅ agent cao |
| Khi cạn | Stop | 429 | **throttle thấp-trước** |

## Khi nào chọn

- Nhiều agent tranh token budget chung (user + background + subagent)
- Cần ưu tiên agent user-facing (không bị background cướp)
- Budget khan hiếm → phải phân công bằng (theo priority)
- Muốn fair-share (WFQ) thay vì first-come-first-serve
