/**
 * runDetached — the detached-spawn helper used by the standalone view backend.
 *
 * F8 regression guard: a missing terminal binary (ENOENT) emits an async
 * 'error' event. Without an error handler this crashes the parent mya process
 * (Unhandled 'error' event). The handler swallows it → runDetached returns a
 * pid + the process survives. This test verifies both (no sync throw + the
 * async error is handled, not unhandled).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ── mock node:child_process ──────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

// ── imports (after mock is registered) ───────────────────────────────────

import { runDetached, commandExists } from "./run.js";

// ── mock child factory ───────────────────────────────────────────────────

function makeChild(opts: { pid?: number } = {}): any {
  const child: any = new EventEmitter();
  child.pid = opts.pid ?? 12345;
  child.unref = vi.fn();
  return child;
}

describe("[unit] runDetached (F8 — ENOENT must not crash the parent)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("returns a number + swallows the async ENOENT error (no unhandled 'error' event)", async () => {
    mockSpawn.mockReturnValue(makeChild());

    const pid = runDetached("nonexistent-binary-xyz-12345", []);
    expect(typeof pid).toBe("number");
    // Emit error event to verify the handler swallows it.
    const child = mockSpawn.mock.results[0]!.value;
    child.emit("error", new Error("ENOENT"));
    await new Promise((r) => setTimeout(r, 50));
  });

  it("forwards cwd to spawn when opts.cwd is provided", () => {
    mockSpawn.mockReturnValue(makeChild());

    runDetached("xterm", ["-e", "mya"], { cwd: "/tmp/project" });

    expect(mockSpawn).toHaveBeenCalledWith(
      "xterm",
      ["-e", "mya"],
      expect.objectContaining({
        cwd: "/tmp/project",
        detached: true,
        stdio: "ignore",
      }),
    );
  });

  it("omits cwd from spawn when opts.cwd is not provided", () => {
    mockSpawn.mockReturnValue(makeChild());

    runDetached("xterm", ["-e", "mya"]);

    const spawnOpts = mockSpawn.mock.calls[0]![2];
    expect(spawnOpts).not.toHaveProperty("cwd");
  });
});

describe("[unit] commandExists", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("returns true when 'which' exits 0", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(commandExists("cmux")).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "which",
      ["cmux"],
      expect.objectContaining({ stdio: "ignore" }),
    );
  });

  it("returns false when 'which' exits non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(commandExists("cmux")).toBe(false);
  });

  it("returns false on spawn error (exception)", () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });
    expect(commandExists("cmux")).toBe(false);
  });
});
