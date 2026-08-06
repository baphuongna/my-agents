# Hướng JA: Multi-Region Failover — HA nhiều vùng, chuyển khi vùng chết

> **Nguồn gốc:** AWS multi-AZ/multi-region; Netflix "Active-Active" deployment; "Designing for Failure"; GCP multi-region; CockroachDB geo-distribution; Huy (228) Raft consensus
> **Coupling:** 🔴 — cần infra multi-region + health routing
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (provider failover sẵn — thiếu region routing + data replication)
> **Effort:** 4-6 tuần

## Nguồn gốc

Multi-region failover: chạy ở **nhiều vùng địa lý** — khi 1 vùng chết (outage), traffic chuyển sang vùng khác, downtime gần 0. Netflix "Active-Active": cả 2 region phục vụ song song, không standby idle. AWS: multi-AZ (availability zone) trong region, multi-region (geographic). CockroachDB: geo-distributed — data replicated cross-region, survive region loss. Design principle: "design for failure" — giả định mọi thứ chết, redundancy everywhere. Failover trigger: health check fail (203 failure-detection) → DNS/routing chuyển region. Data: eventual consistency cross-region (CAP theorem — partition tolerance bắt buộc).

## Mô tả

mya multi-region: gateway chạy ở 2+ region (us-east, eu-west). LB (DNS/Anycast) route request → region khỏe nhất. Khi region A chết → health check (203) fail → traffic route sang B trong vài giây. Data (session state, memory) replicate cross-region (HV 230 event store). LLM inference: provider có nhiều region endpoint — failover khi 1 region rate-limit/down. Nối HT (228) Raft: consensus quyết primary region. Nối HU (229) distributed-lock: cross-region lock tránh double-process. Tradeoff: latency (cross-region sync chậm) vs consistency (CAP).

## Kiến trúc

```
  CLIENT ──► GLOBAL DNS / ANYCAST LB
                 │
        ┌────────┴────────┐
        ▼                 ▼
  ┌───────────┐     ┌───────────┐
  │ REGION A  │     │ REGION B  │
  │ (us-east) │     │ (eu-west) │
  │           │     │           │
  │ gateway   │     │ gateway   │
  │ agent x3  │     │ agent x3  │
  │ SQLite    │     │ SQLite    │
  │  ↕ repl.  │◄───►│  ↕ repl.  │  ← async replication (eventual)
  │ LLM:      │     │ LLM:      │
  │  openai   │     │  openai   │
  │  us-east  │     │  eu-west  │
  └─────┬─────┘     └─────┬─────┘
        │ health ✓         │ health ✓

  OUTAGE in A: health ✗ → LB routes ALL → B (failover ~5s)
  RECOVERY A:  health ✓ → LB rebalance (active-active)
```

```
mya: provider failover sẵn — thiếu: region routing + cross-region data replication + health-based LB
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ provider abstraction — multiple LLM endpoints (sẵn)
// ✅ 203 failure-detection — health check (sẵn)
// ✅ HT (228) raft-consensus — leader election (documented)
// ✅ HU (229) distributed-locking — cross-node lock (documented)
// ✅ HV (230) event-sourcing — event store (documented)

// ❌ THIẾU: region routing (DNS/Anycast LB)
// ❌ THIẾU: cross-region data replication (session/memory sync)
// ❌ THIẾU: active-active deployment (hiện single-region)
// ❌ THIẾU: failover automation (health → reroute)
```

## Implementation

```typescript
// packages/gateway/src/multi-region.ts (NEW)
interface Region {
  id: string;
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
}

export class RegionRouter {
  private regions: Region[] = [];

  constructor(private healthCheckIntervalMs = 5000) {
    setInterval(() => this.pollHealth(), this.healthCheckIntervalMs);
  }

  // Route to healthiest region (active-active)
  async route<T>(op: () => Promise<T>): Promise<T> {
    const healthy = this.regions.filter((r) => r.healthy).sort((a, b) => a.latencyMs - b.latencyMs);
    if (healthy.length === 0) throw new Error("all regions down");

    for (const region of healthy) {
      try {
        return await op(region); // try best region first
      } catch (e) {
        region.healthy = false; // mark down — failover to next
        await audit("region-failover", { from: region.id }); // 198
      }
    }
    throw new Error("all healthy regions failed");
  }

  private async pollHealth(): Promise<void> {
    await Promise.all(this.regions.map(async (r) => {
      const start = Date.now();
      try {
        await fetch(`${r.endpoint}/health`, { signal: timeout(2000) });
        r.healthy = true; r.latencyMs = Date.now() - start; // 203 detection
      } catch { r.healthy = false; }
    }));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Downtime gần 0 khi region chết (Netflix active-active) | ❌ Cross-region latency (CAP — sync chậm) |
| ✅ Geographic redundancy (AWS multi-region) | ❌ Data replication complexity (eventual consistency) |
| ✅ Active-active — không resource idle | ❌ Cost 2x+ (mỗi region full stack) |
| ✅ LLM inference failover (rate-limit/down) | ❌ Split-brain risk (HT 228 Raft cần) |

## Khác các hướng gần

| | 203 Retry Loops | HT (228) Raft | JA: Multi-Region |
|---|---|---|---|
| Mục | Retry per-call | Leader consensus | **Region-level failover** |
| Scope | Per-request | Cluster quorum | **Geographic region** |
| Data | N/A | Replicated log | **Cross-region replication** |

## Khi nào chọn

- HA strict — downtime gần 0 không chấp nhận
- User global — cần region gần (latency)
- Provider LLM hay region-down (rate-limit, outage)
- OK với eventual consistency + cost 2x
- Nối HT (228) Raft + HU (229) lock + 203 health-check
