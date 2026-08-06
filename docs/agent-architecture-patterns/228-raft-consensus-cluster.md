# Hướng HT: Raft Consensus Cluster — nhân bản trạng thái, leader election, majority quorum

> **Nguồn gốc:** Raft (Ongaro & Ousterhout, 2014 — "In Search of an Understandable Consensus Algorithm", 4793 cites); Wikipedia "Raft (algorithm)"; Stanford lecture; raft.github.io
> **Coupling:** 🟡 — cluster node cần chạy Raft protocol
> **Agent-agnostic:** ✅ — bất kỳ agent chạy trong cluster
> **Code sẵn:** ⚠️ (intercom sẵn — thiếu Raft consensus)
> **Effort:** 3-5 tuần

## Nguồn gốc

Raft (Ongaro & Ousterhout, 2014): thuật toán consensus **dễ hiểu hơn Paxos** — elect 1 leader, leader replicate log tới followers, majority quorum (N/2+1) commit. Mỗi node chạy **replicated state machine (RSM)**: cùng input → cùng output → cùng state. Google SRE Book: "A replicated state machine executes the same set of operations, in the same order, on several processes." Leader election: random timeout → candidate → RequestVote → majority → leader. Log replication: leader append entry → AppendEntries RPC → followers persist → majority ack → commit. Failover: leader chết → timeout → new election → new leader replays log.

## Mô tả

mya Raft cluster: nhiều mya-gateway node chạy đồng thời, 1 leader xử lý requests, followers standby. Nếu leader crash → followers elect leader mới (< 1 giây). State (sessions, kanban, cron schedule) replicated trên tất cả node. Agent sessions transparently failover. mya hiện chạy single-node — Raft thêm HA mà agent không thấy khác biệt.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                   RAFT CLUSTER (mya-gateway)                 │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  NODE A      │  │  NODE B      │  │  NODE C      │       │
│  │  ★ LEADER    │  │  FOLLOWER    │  │  FOLLOWER    │       │
│  │              │  │              │  │              │       │
│  │  RSM state   │  │  RSM state   │  │  RSM state   │       │
│  │  sessions    │  │  sessions    │  │  sessions    │       │
│  │  kanban      │  │  kanban      │  │  kanban      │       │
│  │  cron        │  │  cron        │  │  cron        │       │
│  └──────┬───────┘  └──────▲───────┘  └──────▲───────┘       │
│         │  AppendEntries  │                │                │
│         ├────────────────►│                │                │
│         ├─────────────────┼───────────────►│                │
│         │                 │  majority ack  │                │
│         │◄────────────────┤                │                │
│                                                              │
│  Client → Leader (any node redirects to leader)             │
│  Leader crash → election → new leader → transparent         │
└──────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 13 intercom — messaging giữa agent (nhưng single-node)
// ✅ 16 policy engine — gate (cần replicate policy state)
// ✅ kanban-sqlite — task state (cần replicate)
// ✅ cron — schedule (cần replicate + leader-only execution)
// ✅ session JSONL — state (cần replicate)

// ❌ THIẾU: Raft consensus library (openraft, tikv/raft-rs)
// ❌ THIẾU: leader election (hiện single-process)
// ❌ THIẾU: log replication (hiện local SQLite/JSONL)
// ❌ THIẾU: transparent failover (agent session migration)
```

## Implementation

```typescript
// packages/raft/src/index.ts (NEW) — sử dụng openraft crate (Rust) hoặc js-raft
import { openraft } from "openraft"; // hoặc Node.js Raft library

class MyaRaftCluster {
  private raft: RaftNode;

  async propose(command: AgentCommand): Promise<CommitResult> {
    // Leader: append to log → replicate → majority → commit → apply to RSM
    return this.raft.clientWrite(command);
  }

  async getLeader(): Promise<string> {
    return this.raft.currentLeader();
  }

  // RSM apply: khi log entry committed → apply tới state
  apply(entry: LogEntry): void {
    switch (entry.type) {
      case "create_session": this.sessions.create(entry.payload); break;
      case "spawn_agent": this.agents.spawn(entry.payload); break;
      case "cron_claim": this.cron.atomicClaim(entry.payload); break;
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ HA — leader crash → failover < 1s | ❌ Complexity (Raft protocol, split-brain) |
| ✅ Zero downtime (agent session survives) | ❌ Latency overhead (quorum round-trip) |
| ✅ State consistency (RSM — all nodes same) | ❌ Minimum 3 nodes (quorum requirement) |
| ✅ Proven (etcd, TiKV, CockroachDB) | ❌ Write throughput limited by leader |
| ✅ Transparent to agents | ❌ Operational burden (cluster management) |

## Khác các hướng gần

| | 13 Message Broker | 26 Actor Model | HT: Raft Cluster |
|---|---|---|---|
| Mục | Async messaging | Concurrency model | **Consensus + HA** |
| Replication | ❌ | ❌ | ✅ RSM |
| Leader | ❌ | Per-actor | ✅ Single leader |
| Failover | ❌ | Supervisor restart | ✅ Transparent |

## Khi nào chọn

- Cần HA (mya-gateway không được chết)
- Nhiều node chạy đồng thời (multi-region, multi-machine)
- State nhất quán giữa node (sessions, cron schedule)
- OK với complexity (Raft protocol, 3+ node minimum)
