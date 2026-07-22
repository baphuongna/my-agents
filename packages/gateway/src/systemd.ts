/**
 * @my-agent/gateway — Systemd lifecycle notifications.
 * I1: sd_notify(READY/WATCHDOG) + cgroup cleanup.
 * Source: §14b Crash Resilience, PLAN-FEATURES I1.
 */
import { nowWallclock } from "@my-agent/core";
import { createSocket } from "node:dgram";
import { existsSync, readFileSync } from "node:fs";

let watchdogTimer: NodeJS.Timeout | undefined;
let lastNotify = 0;

/** Check if systemd is available (NOTIFY_SOCKET env set). */
export function isSystemdAvailable(): boolean {
  return !!process.env.NOTIFY_SOCKET;
}

/** Send sd_notify (via datagram socket to NOTIFY_SOCKET). */
function sdNotify(state: string): void {
  const socket = process.env.NOTIFY_SOCKET;
  if (!socket) return;
  try {
    const sock = createSocket("udp4");
    const target = socket.startsWith("@") ? `\0${socket.slice(1)}` : socket;
    const msg = Buffer.from(`${state}\n`);
    // dgram send for Unix domain sockets: msg, offset, length, address-path, callback
    (sock.send as unknown as (msg: Buffer, offset: number, length: number, address: string, cb: () => void) => void)(msg, 0, msg.length, target, () => sock.close());
    lastNotify = nowWallclock();
  } catch { /* best-effort */ }
}

/** Notify systemd that the gateway is ready. */
export function notifyReady(): void {
  sdNotify("READY=1");
}

/** Start the watchdog timer (sends WATCHDOG=1 periodically). */
export function startWatchdog(intervalMs?: number): void {
  if (!isSystemdAvailable()) return;
  // systemd sets WATCHDOG_USEC; use half of that as interval
  const watchdogUsec = Number(process.env.WATCHDOG_USEC ?? 0);
  const interval = intervalMs ?? (watchdogUsec > 0 ? watchdogUsec / 2000 : 30_000);
  watchdogTimer = setInterval(() => sdNotify("WATCHDOG=1"), interval);
  watchdogTimer.unref?.();
}

/** Stop the watchdog timer. */
export function stopWatchdog(): void {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = undefined; }
}

/** Notify systemd that the gateway is stopping. */
export function notifyStopping(): void {
  sdNotify("STOPPING=1");
  stopWatchdog();
}

/** Scale-to-zero: check if the gateway has been idle for the threshold. */
export function checkScaleToZero(
  lastActivity: number,
  idleThresholdMs: number = 30 * 60_000,
): boolean {
  return nowWallclock() - lastActivity > idleThresholdMs;
}

/** Get cgroup information for cleanup tracking. */
export function getCgroupInfo(): { path?: string; memoryUsage?: number } {
  try {
    const cgroupPath = "/proc/self/cgroup";
    if (existsSync(cgroupPath)) {
      const content = readFileSync(cgroupPath, "utf8");
      const match = content.match(/:(\/[^:]+)/);
      return { path: match?.[1] };
    }
  } catch { /* not Linux */ }
  return {};
}
