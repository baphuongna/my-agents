# Hướng AIH: Singleton-Lock-Registry — locks dùng registry dùng chung `~/.pi/agent/locks.json` với key là extension identity ổn định (package name → dir name → file basename), field `pid` + `cwd`; khi PID stale thì thay entry, PID+cwd khớp thì refresh — chuẩn cross-project cho singleton extension

> **Nguồn gốc:** pi-telegram | **Coupling:** 🟢 — singleton lock | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có cross-process-lock + stale-lock; chưa có shared registry + identity fallback) | **Effort:** 1 tuần

## Nguồn gốc

**pi-telegram** locks dùng **registry dùng chung** `~/.pi/agent/locks.json` với key là **extension identity ổn định** (package name → dir name → file basename), field `pid` + `cwd`; khi **PID stale thì thay entry**, **PID+cwd khớp thì refresh** — chuẩn cross-project cho singleton extension. Nguyên tắc: **shared registry** — một file locks.json cho mọi extension (không per-extension lock file); **stable identity fallback** — package name → dir name → file basename (ổn định khi thiếu package.json); **stale replace** — PID chết → thay; **match refresh** — cùng PID+cwd → refresh TTL.

## Mô tả

Với mya, pattern = **singleton lock registry**: (1) mya đã có **cross-process-lock.ts** (packages/cron) — PID liveness + TTL, và **stale-lock.ts** (packages/gateway) — TTL + PID + atomic rename; (2) AIH thêm **shared registry** `~/.mya/agent/locks.json` — `{ [identity]: { pid, cwd, ts } }`; (3) **identity fallback chain**: `package.json#name` → `dir name` → `file basename` (ổn định dần); (4) **acquire**: PID stale OR no entry → replace; PID+cwd match → refresh ts; (5) **release**: delete entry if own.

## Kiến trúc (ASCII)

```
  ~/.mya/agent/locks.json  (SHARED registry — mọi extension)
    {
      "pi-telegram":     { pid: 1234, cwd: "/x", ts: ... },   ← package name
      "my-ext-dir":      { pid: 5678, cwd: "/y", ts: ... },   ← dir name (no pkg)
      "standalone-sh":   { pid: 9012, cwd: "/z", ts: ... }    ← file basename
    }
         │
         ▼ IDENTITY FALLBACK CHAIN:
         package.json#name ──(thiếu?)──► dir name ──(thiếu?)──► file basename
         │
         ▼ ACQUIRE:
         ├─ entry có, PID stale (process.kill(pid,0) fail) ──► REPLACE entry
         ├─ entry có, PID+cwd khớp (refresh)              ──► REFRESH ts
         ├─ entry có, PID sống nhưng cwd khác             ──► DENY (other instance)
         └─ no entry                                       ──► CREATE entry
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/cron cross-process-lock.ts — PID liveness (process.kill(pid,0))
//   + TTL + own-check (pid match before release)
// ✅ packages/gateway stale-lock.ts — TTL + PID + atomic tombstone rename
// ✅ packages/core time.ts — nowWallclock (TTL ts)

// ❌ THIẾU: shared registry (~/.mya/agent/locks.json — multi-key)
// ❌ THIẾU: identity fallback chain (pkg name → dir → basename)
// ❌ THIẾU: PID+cwd match refresh (hiện chỉ PID)
```

## Implementation

```typescript
// packages/core/src/singleton-lock-registry.ts (NEW)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

const REGISTRY = join(homedir(), ".mya", "agent", "locks.json");
const TTL_MS = 60_000;
const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Identity fallback: package name → dir name → file basename. */
export function stableIdentity(entryFile: string): string {
  try {
    const dir = dirname(entryFile);
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) { const n = JSON.parse(readFileSync(pkg, "utf8")).name; if (n) return n; }
    return basename(dir) || basename(entryFile);
  } catch { return basename(entryFile); }
}

/** Acquire singleton — stale replace, match refresh, other deny. */
export function acquireSingleton(identity: string, now: number): boolean {
  const reg: Record<string, { pid: number; cwd: string; ts: number }> =
    existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, "utf8")) : {};
  const me = { pid: process.pid, cwd: process.cwd(), ts: now };
  const cur = reg[identity];
  if (!cur || !isAlive(cur.pid)) { reg[identity] = me; }            // stale/none → REPLACE
  else if (cur.pid === me.pid && cur.cwd === me.cwd) { reg[identity] = me; } // match → REFRESH
  else if (now - cur.ts > TTL_MS) { reg[identity] = me; }           // TTL expire → REPLACE
  else return false;                                                 // other live → DENY
  mkdirSync(dirname(REGISTRY), { recursive: true });
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2), { mode: 0o600 });
  return true;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Shared registry — 1 file cho mọi extension | ❌ Registry file = SPOF (corrupt = all lose) |
| ✅ Identity fallback ổn định (pkg→dir→basename) | ❌ PID+cwd match — cwd đổi = denY nhầm |
| ✅ Stale replace + match refresh | ❌ TTL expire có thể preempt hợp lệ (clock) |
| ✅ Nối cross-process-lock + stale-lock sẵn | ❌ Concurrent write registry cần atomic (AHT) |

## Khác các hướng gần

| | AIH Singleton-Lock-Registry | AIC Per-Session-Registry-Claim | AII Multi-Instance-Bus-Leader |
|---|---|---|---|
| Trọng tâm | Singleton extension cross-project | Singleton manager per-session | Leader poll multi-instance |
| Cơ chế | Shared registry + identity fallback | Symbol.for + first-wins | Leader/follower + heartbeat |
| Quan hệ | Cross-process lock | In-process registry | Cross-process coordination |

## Khi nào chọn

- Nhiều singleton extension cần lock cross-project
- Extension có thể thiếu package.json → cần identity fallback
- PID stale phải recover tự động
- Guard: atomic registry write (AHT), identity fallback stable, PID+cwd match, TTL ceiling, corrupt-recovery
