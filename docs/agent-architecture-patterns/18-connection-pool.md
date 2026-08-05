# Hướng Q: Connection Pool — warm session manager

> **Coupling:** 🟢 Zero — manages subprocess lifecycle
> **Agent-agnostic:** ✅ — bất kỳ agent
> **Effort:** 1 tuần

## Mô tả

mya maintains pool of warm agent sessions. Incoming requests load-balanced across idle sessions. No cold start per request. Sessions stay warm between requests. Like DB connection pool, but for agents.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────┐
│              mya Session Pool (warm)                     │
│                                                          │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│   │ pi-1    │ │ pi-2    │ │claude-1 │ │claude-2 │       │
│   │ idle    │ │ busy    │ │ idle    │ │ busy    │       │
│   │ctx:50%  │ │ctx:80%  │ │ctx:20%  │ │ctx:60%  │       │
│   │model:M3 │ │model:M3 │ │model:S4 │ │model:O4 │       │
│   └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                                                          │
│   Request arrives → pick best idle session               │
│   · lowest context usage                                 │
│   · matching role                                        │
│   · matching model                                       │
│                                                          │
│   No cold start. Session stays warm between requests.    │
│   Like DB connection pool, but for agents.               │
│                                                          │
│   Session full (ctx > 90%)? → compact or recycle.        │
│   Session crashed? → remove from pool, spawn replacement.│
└──────────────────────────────────────────────────────────┘
```

## Session lifecycle

```
1. Pool initialization:
   spawn N warm sessions (configurable)
   pi-1: { status: idle, context: 0%, model: MiniMax-M3 }
   pi-2: { status: idle, context: 0%, model: MiniMax-M3 }
   claude-1: { status: idle, context: 0%, model: claude-sonnet-4 }

2. Request arrives:
   → find best idle session (lowest context, matching model)
   → mark busy
   → forward prompt via stdin/RPC
   → stream response to caller
   → mark idle

3. Session warming (context grows):
   pi-1 context 50% → still usable
   pi-1 context 80% → trigger compaction
   pi-1 context 95% → recycle (kill + spawn fresh)

4. Session health:
   crash detected → remove from pool → spawn replacement
   timeout → kill → recycle
   stale (idle > 1h) → optional keep-warm or recycle

5. Auto-scaling:
   all sessions busy → spawn new (up to maxSessions)
   sessions idle > threshold → trim pool
```

## mya ĐÃ CÓ RuntimePool

```typescript
// packages/print/src/runtimes/pool.ts — ĐÃ IMPLEMENT
export class RuntimePool {
  private sessions = new Map<string, RuntimeSession>();

  async acquire(opts: AcquireOpts): Promise<string> {
    // Find or create session
    // Max sessions cap, idle TTL sweep, per-session creation lock
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    // Forward to session
  }

  async kill(sessionId: string): Promise<void> {
    // Kill and remove
  }

  tree(): SessionTreeNode[] {
    // Session tree (parent → children)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No cold start (sessions stay warm) | ❌ Memory usage (N sessions in memory) |
| ✅ Natural load balancing | ❌ Session context grows (need compaction) |
| ✅ Faster response (no init overhead) | ❌ Complex lifecycle management |
| ✅ Auto-scaling (add/remove sessions) | ❌ Session affinity (same session for same user?) |
| ✅ Health monitoring (crash → recycle) | |

## Khi nào chọn

- High-throughput (many requests/minute)
- Want to avoid cold start latency
- Multiple concurrent users
- OK managing session lifecycle
- Already have RuntimePool (just enhance)
