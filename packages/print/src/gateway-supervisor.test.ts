/**
 * Tests for GatewaySupervisor (gateway-supervisor.ts) — auto-restart watchdog.
 *
 * The supervisor spawns the gateway as a child process. These tests verify the
 * public API (constructor options, stop, wireSignalHandlers) and the static
 * checkHeartbeat helper WITHOUT spawning a real gateway process (start()
 * intentionally avoided — it spawns a long-running process).
 *
 * NOTE: HEARTBEAT_FILE is a module-level constant: join(homedir(), ".mya",
 * "agent", "gateway.heartbeat"). It is computed at import time, so these tests
 * write/clean the real home path (no HOME override — the module constant can't
 * see an override applied after import).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GatewaySupervisor } from "./gateway-supervisor.js";

/** The real heartbeat path (same as the module-level constant). */
const heartbeatPath = join(homedir(), ".mya", "agent", "gateway.heartbeat");
const agentDir = join(homedir(), ".mya", "agent");

describe("GatewaySupervisor", () => {
  it("constructs with default options", () => {
    const s = new GatewaySupervisor();
    expect(s).toBeInstanceOf(GatewaySupervisor);
  });

  it("constructs with custom options", () => {
    const s = new GatewaySupervisor({ port: 4321, autoRestart: true });
    expect(s).toBeInstanceOf(GatewaySupervisor);
  });

  it("stop() does not throw when child was never started", () => {
    const s = new GatewaySupervisor();
    expect(() => s.stop()).not.toThrow();
  });

  it("wireSignalHandlers() does not throw", () => {
    const s = new GatewaySupervisor();
    expect(() => s.wireSignalHandlers()).not.toThrow();
  });

  it("onGiveUp callback option is accepted without error", () => {
    const s = new GatewaySupervisor({
      autoRestart: false,
      onGiveUp: (reason) => { void reason; },
    });
    expect(s).toBeInstanceOf(GatewaySupervisor);
  });

  it("onRestart callback option is accepted without error", () => {
    const s = new GatewaySupervisor({
      onRestart: (attempt, reason) => { void attempt; void reason; },
    });
    expect(s).toBeInstanceOf(GatewaySupervisor);
  });
});

describe("GatewaySupervisor.checkHeartbeat", () => {
  beforeEach(() => {
    // Ensure a clean state before each test.
    if (existsSync(heartbeatPath)) rmSync(heartbeatPath);
  });
  afterEach(() => {
    // Clean up any heartbeat file we wrote.
    if (existsSync(heartbeatPath)) rmSync(heartbeatPath);
  });

  it("returns false when no heartbeat file exists", () => {
    expect(GatewaySupervisor.checkHeartbeat()).toBe(false);
  });

  it("returns true when a fresh heartbeat file exists", () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(heartbeatPath, String(Date.now()));
    expect(GatewaySupervisor.checkHeartbeat()).toBe(true);
  });

  it("returns false when the heartbeat is older than maxAgeMs", () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(heartbeatPath, String(Date.now() - 300_000));
    expect(GatewaySupervisor.checkHeartbeat(30_000)).toBe(false);
  });

  it("respects a custom maxAgeMs", () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(heartbeatPath, String(Date.now() - 2_000));
    expect(GatewaySupervisor.checkHeartbeat(5_000)).toBe(true);
    expect(GatewaySupervisor.checkHeartbeat(1_000)).toBe(false);
  });

  it("returns false when the heartbeat file is invalid (non-numeric)", () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(heartbeatPath, "not-a-number");
    expect(GatewaySupervisor.checkHeartbeat()).toBe(false);
  });
});
