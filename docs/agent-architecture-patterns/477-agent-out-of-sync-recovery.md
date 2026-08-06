# Hướng RI: Agent Out-of-Sync Recovery — đo độ lệch giữa agent state và shared state rồi kéo về

> **Nguồn gốc:** Papers (SyncMind); "measure agent out-of-sync with shared state"; "detect divergence between agent mental model and ground truth"; "resync agent to shared state"; "drift detection + recovery"
> **Coupling:** 🟡 — thêm sync-check + recovery vào agent state management
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session state + context sẵn — chưa có sync measurement + recovery)
> **Effort:** 3-4 tuần

## Nguồn gốc

**SyncMind** paper đo **out-of-sync** giữa **agent mental state** (những gì agent biết tin) và **shared state** (ground truth thật trong FS/git/memory). Khi agent edit file nhưng teammate cũng edit → agent state stale (agent tưởng file còn A, thật đã thành B). SyncMind **đo độ lệch** (hash compare, version diff, timestamp check) → nếu drift quá ngưỡng → **recovery**: pull fresh state, re-baseline agent context, re-plan dựa state mới. Nguyên tắc: **agent phải sync với ground truth** — không tin stale state, detect drift, recover. Khác **476 fuzzer-feedback** (verify code) — RI là **state sync**; khác **434 server-snapshot** (broadcast state) — RI là **detect + recover drift**.

## Mô tả

mya agent out-of-sync recovery: (1) **State tracking**: agent có mental state snapshot (files read, edits made, assumptions held). (2) **Sync check**: định kỳ hoặc trước action quan trọng → **compare** agent state vs shared state (hash file, version git, timestamp memory). (3) **Drift detection**: nếu mismatch > threshold → **out-of-sync** (agent state stale). (4) **Recovery**: agent **re-sync** — pull fresh shared state, update context (replace stale assumptions), re-plan dựa state mới. (5) **Drift log**: track when/what drifted (audit trail). mya có session state + context — RI thêm **sync checker** (state compare) + **drift detector** (threshold) + **recovery** (re-sync + re-plan).

## Kiến trúc

```
  ┌─── AGENT MENTAL STATE ───┐    ┌─── SHARED STATE (ground truth) ───┐
  │  auth.ts: hash=abc123     │    │  auth.ts: hash=def456 (changed!)   │
  │  config.json: ver=2       │    │  config.json: ver=3 (bumped!)      │
  │  memory: "deploy=v1.2"    │    │  memory: "deploy=v1.3"             │
  └─────────────┬─────────────┘    └───────────────┬────────────────────┘
                │                                   │
                └────────── SYNC CHECK ─────────────┘
                                 │
                                 ▼
  ┌─── DRIFT DETECTION ──────────────────────────────────────────────┐
  │  auth.ts:    abc123 ≠ def456  → DRIFTED (file changed)            │
  │  config.json: ver2 ≠ ver3     → DRIFTED (version bumped)          │
  │  memory:     v1.2 ≠ v1.3      → DRIFTED (memory updated)          │
  │  → drift score: 3/3 = 100% OUT OF SYNC                            │
  └───────────────────────────┬──────────────────────────────────────┘
                              │ drift > threshold (e.g. >0%)
                              ▼
  ┌─── RECOVERY (re-sync + re-plan) ─────────────────────────────────┐
  │  1. PULL FRESH shared state (re-read auth.ts, config, memory)      │
  │  2. UPDATE context (replace stale assumptions with fresh state)     │
  │  3. RE-PLAN (assumptions changed → plan must adapt)                 │
  │  4. LOG drift (auth.ts changed by teammate at T, config bumped)     │
  │  → agent now in-sync with ground truth                              │
  └───────────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session state (packages/core) — agent state (nền — RI = sync this with ground truth)
// ✅ context management — agent context (nền — RI = replace stale context on drift)
// ✅ 434 server-snapshot — state broadcast (nền — RI = detect drift in received state)

// ❌ THIẾU: sync checker (compare agent state vs shared state)
// ❌ THIẾU: drift detector (threshold-based out-of-sync flag)
// ❌ THIẾU: recovery (re-sync + update context + re-plan)
// ❌ THIẾU: drift log (when/what drifted — audit trail)
```

## Implementation

