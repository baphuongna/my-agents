# Hướng X: Market-Based Allocation — agent đấu thầu task

> **Nguồn gốc:** Economics — Vickrey auction (1961), Contract Net Protocol (Smith, 1980)
> **Coupling:** 🟢 Economic mechanism (bids, not assignments)
> **Agent-agnostic:** ✅ — bất kỳ agent bid
> **Effort:** 2-3 tuần

## Nguồn gốc

Auction theory (Vickrey, 1961). Contract Net Protocol (Smith, 1980) — decentralized task allocation trong multi-agent systems. Market-based resource allocation (Wellman, 1993).

**Tham chiếu:**
- Vickrey, W. (1961). "Counterspeculation, Auctions, and Competitive Sealed Tenders." *Journal of Finance*, 16(1), 8–37.
- Smith, R. G. (1980). "The Contract Net Protocol." *IEEE Transactions on Computers*, C-29(12), 1104–1113.
- Wellman, M. P. (1993). "A Market-Oriented Programming Environment." *JAIR*, 1, 1–23.

## Mô tả

Task KHÔNG được assign — được **auction.** Mỗi agent self-assess capability, submit bid (confidence, ETA, cost). Task goes to agent với best value proposition. Self-organizing market: capable agent wins, agents specialize, load balancing emergent, reputation accrues.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│                  TASK MARKET (auction house)              │
│                                                          │
│  Task: "Fix authentication bug" — value: 100 credits     │
│                                                          │
│  Agent-007 bid: 80cr  "I know auth module" conf:0.85     │
│    ETA: 5 min                                            │
│  Agent-003 bid: 60cr  "Less familiar"   conf:0.55        │
│    ETA: 15 min                                           │
│  Agent-005 bid: 90cr  "Auth specialist" conf:0.92        │
│    ETA: 3 min                                            │
│                                                          │
│  Winner: Agent-005 (best value)                          │
│  Price: 80cr (Vickrey — second price)                    │
│                                                          │
│  Reputation system:                                      │
│  · Done → +credits → priority cho task giá trị cao       │
│  · Fail → -credits → task dễ hơn                         │
│  · Agent tự specialize (comparative advantage)           │
│                                                          │
│  Market price = difficulty signal:                       │
│  · Bid cao = task dễ (nhiều agent giành)                │
│  · Không bid = task khó (không ai dám)                  │
└──────────────────────────────────────────────────────────┘
```

## Bid format

```typescript
interface TaskAuction {
  taskId: string;
  description: string;
  reward: number;          // Credits offered
  requirements?: string[]; // Required capabilities
  deadline?: number;
  postedBy: string;
  postedAt: number;
}

interface AgentBid {
  taskId: string;
  agentId: string;
  confidence: number;      // 0.0 - 1.0 (self-assessment)
  etaMinutes: number;      // Estimated time
  bidCredits: number;      // How much of reward they want
  notes?: string;
  submittedAt: number;
}

// Evaluation: bid with best value proposition wins
// Vickrey: winner pays second-highest bid price
function evaluateBids(bids: AgentBid[]): AgentBid | null {
  if (bids.length === 0) return null;
  return bids.sort((a, b) =>
    (b.confidence / b.etaMinutes) - (a.confidence / a.etaMinutes)
  )[0];
}
```

## Bidding strategies (agent self-assess)

```
Agent evaluates each task:
  1. Can I do this? (capability check)
     "Do I have the tools for this?" 
     "Have I seen this codebase before?"
  2. How confident am I? (self-assessment)
     "Similar to tasks I've done before → high confidence"
     "New territory → low confidence"
  3. How long will it take? (ETA estimation)
     "Small change → 2 min"
     "Large refactor → 30 min"
  4. What's my current load? (capacity)
     "Already running 2 tasks → bid high (lose auction)"
     "Idle → bid low (win auction)"
  5. What's it worth to me? (bid = cost + profit)
     "Bid = desired reward − current reputation deficit"
```

## Reputation system

```
┌──────────────────────────────────────────────┐
│ Reputation ledger (SQLite):                  │
│                                              │
│ agent_007: { credits: 150, tasksDone: 12,    │
│              tasksFailed: 1, winRate: 0.92 } │
│ agent_003: { credits: 80, tasksDone: 5,      │
│              tasksFailed: 2, winRate: 0.71 } │
│ agent_005: { credits: 300, tasksDone: 25,    │
│              tasksFailed: 0, winRate: 1.0 }  │
│                                              │
│ Effects:                                     │
│ · High reputation → priority for valuable    │
│   tasks (system-wide signal)                 │
│ · Low reputation → only gets easy tasks      │
│ · Failed tasks → reputation penalty          │
│ · Successful tasks → reputation boost        │
└──────────────────────────────────────────────┘
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Self-organizing specialization | ❌ Bidding overhead (N agents evaluate each task) |
| ✅ Natural load balancing (busy agents bid high) | ❌ Strategic manipulation (underbid for easy tasks) |
| ✅ Incentive alignment (credits → better tasks) | ❌ Credit inflation/deflation (monetary policy) |
| ✅ Difficulty estimation (market price) | ❌ Complex (auction + reputation + credits) |
| ✅ No single point of failure | ❌ Cold start (new agents have no reputation) |

## Khi nào chọn

- Want decentralized task allocation (not orchestrator assignment)
- Many heterogeneous agents (different strengths)
- Want agents to specialize naturally (comparative advantage)
- OK building economic mechanism (auction + reputation + credits)
- Need load balancing without central control
