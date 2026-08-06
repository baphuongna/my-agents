# Hướng SY: Hermes Persisted Restart-Loop Breaker — cửa sổ rolling boot persist, quá nhiều boot ngắn hạn bỏ auto-resume

> **Nguồn gốc:** hermes-agent `cron/lifecycle_guard.py` (`GatewayLifecycleBlocked`, gateway restart-loop defenses #30719, `launchctl submit`/`bootstrap` laundering), `test_gateway_restart_loop.py`; "SIGTERM-respawn loop every ~10s"; "auto-resume picks up offending session"; "defence-in-depth"; "command-shaped pattern match" | **Coupling:** 🟢 — thêm boot-count window + auto-resume breaker vào daemon lifecycle | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có boot-persist window + auto-resume breaker) | **Effort:** 2-3 tuần

## Nguồn gốc

**hermes-agent** gặp **restart loop**: agent (trong gateway) lên cron job gọi `hermes gateway restart` → cron fire → gateway **SIGTERM** → supervisor (launchd KeepAlive / systemd Restart=) **revive** → **auto-resume** chạy lại session gây lỗi → re-run cùng logic → **SIGTERM-respawn loop mỗi ~10s** tới khi bẻ tay. Defence: (1) gateway stop/restart refuse khi `_HERMES_GATEWAY=1`. (2) cron **reject** job chứa gateway-lifecycle command (command-shaped match, không prose). (3) **persisted restart-loop breaker**: cửa sổ **rolling boot persist** — đếm boot ngắn hạn (boot rồi crash nhanh), nếu **quá nhiều boot trong window** → **bỏ auto-resume** (không resume session gây loop, yêu cầu can thiệp tay). Nguyên tắc: **đếm boot ngắn hạn, quá ngưỡng → dừng auto-resume** — bẻ loop tự phục hồi sai.

## Mô tả

mya persisted restart-loop breaker: (1) **Boot persist**: mỗi boot ghi timestamp vào file persist (rolling window, vd 10 phút). (2) **Short-boot count**: đếm boot mà uptime < ngưỡng (vd < 60s = boot ngắn = dấu hiệu loop). (3) **Breaker**: nếu short-boot count > ngưỡng trong window → **trip breaker** → bỏ auto-resume (không resume session gây loop). (4) **Manual reset**: breaker trip → yêu cầu reset tay (không tự phục hồi — tránh loop tiếp). mya daemon (natives) lifecycle — SY thêm **boot-persist file** + **short-boot detector** + **auto-resume breaker**.

## Kiến trúc

```
  DAEMON boot → crash nhanh → supervisor revive → auto-resume → loop
        │ (mỗi boot ghi timestamp persist)
        ▼
  ┌─── BOOT PERSIST (rolling window) ────────────────────┐
  │  boot.log: [t=0s upt=5s], [t=12s upt=8s], [t=24s upt=6s] │
  │  window 10 phút                                        │
  └───────────────────────┬─────────────────────────────┘
                          │ (count short-boot: uptime < 60s)
                          ▼
  ┌─── SHORT-BOOT DETECTOR ──────────────────────────────┐
  │  short-boots trong window: 5  (> ngưỡng 3)             │
  │  → dấu hiệu restart loop                                │
  └───────────────────────┬─────────────────────────────┘
                          │ (count > threshold)
                          ▼
  ┌─── BREAKER TRIP → BỎ AUTO-RESUME ────────────────────┐
  │  ⛔ không resume session gây loop                       │
  │  yêu cầu MANUAL RESET (không tự phục hồi)              │
  │  (bẻ loop, tránh SIGTERM-respawn mỗi 10s)              │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ natives (Rust) daemon — lifecycle (nền — SY breaker ở đây)
// ✅ session persist/restore — auto-resume (nền — SY gate auto-resume)
// ✅ core.time — deterministic time (nền — SY boot timestamp)

// ❌ THIẾU: boot-persist file (rolling window boot log)
// ❌ THIẾU: short-boot detector (uptime < threshold = short)
// ❌ THIẾU: auto-resume breaker (count > threshold → skip resume)
// ❌ THIẾU: manual-reset gate (breaker trip → require human reset)
```

## Implementation

```typescript
// packages/agent/src/restart-loop-breaker.ts (MỚI)
interface BootRecord { bootAt: number; uptimeMs: number }

class RestartLoopBreaker {
  private boots: BootRecord[] = [];
  constructor(
    private now: () => number,           // core.time
    private windowMs: number,            // rolling window (vd 10 min)
    private shortUptimeMs: number,       // uptime < this = short boot (vd 60s)
    private threshold: number,           // short-boot count to trip (vd 3)
    private tripped = false,
  ) {}

  // called each boot
  recordBoot(uptimeMs: number): void {
    const t = this.now();
    this.boots.push({ bootAt: t, uptimeMs });
    // prune outside rolling window
    this.boots = this.boots.filter(b => t - b.bootAt <= this.windowMs);
    // count short boots
    const shortCount = this.boots.filter(b => b.uptimeMs < this.shortUptimeMs).length;
    if (shortCount > this.threshold) this.tripped = true;
  }

  // gate: should we auto-resume?
  shouldAutoResume(): boolean {
    return !this.tripped; // tripped → skip (bẻ loop)
  }

  // manual reset (human intervention)
  reset(): void {
    this.tripped = false;
    this.boots = [];
  }
}

// Usage (daemon lifecycle):
// breaker.recordBoot(lastUptimeMs);
// if (breaker.shouldAutoResume()) resume(session); // OK
// else → log "restart loop detected, manual reset required" (bẻ loop)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bẻ restart loop (không SIGTERM-respawn vô hạn) | ❌ False trip (boot ngắn hợp lệ → bỏ resume nhầm) |
| ✅ Rolling window (phát loop gần, không lịch sử xa) | ❌ Manual reset dependency (cần người bẻ) |
| ✅ Auto-resume an toàn (loop → skip) | ❌ Window/threshold tuning (chủ quan) |
| ✅ Defence-in-depth (kèm cron-block + refuse-restart) | ❌ Boot-log persist (file I/O mỗi boot) |

## Khác các hướng gần

| | Auto-resume thuần | Cron-block (lifecycle_guard) | SY: Restart-Loop-Breaker |
|---|---|---|---|
| Cái gì | Luôn resume | Block cron gây restart | **Đếm boot → trip → bỏ resume** |
| Loop | ❌ (tiếp tục) | Ngừa (create-time) | **Bẻ (runtime, count-based)** |
| Reset | ❌ | ❌ | **✅ manual reset** |

## Khi nào chọn

- Daemon có auto-resume + supervisor revive (launchd/systemd) → nguy cơ restart loop
- Agent có thể gây crash lặp (cron restart, bad session)
- Muốn bẻ loop tự động (quá nhiều boot ngắn → dừng)
- Nối natives daemon lifecycle + session persist/auto-resume + core.time (deterministic boot timestamp); guard false-trip (boot ngắn hợp lệ → threshold hợp lý), window freshness (rolling, không tích lũy xa), và manual-reset UX (clear signal khi breaker trip); SY = restart-loop breaker, kết hợp cron lifecycle-guard (ngừa create) — 2 lớp defence-in-depth
