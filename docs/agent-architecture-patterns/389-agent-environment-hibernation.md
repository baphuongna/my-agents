# Hướng NY: Agent Environment Hibernation — sleep khi idle, wake-on-demand

> **Nguồn gốc:** OS hibernation/sleep (S3 suspend-to-RAM, S4 hibernate-to-disk); "wake-on-demand"; "cold start vs warm start"; "scale-to-zero" (serverless FaaS); hermes-agent; laptop sleep/wake
> **Coupling:** 🟡 — thêm hibernate/wake state machine + snapshot/restore
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (lifecycle-hooks + memory sẵn — chưa có hibernate snapshot + wake-on-demand)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OS hibernation/sleep**: laptop idle → sleep (S3 suspend-to-RAM — giữ state, tắt CPU; S4 hibernate-to-disk — ghi state ra disk, tắt hoàn toàn). **Wake-on-demand**: event đến (key press, network packet, wake-on-LAN) → wake → resume state cũ. **Scale-to-zero** (serverless FaaS — AWS Lambda, Cloud Run): không request → scale về 0 (không tốn resource); request đến → cold start → serve. **Snapshot/restore**: ghi toàn bộ state (memory, context, queue) ra disk → tắt process; restore lại khi wake. Nguyên tắc: agent **idle quá lâu → hibernate** (snapshot state, tắt process, tiết kiệm resource); **request đến → wake** (restore state, resume). Khác **384 daemon** (always-on) — NY **sleep để tiết kiệm**; khác **390 low-cost-triggers** (wake on condition) — NY là **hibernate mechanism**.

## Mô tả

mya agent environment hibernation: khi agent idle (không có task) quá threshold → **hibernate**: snapshot state (memory/context/queue) ra disk, tắt process (giải phóng CPU/RAM). Khi request đến (wake trigger: new message, scheduled event, 390 watcher hit) → **wake**: restore state từ disk, resume agent. Lợi: tiết kiệm resource (scale-to-zero). mya có `292 lifecycle-hooks` + `packages/memory` — NY thêm **hibernate snapshot/restore** + **idle detection** + **wake trigger**.

## Kiến trúc

```
   AGENT RUNNING (active)
        │
        │  no task > IDLE_THRESHOLD (e.g. 5 min)
        ▼
   ┌── HIBERNATE ────────────────────────────────────┐
   │  1. snapshot state:                              │
   │     · memory/context → disk (.hibernate/<id>)    │
   │     · pending queue → disk                       │
   │     · conversation history → disk                │
   │  2. graceful shutdown (292 hooks cleanup)        │
   │  3. process EXIT (CPU/RAM freed)                 │
   └──────────────────────────────────────────────────┘
        │ (agent tắt — scale-to-zero)
        ▼
   WAKE TRIGGER (new message / scheduled / 390 watcher)
        │
        ▼
   ┌── WAKE (restore) ───────────────────────────────┐
   │  1. spawn process                                │
   │  2. restore state from disk (.hibernate/<id>)    │
   │     · memory/context                             │
   │     · pending queue                              │
   │  3. resume agent (như chưa từng sleep)           │
   └──────────────────────────────────────────────────┘
        │
        ▼
   AGENT RUNNING (active again)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 292 agent-lifecycle-hooks — hooks (nền — NY hibernate/wake trigger)
// ✅ packages/memory — store state (nền — NY snapshot/restore)
// ✅ 381 broker — mailbox (nền — message chờ khi hibernate)
// ✅ 384 daemon — supervisor (nền — NY là alternative tiết kiệm)

// ❌ THIẾU: hibernate snapshot (serialize state → disk)
// ❌ THIẾU: wake restore (deserialize disk → state)
// ❌ THIẾU: idle detection (no task > threshold → hibernate)
// ❌ THIẾU: wake trigger (new message → spawn + restore)
```

## Implementation

```typescript
// packages/agent/src/hibernation.ts (MỚI)
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface AgentSnapshot {
  agentId: string;
  memory: unknown;       // context/memory state
  pendingQueue: unknown[];
  conversation: unknown[];
  hibernatedAt: number;
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min idle → hibernate

class HibernateManager {
  constructor(private snapshotDir: string) {}

  // Hibernate — snapshot + exit
  async hibernate(agentId: string, state: Omit<AgentSnapshot, 'hibernatedAt'>): Promise<void> {
    const snapshot: AgentSnapshot = { ...state, hibernatedAt: Date.now() };
    writeFileSync(this.path(agentId), JSON.stringify(snapshot)); // snapshot → disk
    // graceful shutdown via 292 hooks → process exit
  }

  // Wake — restore from disk
  async wake(agentId: string): Promise<AgentSnapshot | null> {
    if (!existsSync(this.path(agentId))) return null;
    const snapshot = JSON.parse(readFileSync(this.path(agentId), 'utf8')) as AgentSnapshot;
    return snapshot; // caller restores memory/queue/conversation
  }

  // Idle detection — call periodically
  shouldHibernate(lastActivityAt: number): boolean {
    return Date.now() - lastActivityAt > IDLE_THRESHOLD_MS;
  }

  private path(agentId: string): string {
    return join(this.snapshotDir, `${agentId}.hibernate.json`);
  }
}

// Wake trigger wired to broker 381:
// broker.on('message', async (targetId) => {
//   if (manager.hasSnapshot(targetId)) await spawnAndRestore(targetId);
// });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm resource (scale-to-zero khi idle) | ❌ Cold start latency (wake = spawn + restore) |
| ✅ Snapshot/restore (state không mất) | ❌ Snapshot serialization overhead |
| ✅ Không tốn CPU/RAM khi idle | ❌ Disk I/O (snapshot read/write) |
| ✅ Nối 381 mailbox (msg chờ khi sleep) | ❌ Snapshot có thể stale (state đổi sau hibernate) |

## Khác các hướng gần

| | 384 Daemon Lifecycle | 292 Lifecycle Hooks | 390 Low-Cost Triggers | NY: Hibernation |
|---|---|---|---|---|
| Cái gì | Always-on supervisor | Event hooks | Cheap watcher wake | **Sleep/wake tiết kiệm** |
| When idle | Luôn chạy | ❌ | ❌ | ✅ hibernate |
| Resource | Tốn (always-on) | — | — | ✅ scale-to-zero |
| Wake | — | — | on condition | ✅ on-demand restore |

## Khi nào chọn

- Agent idle nhiều (không cần always-on — tiết kiệm resource)
- Resource giới hạn (RAM/CPU/GPU mệt)
- Chấp nhận cold start latency (wake = spawn + restore)
- Kết hợp 384 daemon (nếu cần always-on) HOẶC NY hibernation (nếu cần tiết kiệm); nối 381 mailbox (message chờ khi sleep) + 390 low-cost triggers (wake chỉ khi trúng điều kiện — tránh wake liên tục)