```typescript
// packages/agent/src/out-of-sync-recovery.ts (MỚI)
interface StateSnapshot {
  entries: Map<string, string>; // key (file path / memory key) → hash/version
}
interface DriftEntry {
  key: string;
  agentValue: string;
  sharedValue: string;
  drifted: boolean;
}
interface DriftResult {
  entries: DriftEntry[];
  driftScore: number; // 0.0–1.0 (fraction of drifted keys)
  outOfSync: boolean;
}

class OutOfSyncRecovery {
  private agentState: StateSnapshot = { entries: new Map() };
  private driftLog: { key: string; at: number; from: string; to: string }[] = [];

  // Agent records what it believes (mental state)
  recordAgentState(key: string, hash: string): void {
    this.agentState.entries.set(key, hash);
  }

  // Sync check: compare agent state vs shared state
  checkSync(sharedState: StateSnapshot): DriftResult {
    const entries: DriftEntry[] = [];
    for (const [key, agentValue] of this.agentState.entries) {
      const sharedValue = sharedState.entries.get(key) ?? '<missing>';
      const drifted = agentValue !== sharedValue;
      entries.push({ key, agentValue, sharedValue, drifted });
    }
    const driftedCount = entries.filter(e => e.drifted).length;
    const driftScore = entries.length > 0 ? driftedCount / entries.length : 0;
    return { entries, driftScore, outOfSync: driftScore > 0 };
  }

  // Recovery: re-sync agent to shared state
  recover(sharedState: StateSnapshot, drift: DriftResult): { resynced: string[]; replanNeeded: boolean } {
    const resynced: string[] = [];
    for (const entry of drift.entries.filter(e => e.drifted)) {
      const fresh = sharedState.entries.get(entry.key);
      if (fresh) {
        this.agentState.entries.set(entry.key, fresh);
        this.driftLog.push({ key: entry.key, at: Date.now(), from: entry.agentValue, to: entry.sharedValue });
        resynced.push(entry.key);
      }
    }
    // Re-plan needed if any critical state drifted
    const replanNeeded = resynced.length > 0;
    return { resynced, replanNeeded };
  }

  // Full sync cycle: check → recover if needed
  syncCycle(
    sharedState: StateSnapshot,
    replan: (resynced: string[]) => void,
  ): { outOfSync: boolean; resynced: string[] } {
    const drift = this.checkSync(sharedState);
    if (!drift.outOfSync) return { outOfSync: false, resynced: [] };
    const recovery = this.recover(sharedState, drift);
    if (recovery.replanNeeded) replan(recovery.resynced);
    return { outOfSync: true, resynced: recovery.resynced };
  }
}

// Usage:
// const sync = new OutOfSyncRecovery();
// sync.recordAgentState('src/auth.ts', hashA);
// const drift = sync.checkSync(sharedState);  // compare with ground truth
// if (drift.outOfSync) sync.recover(sharedState, drift);  // re-sync
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Detect drift (agent state stale → biết ngay) | ❌ Sync overhead (hash compare mỗi check) |
| ✅ Auto-recovery (re-sync + re-plan tự động) | ❌ Re-plan cost (drift → replan = token/time) |
| ✅ Ground truth trust (không tin stale state) | ❌ False drift (benign change flagged as drift) |
| ✅ Audit trail (drift log — who/what/when) | ❌ Complexity (state tracking + sync + recovery) |

## Khác các hướng gần

| | 434 Server-Snapshot | 476 Fuzzer-Feedback | RI: Out-of-Sync-Recovery |
|---|---|---|---|
| Cái gì | Broadcast state | Verify code | **Detect + recover state drift** |
| Khi | State change | After code | **Before critical action** |
| Recovery | Re-broadcast | Re-verify | **Re-sync + re-plan** |

## Khi nào chọn

- Multi-agent hoặc collaborative env (shared state thay đổi ngoài agent)
- Muốn agent sync ground truth (không stale assumption)
- Cần drift detection + recovery (detect → re-sync → re-plan)
- Nối session state (RI = sync this) + 434 server-snapshot (RI = drift detection on received snapshot); guard sync frequency (quá thường = overhead, quá hiếm = miss drift) + replan threshold (drift nhỏ không replan, lớn mới replan)
