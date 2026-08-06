# Hướng SJ: Workspace Clone Session Partitioning — session phân vùng theo fingerprint FNV-1a đường dẫn workspace

> **Nguồn gốc:** claw-code (workspace clone session isolation); "session partition by workspace path fingerprint"; "FNV-1a path hash session key"; "clone workspace separate session"; "session isolation per working directory"
> **Coupling:** 🟢 — thêm partition key (FNV-1a hash path) vào session store, không đổi loop
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (session store + cwd tracking sẵn — chưa có FNV-1a partition key)
> **Effort:** 1 tuần

## Nguồn gốc

**claw-code** nhiều workspace clone: user có 2+ bản sao repo (`proj-main/`, `proj-feature-x/`, `proj-experiment/`) — mỗi clone cần **session riêng biệt** (history, memory, state KHÔNG trộn lẫn). Nếu session key chỉ là user-id hoặc global → clone ghi đè lên nhau (history main lẫn feature). **Workspace partition**: session được **phân vùng theo fingerprint đường dẫn workspace** — hash **FNV-1a** (fast, deterministic, non-crypto) của `realpath(cwd)` → partition key. Mỗi clone path → hash khác → session khác → isolation. Nguyên tắc: **path = identity** — session gắn với workspace cụ thể, clone tách biệt. FNV-1a chọn vì nhanh + deterministic (cùng path → cùng hash) + đủ phân tán.

## Mô tả

mya workspace clone session partitioning: (1) **Path resolve**: mỗi session resolve `realpath(cwd)` (canonical, bỏ symlink). (2) **FNV-1a hash**: hash path → fingerprint (ví dụ `a3f9b2c1`, 32-bit). (3) **Partition key**: session key = `<userId>:<workspaceHash>` (mỗi clone → key khác). (4) **Session store partition**: store keyed by partition → clone A (main) và clone B (feature) tách biệt hoàn toàn (history/memory/state riêng). (5) **Cross-clone**: nếu user muốn share → explicit (different mechanism, không tự trộn). mya có session store + cwd tracking — SJ thêm **FNV-1a hasher** + **partition key**.

## Kiến trúc

```
  USER có 3 workspace clone:
  ┌────────────────────┐ ┌─────────────────────┐ ┌──────────────────────┐
  │ /home/u/proj-main  │ │ /home/u/proj-feat-x │ │ /home/u/proj-experiment│
  └─────────┬──────────┘ └──────────┬──────────┘ └──────────┬───────────┘
            │ realpath                │ realpath               │ realpath
            ▼                         ▼                         ▼
  ┌─── FNV-1a HASH ────────────────────────────────────────────────────┐
  │  "proj-main"       → a3f9b2c1                                       │
  │  "proj-feat-x"     → 7e1d4408                                       │
  │  "proj-experiment" → c2a8f135                                       │
  └───────────────┬────────────────────────────────────────────────────┘
                  │
                  ▼
  ┌─── PARTITION KEY (session store) ───────────────────────────────────┐
  │  user:u + a3f9b2c1 → session MAIN    (history/memory riêng)          │
  │  user:u + 7e1d4408 → session FEAT-X  (history/memory riêng)          │
  │  user:u + c2a8f135 → session EXPERIMENT                              │
  │  → 3 clone ISOLATED (không trộn history)                             │
  └──────────────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ session store — keyed session (nền — SJ thêm partition key)
// ✅ cwd tracking — working directory (nền — SJ hash realpath)
// ✅ realpath resolve — canonical path (nền — SJ dùng trước hash)

// ❌ THIẾU: FNV-1a hasher (path → 32-bit fingerprint)
// ❌ THIẾU: partition key (<userId>:<workspaceHash>)
// ❌ THIẾU: session store partition (keyed by partition)
```

## Implementation

```typescript
// packages/core/src/workspace-partition.ts (MỚI)
import { realpathSync } from 'node:fs';

class WorkspacePartition {
  // FNV-1a hash (32-bit, fast, deterministic, non-crypto)
  static fnv1a(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // resolve canonical path → hash
  workspaceHash(cwd: string): string {
    const real = realpathSync(cwd); // canonical (bỏ symlink)
    return WorkspacePartition.fnv1a(real);
  }

  // partition key (session store key)
  partitionKey(userId: string, cwd: string): string {
    return `${userId}:${this.workspaceHash(cwd)}`;
  }

  // session store lookup (partitioned)
  sessionFor(store: Map<string, unknown>, userId: string, cwd: string): unknown {
    const key = this.partitionKey(userId, cwd);
    let s = store.get(key);
    if (!s) { s = { history: [], memory: [] }; store.set(key, s); } // new partition
    return s;
  }
}

// Usage:
// const key = partition.partitionKey(userId, process.cwd());
// // "/home/u/proj-main" → "u:a3f9b2c1"
// // "/home/u/proj-feat-x" → "u:7e1d4408"  (khác → session khác)
// const session = partition.sessionFor(store, userId, cwd);  // isolated per clone
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Clone isolation (history/memory riêng per workspace) | ❌ Không share mặc định (muốn share → explicit) |
| ✅ FNV-1a nhanh (non-crypto, deterministic) | ❌ Hash collision (32-bit — cực hiếm nhưng có thể) |
| ✅ realpath canonical (symlink không đánh lừa) | ❌ realpath overhead (syscall mỗi lookup) |
| ✅ Partition tự động (path = identity) | ❌ Cache (re-hash mỗi lần — memoize nếu cần) |

## Khác các hướng gần

| | Global Session | Per-User Session | SJ: Workspace-Partition |
|---|---|---|---|
| Key | global | userId | **userId + workspaceHash** |
| Clone isolation | ❌ (trộn) | ❌ (trộn clone) | **✅ (per path)** |
| Identity | — | user | **path (FNV-1a)** |

## Khi nào chọn

- User có nhiều workspace clone (main/feature/experiment)
- Muốn session isolated per workspace (không trộn history)
- Path = identity đủ (không cần config thủ công)
- Nối session store + cwd tracking; guard realpath (canonical — symlink resolved) + hash determinism (cùng path → cùng hash) + collision (32-bit đủ cho workspace count nhỏ); memoize hash nếu realpath overhead cao; phối 435 session-log (partition key in header)
