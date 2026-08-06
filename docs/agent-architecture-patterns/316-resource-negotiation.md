# Hướng LD: Resource Negotiation — agent đàm phán chia tài nguyên chung, công bằng

> **Nguồn gốc:** Contract Net Protocol (Smith 1980); "market-based scheduling"; auction mechanisms (VCG); fair scheduling (DRF — Dominant Resource Fairness); "negotiation in multi-agent systems"; QoS arbitration
> **Coupling:** 🟡 — chạm multi-agent coordination + scheduler
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (256 contract-net + 302 inference-budget sẵn — thiếu bidding/budget + fairness + live negotiation)
> **Effort:** 4-5 tuần

## Nguồn gốc

Contract Net Protocol (Smith 1980): task announce → agents **bid** (capability + cost) → manager chọn cheapest/best → award. Market-based scheduling: resource = hàng hóa, agents = buyer, **price** điều tiết cung-cầu. Auction (VCG): fair allocation — truthful bidding. DRF (Dominant Resource Fairness): multi-resource (CPU + memory + token) fair share — agent lấy max-ratio resource → cân bằng. Negotiation (MAS): agent propose/counter-offer → reach agreement (vs centralized dictate). Cốt lõi: **không ai phát tài nguyên** — agents đàm phán/bid → phân bổ công bằng + hiệu quả.

## Mô tả

mya resource negotiation: khi nhiều agent (subagents, parallel turns) cần resource hạn chế (LLM token budget 302, tool concurrency, API rate-limit) → **negotiate**. (1) **announce** — manager publish available capacity (token/call budget); (2) **bid** — mỗi agent đề xuất cần bao nhiêu + priority (deadline, critical-path 315); (3) **arbitrate** — DRF hoặc auction → phân bổ công bằng; (4) **enforce** — agent chỉ được dùng đã cấp. Nối 256 contract-net (bidding), 302 inference-budget (token = resource), 315 plan-merge (critical-path priority).

## Kiến trúc

```
  MANAGER / ARBITER
  capacity: { tokens: 100k, toolCalls: 50, rateLimit: 10/s }
        │
        │ announce capacity
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  AGENTS BID                                          │
  │  Agent A: { want: 40k tok, priority: HIGH (deadline)}│
  │  Agent B: { want: 30k tok, priority: MED             }│
  │  Agent C: { want: 50k tok, priority: LOW              }│
  └──────────────────┬───────────────────────────────────┘
                     │ bids
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  ARBITER (DRF / auction / priority-weighted)         │
  │  total want 120k > 100k → must allocate fairly:      │
  │   A (HIGH): 40k ✓ (deadline — must meet)             │
  │   B (MED):  30k ✓                                     │
  │   C (LOW):  100k-40k-30k = 30k (capped, not full)    │
  │  C counter-offer: "I'll defer" → re-bid later        │
  └──────────────────┬───────────────────────────────────┘
                     │ allocation
                     ▼
  ┌──────────────────────────────────────────────────────┐
  │  ENFORCE (metered — agent can't exceed allocation)   │
  │  counter per agent → hard cap (302 budget style)     │
  └──────────────────────────────────────────────────────┘
```

```
mya: 256 contract-net + 302 inference-budget sẵn — thiếu bidding + DRF fairness + live negotiation loop
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 256 contract-net — bidding concept (documented)
// ✅ 302 inference-budget-arbitration — token budget (documented)
// ✅ 315 plan-merge — critical-path priority (documented)
// ✅ 233 work-stealing — load balance (documented)

// ❌ THIẾU: bidding protocol (agent → arbiter)
// ❌ THIẾU: DRF / fairness allocation (multi-resource)
// ❌ THIẾU: enforce (metered hard cap per agent)
// ❌ THIẾU: live negotiation (counter-offer / defer)
```

## Implementation

```typescript
// packages/agent/src/negotiation.ts (NEW)
interface Bid { agent: string; want: Record<string, number>; priority: number; deadline?: number; }
interface Capacity { tokens: number; toolCalls: number; }

export class ResourceArbiter {
  constructor(private capacity: Capacity) {}

  allocate(bids: Bid[]): Record<string, Partial<Capacity>> {
    // Priority-weighted fair share (DRF-inspired)
    // Sort: deadline first, then priority desc
    const sorted = [...bids].sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline - b.deadline;
      return b.priority - a.priority;
    });
    let remainingTokens = this.capacity.tokens;
    let remainingCalls = this.capacity.toolCalls;
    const alloc: Record<string, Partial<Capacity>> = {};

    for (const b of sorted) {
      const grantTok = Math.min(b.want.tokens ?? 0, remainingTokens);
      const grantCalls = Math.min(b.want.toolCalls ?? 0, remainingCalls);
      alloc[b.agent] = { tokens: grantTok, toolCalls: grantCalls };
      remainingTokens -= grantTok;
      remainingCalls -= grantCalls;
      if (grantTok < (b.want.tokens ?? 0)) {
        b.deferred = true; // couldn't get full → defer / re-bid
      }
    }
    return alloc;
  }
}

// Agent-side: bid + honor allocation (metered)
class NegotiatingAgent {
  private spent = { tokens: 0, toolCalls: 0 };
  constructor(private id: string, private arbiter: ResourceArbiter) {}

  async request(need: Partial<Capacity>, priority: number): Promise<Partial<Capacity>> {
    const alloc = this.arbiter.allocate([{ agent: this.id, want: need, priority }]);
    return alloc[this.id]!;
  }

  canSpend(cost: Partial<Capacity>): boolean {
    return (this.spent.tokens + (cost.tokens ?? 0)) <= this.allocation.tokens
      && (this.spent.toolCalls + (cost.toolCalls ?? 0)) <= this.allocation.toolCalls;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân bổ công bằng (DRF — multi-resource) | ❌ Negotiation overhead (round-trip latency) |
| ✅ Priority-aware (deadline, critical-path) | ❌ Bidding complexity (strategic agents game it) |
| ✅ Fair — không agent chiếm hết | ❌ Starvation (low-priority luôn defer) |
| ✅ Market-style efficiency (VCG/auction) | ❌ Capacity estimate khó (dynamic load) |

## Khác các hướng gần

| | 256 Contract-Net | 302 Inference-Budget | LD: Resource Negotiation |
|---|---|---|---|
| Mục | Chọn agent cho task | Cap token cost | **Chia tài nguyên giữa agents** |
| Bid | Capability | ❌ (static cap) | **✅ bid + counter-offer** |
| Fairness | Best-bid wins | Per-turn cap | **DRF multi-resource fair** |

## Khi nào chọn

- Nhiều agent cạnh tranh resource hạn chế (token, rate-limit)
- Cần công bằng (không agent chiếm hết — DRF)
- Priority khác nhau (deadline, critical-path 315)
- Nối 256 contract-net + 302 budget + 315 plan-merge + 233 work-stealing
