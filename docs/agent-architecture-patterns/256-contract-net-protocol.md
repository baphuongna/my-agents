# Hướng IV: Contract-Net Protocol — đấu thầu tác vụ giữa agent

> **Nguồn gốc:** Smith "The Contract Net Protocol" (1980); FIPA Contract Net Interaction Protocol; "Foundations of Multi-Agent Systems"; Rosenschein-Zlotkin negotiation; auction-based task allocation
> **Coupling:** 🟢 — negotiation layer tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (202 agent-communication + task delegation sẵn — thiếu bidding protocol)
> **Effort:** 2-3 tuần

## Nguồn gốc

Contract-Net Protocol (Smith 1980): task allocation qua **đấu thầu** (auction). Initiator (manager) có task → broadcast **CFP** (Call For Proposals) → bidder agents tính **bid** (chi phí/thời gian/năng lực) → manager chọn bid tốt nhất → **award** contract → contractor thực hiện → report kết quả. FIPA chuẩn hóa: CFP → propose/refuse → accept/reject-proposal → inform/failure. Lợi: **decentralized** (không central scheduler), **market-based** (agent tự định giá capability), **scalable** (n bidder song song). So với work-stealing (HY 233): contract-net **pull-based proactive** (bid), work-stealing **reactive** (steal khi idle).

## Mô tả

mya contract-net: khi task đến, manager broadcast CFP → subagent pool (mỗi agent có capability profile) tính bid (cost = token estimate + time + load) → manager chọn bid thấp nhất phù hợp → award. Ví dụ: task "review Python file" → agent Python bid thấp, agent Rust bid cao → award Python. Nối 202 agent-communication + 199 delegated-task-authority. Nối HY (233) work-stealing: contract-net cho task cần capability-match, work-stealing cho uniform task.

## Kiến trúc

```
  ┌──────────┐   task arrives   ┌──────────────────────────────┐
  │ MANAGER  │─────────────────►│  BROADCAST CFP               │
  │(initiator│                  │  "task: review Python file"  │
  └──────────┘                  └──────────┬───────────────────┘
                                            │ broadcast
                  ┌──────────────┬──────────┼──────────┬──────────────┐
                  ▼              ▼          ▼          ▼              ▼
              ┌────────┐   ┌────────┐  ┌────────┐ ┌────────┐   ┌────────┐
              │AGENT A │   │AGENT B │  │AGENT C │ │AGENT D │   │AGENT E │
              │Python  │   │Rust    │  │busy    │ │Python  │   │JS      │
              │bid=10  │   │bid=50  │  │refuse  │ │bid=15  │   │bid=40  │
              └───┬────┘   └────────┘  └────────┘ └────────┘   └────────┘
                  │ propose
                  ▼
              ┌──────────┐  evaluate bids
              │ MANAGER  │◄───────────  A:10 (best, Python match)
              │ AWARD → A│
              └────┬─────┘
                   │ award contract
                   ▼
              ┌────────┐  perform task  ┌──────────┐
              │AGENT A │───────────────►│ REPORT   │
              │        │                │ result/fail
              └────────┘                └──────────┘
```

```
mya: 202 agent-communication + 199 delegation sẵn — thiếu: CFP broadcast + bid evaluation + award protocol
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 202 agent-communication-patterns — inter-agent messaging (sẵn)
// ✅ 199 delegated-task-authority — task delegation (sẵn)
// ✅ HY (233) work-stealing — task redistribution (documented)
// ✅ packages/agent/src/pool.ts — session pool (sẵn)

// ❌ THIẾU: CFP broadcast (call-for-proposals to pool)
// ❌ THIẾU: bid function (agent self-assess cost/capability)
// ❌ THIẾU: award selection (manager pick best bid)
// ❌ THIẾU: capability registry (agent skill profile)
```

## Implementation

```typescript
// packages/negotiation/src/contract-net.ts (NEW)
interface Bid {
  agentId: string;
  cost: number;        // token estimate
  eta: number;         // time estimate
  capabilities: string[];
}

export class ContractNetManager {
  constructor(private pool: Agent[], private deadline = 5000) {}

  async allocate(task: Task): Promise<unknown> {
    // 1. Broadcast CFP to all agents
    const proposals = await Promise.all(
      this.pool.map((a) => this.cfp(a, task).catch(() => null))
    );
    const bids = proposals.filter((b): b is Bid => b !== null);

    // 2. Deadline passed — select best bid
    const best = bids.sort((a, b) => a.cost - b.cost || a.eta - b.eta)[0];
    if (!best) throw new Error("no bidders");

    // 3. Award contract → contractor performs → report
    return this.award(best.agentId, task);
  }

  private async cfp(agent: Agent, task: Task): Promise<Bid | null> {
    const bid = await agent.bid(task, this.deadline); // agent self-assess
    if (bid === "refuse") return null; // agent busy / incapable
    return bid;
  }

  private async award(agentId: string, task: Task): Promise<unknown> {
    const agent = this.pool.find((a) => a.id === agentId)!;
    const result = await agent.run(task);
    return result; // or catch → re-auction (FIPA failure)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Decentralized — không central scheduler (Smith 1980) | ❌ Bidding overhead (N agents evaluate mỗi task) |
| ✅ Capability-match — agent phù hợp nhất nhận (market-based) | ❌ Latency: CFP → bid → award round-trip |
| ✅ Scalable — N bidder song song (FIPA) | ❌ Strategic bidding (agent over/under-bid) |
| ✅ Fallback — contractor fail → re-auction | ❌ Deadline tuning (chờ bid bao lâu?) |

## Khác các hướng gần

| | 199 Delegation | HY (233) Work-Stealing | IV: Contract-Net |
|---|---|---|---|
| Phân task | Manager chỉ định | Worker steal khi idle | **Bid đấu thầu** |
| Capability | Manager biết | Uniform task | **Agent tự định giá** |
| Khi rảnh | N/A | React (steal) | **Proact (bid)** |

## Khi nào chọn

- Task cần capability-match (không phải uniform)
- Multi-agent pool có skill khác nhau (Python/Rust/JS)
- Muốn decentralized allocation (không central scheduler)
- Nối 202 communication + 199 delegation + HY (233) work-stealing
