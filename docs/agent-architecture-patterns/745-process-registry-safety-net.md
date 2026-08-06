# Hướng ABQ: Process Registry Safety Net — registry theo dõi PID subprocess, atexit + lock dọn process tree khi server bị Ctrl+C

> **Nguồn gốc:** free-claude-code (cli/process_registry.py) | **Coupling:** 🟢 — thêm process registry + shutdown cleanup vào host | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có bg-runner + exception-handler — chưa có registry kill-all) | **Effort:** 1 tuần

## Nguồn gốc

**free-claude-code** có **process registry**: theo dõi mọi **PID subprocess** do proxy spawn; khi server bị **Ctrl+C**, một **atexit handler + threading lock** gọi **kill_all_best_effort** để **dọn process tree**: `taskkill /T /F` trên Windows (kill cả cây con), `SIGTERM` trên Unix. Đây là **safety net** cho FastAPI lifespan — nếu chỉ dựa vào cleanup thủ công, subprocess orphan (sống sót sau khi proxy chết) gây rò rỉ tài nguyên/port. Nguyên tắc: **mọi subprocess spawn phải vào registry, shutdown luôn chạy kill_all_best_effort, kill theo process tree (không chỉ PID đơn)**.

## Mô tả

mya process registry safety net: host spawn subprocess (bg session, subagent, tool process) → **đăng ký PID vào registry** (kèm platform-aware kill strategy); khi shutdown (SIGINT/SIGTERM/exit) → **kill_all_best_effort**: trên Windows `taskkill /T /F` (kill tree), trên Unix `SIGTERM` (rồi SIGKILL nếu cần); **threading lock** đảm bảo không double-kill khi nhiều signal cùng lúc. mya có packages/print bg-runner.ts (SIGTERM/SIGINT cleanup) + exception-handler.ts + packages/core exit.ts (exitAfterGracefulShutdown) — ABQ thêm **process registry** (PID tracking) + **kill_all_best_effort** (tree kill platform-aware) + **lock chống double-kill**.

## Kiến trúc

```
  HOST (proxy / gateway / mya)
  │  spawn subprocess (bg session, subagent, tool)
  ▼
  PROCESS REGISTRY (PID + kill strategy)
  ┌───────────────────────────────────────────────┐
  │  registry.add(pid, { platform, tree: true })  │
  │  registry: [pid 1234, pid 5678, pid 9012]     │
  └──────────────────────┬────────────────────────┘
                         │  Ctrl+C / SIGTERM / exit
                         ▼
  SHUTDOWN (threading lock — chống double-kill)
  ┌───────────────────────────────────────────────┐
  │  kill_all_best_effort()                       │
  │    Windows → taskkill /T /F <pid>  (kill tree)│
  │    Unix    → SIGTERM <pid>                    │
  │               (chờ 2s → SIGKILL nếu còn sống) │
  └───────────────────────────────────────────────┘
  → không subprocess orphan sau khi server chết
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print bg-runner.ts — SIGTERM/SIGINT/exit cleanup (nền — ABQ hook)
// ✅ packages/print exception-handler.ts — uncaught exception handler (nền — ABQ trigger)
// ✅ packages/core exit.ts — exitAfterGracefulShutdown (nền — ABQ shutdown path)
// ✅ packages/intercom broker spawn.ts — subprocess spawn (nền — ABQ registry client)

// ❌ THIẾU: process registry (PID tracking + kill strategy per process)
// ❌ THIẾU: kill_all_best_effort (tree kill platform-aware)
// ❌ THIẾU: threading lock (chống double-kill khi signal chồng)
```

## Implementation

```typescript
// packages/print/src/process-registry.ts (MỚI)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const IS_WIN = process.platform === "win32";

/** Registry theo dõi PID subprocess do host spawn. */
export class ProcessRegistry {
  private readonly pids = new Set<number>();
  private killed = false; // lock: chỉ kill một lần

  add(pid: number): void { this.pids.add(pid); }
  remove(pid: number): void { this.pids.delete(pid); }

  /** Kill toàn bộ process tree (best-effort): Windows taskkill /T /F, Unix SIGTERM → SIGKILL. */
  async killAllBestEffort(): Promise<void> {
    if (this.killed) return; // threading-lock analog: chống double-kill
    this.killed = true;
    const pids = [...this.pids];
    this.pids.clear();
    await Promise.allSettled(pids.map(async (pid) => {
      try {
        if (IS_WIN) {
          await execFileP("taskkill", ["/PID", String(pid), "/T", "/F"]); // tree kill
        } else {
          process.kill(pid, "SIGTERM");
          await new Promise(r => setTimeout(r, 2000)); // grace
          try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* đã chết */ }
        }
      } catch { /* best-effort — process có thể đã thoát */ }
    }));
  }
}

// Register + wire vào shutdown:
// const registry = new ProcessRegistry();
// registry.add(spawned.pid!);
// process.once("SIGINT", () => { void registry.killAllBestEffort(); process.exit(130); });
// process.once("SIGTERM", () => { void registry.killAllBestEffort(); process.exit(143); });
// process.on("exit", () => { void registry.killAllBestEffort(); });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không orphan (mọi subprocess bị dọn khi server chết) | ❌ Kill nhầm (process đã thoát nhưng PID tái sử dụng → kill process khác) |
| ✅ Tree kill (Windows /T — cả cây con, không sót) | ❌ Grace timing (chờ 2s → SIGKILL — có thể quá ngắn) |
| ✅ Double-kill an toàn (lock — signal chồng không chạy 2 lần) | ❌ Best-effort (không đảm bảo 100% — process bỏ qua SIGTERM) |
| ✅ Platform-aware (taskkill vs SIGTERM đúng OS) | ❌ Registry leak (spawn mà quên add → không được dọn) |

## Khác các hướng gần

| | Cleanup thủ công | process.on("exit") đơn | ABQ: Process Registry |
|---|---|---|---|
| Theo dõi PID | không | không | **registry rõ** |
| Kill tree | không | không | **taskkill /T /F hoặc SIGTERM→SIGKILL** |
| Double signal | không xử lý | chạy lại | **lock (kill một lần)** |
| Platform | — | — | **Windows/Unix riêng** |

## Khi nào chọn

- Host spawn nhiều subprocess (bg session, subagent, tool process) — cần dọn khi shutdown
- Chạy cross-platform (Windows + Unix — kill strategy khác nhau)
- Muốn safety net cho lifecycle (Ctrl+C không để orphan)
- Nối packages/print bg-runner.ts + exception-handler.ts + packages/core exit.ts + packages/intercom broker spawn.ts; guard pid-reuse (verify process vẫn là process của mình trước khi kill), registry-completeness (mọi spawn path phải add — test coverage), và graceful-order (kill subprocess trước, rồi mới exit chính — không đảo); ABQ = process registry safety net, kết hợp 739 ABK background-watcher-index (watcher cũng là subprocess cần dọn) + core exit.ts (exitAfterGracefulShutdown)
