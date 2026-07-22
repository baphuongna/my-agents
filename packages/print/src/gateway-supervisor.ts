/**
 * @my-agent/print — Gateway supervisor (auto-restart watchdog).
 *
 * A5: monitors the gateway process. On crash, respawns within a budget
 * (3 attempts / 60s). Resumes mid-session by reloading from session files.
 *
 * Source: §14b Crash Resilience, PLAN-FEATURES A5.
 * Review note: launcher.ts is a TUI client, NOT a supervisor. This is the
 * correct location for process supervision.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_WINDOW_MS = 60_000;
const HEARTBEAT_FILE = join(homedir(), ".mya", "agent", "gateway.heartbeat");
const PID_FILE = join(homedir(), ".mya", "agent", "gateway.pid");

export interface SupervisorOptions {
  port?: number;
  autoRestart?: boolean;
  onRestart?: (attempt: number, reason: string) => void;
  onGiveUp?: (reason: string) => void;
}

export class GatewaySupervisor {
  private child?: ChildProcess;
  private restartAttempts: number[] = []; // timestamps
  private readonly opts: SupervisorOptions;

  constructor(opts: SupervisorOptions = {}) {
    this.opts = opts;
  }

  /** Start the gateway as a child process. Returns when the child exits. */
  async start(): Promise<void> {
    const port = this.opts.port ?? 3999;
    const autoRestart = this.opts.autoRestart ?? process.env.MYA_GATEWAY_AUTO_RESTART === "1";

    let lastExitCode: number | null = null;
    do {
      lastExitCode = await this.runOnce(port);
      // Clean exit (code 0) — don't restart
      if (lastExitCode === 0) break;
      if (!autoRestart) break;

      // Prune old restart attempts (outside the window)
      const now = nowWallclock();
      this.restartAttempts = this.restartAttempts.filter((ts) => now - ts < RESTART_WINDOW_MS);

      if (this.restartAttempts.length >= MAX_RESTART_ATTEMPTS) {
        const reason = `max restart attempts (${MAX_RESTART_ATTEMPTS}) reached in ${RESTART_WINDOW_MS}ms — giving up`;
        console.error(`[supervisor] ${reason}`);
        this.opts.onGiveUp?.(reason);
        break;
      }

      // R1-fix: exponential backoff between restarts (prevents tight CPU loop).
      const backoffMs = Math.min(10_000, 1_000 * Math.pow(2, this.restartAttempts.length));
      await new Promise((r) => setTimeout(r, backoffMs).unref?.());
      this.restartAttempts.push(now);
      const attempt = this.restartAttempts.length;
      const reason = `gateway exited unexpectedly — restart attempt ${attempt}/${MAX_RESTART_ATTEMPTS}`;
      console.warn(`[supervisor] ${reason}`);
      this.opts.onRestart?.(attempt, reason);
    } while (true);
  }

  /** Run the gateway once (spawn + wait for exit). */
  private async runOnce(port: number): Promise<number> {
    // Write PID file
    try {
      mkdirSync(join(homedir(), ".mya", "agent"), { recursive: true });
      writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 });
    } catch { /* best-effort */ }

    return new Promise((resolve) => {
      // Resolve script path: try cwd-relative, then module-relative
      const scriptPath = existsSync(join(process.cwd(), "dist", "mya.js"))
        ? join(process.cwd(), "dist", "mya.js")
        : join(__dirname, "..", "..", "dist", "mya.js");
      this.child = spawn(process.execPath, [scriptPath, "serve", "--port", String(port)], {
        stdio: "inherit",
        // Don't propagate auto-restart env to child (prevents nested supervisor)
        env: { ...process.env, MYA_GATEWAY_AUTO_RESTART: "", MYA_GATEWAY_SUPERVISED: "1" },
      });

      // Write PID file with the CHILD's PID (not supervisor's).
      if (this.child.pid) {
        try { writeFileSync(PID_FILE, String(this.child.pid), { mode: 0o600 }); } catch {}
      }

      this.child.on("exit", (code) => {
        try { if (existsSync(PID_FILE)) { unlinkSync(PID_FILE); } } catch {}
        resolve(code ?? 0);
      });

      this.child.on("error", (err) => {
        console.error(`[supervisor] gateway process error: ${err.message}`);
        try { if (existsSync(PID_FILE)) { unlinkSync(PID_FILE); } } catch {}
        resolve(1);
      });
    });
  }

  /** Stop the supervised gateway (graceful). */
  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  /** Wire process signal handlers so SIGINT/SIGTERM propagate to child. */
  wireSignalHandlers(): void {
    const handler = () => { this.stop(); };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  }

  /** Check if a heartbeat is fresh (gateway is alive). */
  static checkHeartbeat(maxAgeMs: number = 30_000): boolean {
    if (!existsSync(HEARTBEAT_FILE)) return false;
    try {
      const ts = Number(readFileSync(HEARTBEAT_FILE, "utf8").trim());
      return nowWallclock() - ts < maxAgeMs;
    } catch {
      return false;
    }
  }
}
