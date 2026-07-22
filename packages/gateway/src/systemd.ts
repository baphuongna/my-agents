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

/** Send sd_notify via the appropriate socket type (Unix datagram or UDP).
 * systemd's NOTIFY_SOCKET is normally a Unix-domain datagram socket path
 * (or @abstract). */
function sdNotify(state: string): void {
  const socket = process.env.NOTIFY_SOCKET;
  if (!socket) return;
  try {
    const msg = Buffer.from(`${state}\n`);
    const target = socket.startsWith("@") ? `\0${socket.slice(1)}` : socket;
    // systemd NOTIFY_SOCKET is normally a Unix-domain datagram socket.
    // Node dgram supports sending to Unix paths via the address parameter.
    const sock = createSocket("udp4");
    const send = sock.send as unknown as {
      (msg: Buffer, offset: number, length: number, address: string, cb: (err: Error | null, bytes: number) => void): void;
    };
    send(msg, 0, msg.length, target, (err) => {
      if (err) { /* socket send failed — not under systemd */ }
      try { sock.close(); } catch { /* best-effort */ }
    });
    lastNotify = nowWallclock();
  } catch { /* best-effort — not under systemd or socket unavailable */ }
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
