import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reapOrphanedBrowserSessions } from "../session.js";

describe("reapOrphanedBrowserSessions — orphan cleanup (G6)", () => {
  const dirs: string[] = [];

  // A PID that is very likely dead (a high, unused PID). We pick a large number
  // and verify via process.kill(pid, 0) that it's not alive before relying on it.
  const deadPid = 4_000_001;

  function makeDir(name: string): string {
    const p = join(tmpdir(), name);
    mkdirSync(p, { recursive: true });
    dirs.push(p);
    return p;
  }

  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
    dirs.length = 0;
  });

  it("removes a socket dir whose owner PID is dead", () => {
    // Confirm the chosen PID is actually not alive (skip test premise otherwise).
    try {
      process.kill(deadPid, 0);
      return; // PID happens to be alive — premise invalid, skip silently.
    } catch {
      /* dead — good */
    }
    const orphan = makeDir(`mya-browser-task-${deadPid}`);
    expect(existsSync(orphan)).toBe(true);

    reapOrphanedBrowserSessions();

    expect(existsSync(orphan)).toBe(false);
  });

  it("never removes our own process's active session dir", () => {
    const own = makeDir(`mya-browser-task-${process.pid}`);
    reapOrphanedBrowserSessions();
    expect(existsSync(own)).toBe(true);
  });

  it("ignores non-matching directories", () => {
    const other = makeDir("something-else-12345");
    reapOrphanedBrowserSessions();
    expect(existsSync(other)).toBe(true);
  });

  it("never removes a dir whose PID is alive-but-unsignallable (EPERM = alive)", () => {
    // PID 1 (init/systemd) is always alive. process.kill(1, 0) either succeeds
    // (root) or throws EPERM (non-root) — BOTH must be treated as alive so the
    // dir is KEPT (regression for the EPERM catch-all bug that reaped live dirs).
    const protectedDir = makeDir("mya-browser-task-1");
    reapOrphanedBrowserSessions();
    expect(existsSync(protectedDir)).toBe(true);
  });
});
