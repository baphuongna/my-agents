# Hướng NT: Agent Daemon Lifecycle — agent chạy như daemon OS (launchd/systemd always-on)

> **Nguồn gốc:** OS daemon/supervisor (launchd macOS, systemd Linux, Windows Service); "always-on agent"; "process supervisor"; "keep-alive + auto-restart"; cron + watchdog; openclaw
> **Coupling:** 🟡 — thêm lifecycle supervisor layer ngoài agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (cron + lifecycle-hooks sẵn — chưa có daemon supervisor OS-level)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Daemon/supervisor** (launchd, systemd, supervisord): tiến trình luôn chạy (always-on), **auto-restart** khi crash, **restart policy** (on-failure, always), **keep-alive** (watchdog). **Service lifecycle**: start → running → (crash) → restart → running; hoặc stop → idle → start-on-demand. **cron + long-running**: kết hợp scheduled trigger + daemon. Nguyên tắc: agent chạy **như OS daemon** — luôn sẵn sàng, tự restart khi crash, không cần user thủ công launch. Khác **389 hibernation** (sleep/wake tiết kiệm) — NT là **always-on** (chưa kể cost); khác **390 low-cost-triggers** (wake on condition) — NT **luôn chạy**.

## Mô tả

mya agent daemon lifecycle: agent chạy như daemon OS — start lúc boot (hoặc launch-once), luôn running, **auto-restart** khi crash (backoff), **health-check** (watchdog heartbeat), **graceful shutdown** (SIGTERM → cleanup). Supervisor đảm bảo agent luôn sẵn sàng (always-on). mya có `packages/cron` (scheduled) + `292 agent-lifecycle-hooks` (hooks) — NT thêm **OS-level supervisor** (systemd unit / launchd plist / Windows service wrapper) + **restart policy** + **watchdog**.

## Kiến trúc

```
   OS BOOT / user launch
        │
        ▼
   ┌── SUPERVISOR (daemon manager) ──────────────────┐
   │  · start agent process                           │
   │  · watchdog: heartbeat mỗi Ns                    │
   │  · health-check: agent respond?                  │
   │                                                  │
   │   ┌── agent running ──────────────────────┐     │
   │   │  heartbeat → supervisor (alive)        │     │
   │   │  ... doing work ...                    │     │
   │   │  CRASH (exit != 0)                     │     │
   │   └────────────────┬──────────────────────┘     │
   │                    │                             │
   │   restart policy:  │                             │
   │    · on-failure → restart (backoff)             │
   │    · always → restart                            │
   │    · backoff: 1s, 2s, 4s, 8s (max 60s)          │
   │                    ▼                             │
   │   RESTART agent ────► running again              │
   │                                                  │
   │   SIGTERM → graceful shutdown (cleanup)          │
   └──────────────────────────────────────────────────┘
        │ always-on (luôn sẵn sàng)
        ▼
   agent phục vụ request ngay (không cold-start)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/cron — scheduled trigger (nền — NT là always-on daemon)
// ✅ 292 agent-lifecycle-hooks — hooks (start/stop/cleanup) (nền)
// ✅ 291 cancel-propagation — graceful cancel (nền — NT graceful shutdown)
// ✅ 381 broker — broker cũng là 1 daemon (nền)

// ❌ THIẾU: OS-level supervisor (systemd unit / launchd plist / Windows service)
// ❌ THIẾU: restart policy (on-failure / always + backoff)
// ❌ THIẾU: watchdog heartbeat + health-check
// ❌ THIẾU: crash detection (exit code + signal)
```

## Implementation

```typescript
// packages/agent/src/daemon-supervisor.ts (MỚI)
type RestartPolicy = 'always' | 'on-failure' | 'no';

interface DaemonConfig {
  command: string[];
  restart: RestartPolicy;
  heartbeatIntervalMs: number; // 5000
  maxBackoffMs: number;        // 60000
  gracefulShutdownMs: number;  // 10000
}

class DaemonSupervisor {
  private restartCount = 0;
  private running = false;

  constructor(private cfg: DaemonConfig) {}

  async supervise(): Promise<void> {
    this.running = true;
    while (this.running) {
      const exitCode = await this.runOnce();
      if (!this.shouldRestart(exitCode)) break;
      await this.backoff(); // exponential backoff
    }
  }

  private async runOnce(): Promise<number> {
    const child = spawn(this.cfg.command[0], this.cfg.command.slice(1));
    const watchdog = setInterval(() => {/* check heartbeat */}, this.cfg.heartbeatIntervalMs);

    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), this.cfg.gracefulShutdownMs);
    });

    const code = await new Promise<number>(res => child.on('exit', res));
    clearInterval(watchdog);
    return code;
  }

  private shouldRestart(exitCode: number): boolean {
    if (this.cfg.restart === 'no') return false;
    if (this.cfg.restart === 'always') return true;
    return exitCode !== 0; // on-failure
  }

  private async backoff(): Promise<void> {
    const delay = Math.min(1000 * 2 ** this.restartCount, this.cfg.maxBackoffMs);
    this.restartCount++;
    await new Promise(r => setTimeout(r, delay));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent luôn sẵn sàng (không cold-start) | ❌ Always-on tốn resource (CPU/mem/idle) |
| ✅ Auto-restart khi crash (resilience) | ❌ Crash loop (restart liên tục nếu bug) |
| ✅ Graceful shutdown (cleanup sạch) | ❌ Supervisor phức tạp (backoff tuning) |
| ✅ Watchdog phát hiện hang | ❌ OS-specific (systemd/launchd khác nhau) |

## Khác các hướng gần

| | cron pkg | 292 Lifecycle Hooks | 389 Hibernation | NT: Daemon Lifecycle |
|---|---|---|---|---|
| Cái gì | Scheduled trigger | Hooks event | Sleep/wake tiết kiệm | **Always-on supervisor** |
| Always-on | ❌ (scheduled) | ❌ | ❌ (sleep) | ✅ |
| Auto-restart | ❌ | ❌ | ❌ | ✅ backoff |
| Watchdog | ❌ | ❌ | ❌ | ✅ heartbeat |

## Khi nào chọn

- Agent cần luôn sẵn sàng (phục vụ request ngay, không cold-start)
- Cần resilience (auto-restart khi crash)
- Running trên server (systemd/launchd managed)
- Kết hợp packages/cron (scheduled) + 292 hooks (lifecycle); thêm OS-level supervisor + restart policy + watchdog; nếu cost là vấn đề → xét 389 hibernation (sleep/wake) thay always-on
