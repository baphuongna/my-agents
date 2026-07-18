/**
 * session tests — socket dir per-task + --no-sandbox inject logic.
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import {
  shouldInjectNoSandbox,
  buildNoSandboxArgs,
  createBrowserSession,
  closeBrowserSession,
  type OsInfo,
} from "./session.js";

// ─── --no-sandbox inject logic (Gotcha #4) ───────────────────────────────────

describe("session — shouldInjectNoSandbox", () => {
  it("returns true when running as root (uid 0)", () => {
    expect(shouldInjectNoSandbox(0, {})).toBe(true);
  });

  it("returns false for non-root on a vanilla system", () => {
    expect(shouldInjectNoSandbox(1000, {})).toBe(false);
  });

  it("returns true on Ubuntu 23.10", () => {
    const os: OsInfo = { id: "ubuntu", versionId: "23.10" };
    expect(shouldInjectNoSandbox(1000, os)).toBe(true);
  });

  it("returns true on Ubuntu 24.04", () => {
    const os: OsInfo = { id: "ubuntu", versionId: "24.04" };
    expect(shouldInjectNoSandbox(1000, os)).toBe(true);
  });

  it("returns false on Ubuntu 22.04 (before the userns restriction)", () => {
    const os: OsInfo = { id: "ubuntu", versionId: "22.04" };
    expect(shouldInjectNoSandbox(1000, os)).toBe(false);
  });

  it("returns false on Ubuntu 23.04 (before 23.10)", () => {
    const os: OsInfo = { id: "ubuntu", versionId: "23.04" };
    expect(shouldInjectNoSandbox(1000, os)).toBe(false);
  });

  it("returns true when AppArmor is present", () => {
    const os: OsInfo = { apparmor: true };
    expect(shouldInjectNoSandbox(1000, os)).toBe(true);
  });

  it("returns false for non-Ubuntu distro without AppArmor", () => {
    const os: OsInfo = { id: "debian", versionId: "12" };
    expect(shouldInjectNoSandbox(1000, os)).toBe(false);
  });

  it("returns true for root even on non-Ubuntu without AppArmor", () => {
    expect(shouldInjectNoSandbox(0, { id: "debian" })).toBe(true);
  });

  it("returns true for undefined uid + AppArmor", () => {
    // Windows-like scenario: no getuid, but AppArmor present.
    expect(shouldInjectNoSandbox(undefined, { apparmor: true })).toBe(true);
  });
});

describe("session — buildNoSandboxArgs", () => {
  it("returns the correct --no-sandbox arg string", () => {
    expect(buildNoSandboxArgs()).toBe("--no-sandbox,--disable-dev-shm-usage");
  });
});

// ─── Per-task socket dir (Gotcha #2) ─────────────────────────────────────────

describe("session — createBrowserSession per-task socket dir", () => {
  it("produces different socket dirs for different taskIds", () => {
    const a = createBrowserSession({ taskId: "task-a" });
    const b = createBrowserSession({ taskId: "task-b" });
    expect(a.socketDir).not.toBe(b.socketDir);
    expect(a.sessionName).toBe("mya-task-a");
    expect(b.sessionName).toBe("mya-task-b");
    // Clean up.
    closeBrowserSession(a);
    closeBrowserSession(b);
  });

  it("creates the socket dir on disk", () => {
    const session = createBrowserSession({ taskId: "mkdir-test" });
    expect(existsSync(session.socketDir)).toBe(true);
    expect(statSync(session.socketDir).isDirectory()).toBe(true);
    closeBrowserSession(session);
  });

  it("includes AGENT_BROWSER_SOCKET_DIR in env", () => {
    const session = createBrowserSession({ taskId: "env-test" });
    expect(session.env.AGENT_BROWSER_SOCKET_DIR).toBe(session.socketDir);
    closeBrowserSession(session);
  });

  it("includes AGENT_BROWSER_IDLE_TIMEOUT_MS in env (Gotcha #3)", () => {
    const session = createBrowserSession({ taskId: "idle-test" });
    expect(session.env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBeDefined();
    expect(Number(session.env.AGENT_BROWSER_IDLE_TIMEOUT_MS)).toBe(300_000);
    closeBrowserSession(session);
  });

  it("respects custom idleTimeoutMs override", () => {
    const session = createBrowserSession({ taskId: "custom-idle", idleTimeoutMs: 10_000 });
    expect(session.env.AGENT_BROWSER_IDLE_TIMEOUT_MS).toBe("10000");
    closeBrowserSession(session);
  });

  it("respects custom socketDir override", () => {
    const session = createBrowserSession({ taskId: "custom-sock", socketDir: "/tmp/mya-custom-socket-test" });
    expect(session.socketDir).toBe("/tmp/mya-custom-socket-test");
    expect(existsSync("/tmp/mya-custom-socket-test")).toBe(true);
    closeBrowserSession(session);
    expect(existsSync("/tmp/mya-custom-socket-test")).toBe(false);
  });

  it("defaults taskId to 'default' when empty", () => {
    const session = createBrowserSession({ taskId: "" });
    expect(session.taskId).toBe("default");
    expect(session.sessionName).toBe("mya-default");
    closeBrowserSession(session);
  });
});

describe("session — closeBrowserSession cleanup", () => {
  it("removes the socket dir", () => {
    const session = createBrowserSession({ taskId: "cleanup-test" });
    expect(existsSync(session.socketDir)).toBe(true);
    closeBrowserSession(session);
    expect(existsSync(session.socketDir)).toBe(false);
  });

  it("does not throw for a non-existent dir", () => {
    const fakeSession = {
      sessionName: "fake",
      socketDir: "/tmp/mya-nonexistent-socket-xyz",
      env: {},
      taskId: "fake",
    };
    expect(() => closeBrowserSession(fakeSession)).not.toThrow();
  });
});
