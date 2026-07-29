/**
 * Tests for the view SPI layer (view-backend.ts + tmux/herdr/standalone backends).
 *
 * Strategy:
 *  - detect() tests: set/unset env vars, verify boolean result.
 *  - open() tests: mock `node:child_process`::spawn, verify the argv passed.
 *  - resolveViewBackend(): verify first-match + fallback semantics.
 *  - Registry extensibility: insert a custom backend, verify resolver picks it up.
 *
 * Env var pattern: save/restore around each test (see terminal-image.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// ── mock node:child_process ──────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	spawn: mockSpawn,
}));

// ── imports (after mock is registered) ───────────────────────────────────

import {
	VIEW_BACKENDS,
	resolveViewBackend,
	openView,
} from "./view-backend.js";
import { tmuxBackend } from "./tmux.js";
import { herdrBackend } from "./herdr.js";
import { standaloneBackend, buildStandaloneCommand } from "./standalone.js";
import type { ViewBackend, ViewOpenOpts } from "./view-backend.js";

// ── env helpers ──────────────────────────────────────────────────────────

/** Env vars read by any backend's detect(). */
const ENV_KEYS = ["TMUX", "HERDR_ENV", "HERDR_SOCKET_PATH"] as const;

let savedEnv: Record<string, string | undefined> = {};

/** Snapshot and clear all view-related env vars. */
function clearViewEnv(): void {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
}

/** Restore env vars to their pre-test state. */
function restoreViewEnv(): void {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
}

// ── mock child factory ───────────────────────────────────────────────────

/**
 * Create a mock ChildProcess suitable for both capture-mode and detached-mode
 * spawn calls. `stdout` data and the `close` event are emitted via
 * `setImmediate` so listeners registered synchronously in the promise
 * executor receive them on the next tick.
 */
function makeChild(opts: {
	stdout?: string;
	exitCode?: number;
	pid?: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
	const child: any = new EventEmitter();
	child.pid = opts.pid ?? 12345;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.stdout.setEncoding = () => {};
	child.stderr.setEncoding = () => {};
	child.unref = vi.fn();

	setImmediate(() => {
		if (opts.stdout !== undefined) child.stdout.emit("data", opts.stdout);
		child.emit("close", opts.exitCode ?? 0);
	});

	return child;
}

// ══════════════════════════════════════════════════════════════════════════
// tmux backend
// ══════════════════════════════════════════════════════════════════════════

describe("tmuxBackend", () => {
	beforeEach(() => {
		clearViewEnv();
		mockSpawn.mockReset();
	});
	afterEach(() => restoreViewEnv());

	describe("detect()", () => {
		it("returns true when TMUX is set", () => {
			process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
			expect(tmuxBackend.detect()).toBe(true);
		});

		it("returns false when TMUX is unset", () => {
			expect(tmuxBackend.detect()).toBe(false);
		});
	});

	describe("open()", () => {
		it("spawns tmux new-window with title and command", async () => {
			mockSpawn.mockReturnValue(makeChild({ stdout: "3\n" }));

			const handle = await tmuxBackend.open({
				command: ["mya", "--gateway-session", "abc", "--role", "coder"],
				title: "coder",
				cwd: "/tmp/project",
			});

			expect(handle).toEqual({ backendId: "tmux", ref: "3" });
			expect(mockSpawn).toHaveBeenCalledTimes(1);
			expect(mockSpawn).toHaveBeenCalledWith(
				"tmux",
				[
					"new-window",
					"-P",
					"-n",
					"coder",
					"mya",
					"--gateway-session",
					"abc",
					"--role",
					"coder",
				],
				expect.objectContaining({
					cwd: "/tmp/project",
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		});

		it("omits -n when no title is provided", async () => {
			mockSpawn.mockReturnValue(makeChild({ stdout: "1\n" }));

			await tmuxBackend.open({ command: ["mya"] });

			const callArgs = mockSpawn.mock.calls[0]!;
			expect(callArgs[1]).not.toContain("-n");
		});

		it("throws on non-zero exit code", async () => {
			mockSpawn.mockReturnValue(makeChild({ exitCode: 1 }));

			await expect(tmuxBackend.open({ command: ["mya"] })).rejects.toThrow(
				"tmux new-window failed",
			);
		});
	});

	describe("focus()", () => {
		it("runs tmux select-window with the handle ref", async () => {
			mockSpawn.mockReturnValue(makeChild({}));

			await tmuxBackend.focus?.({ backendId: "tmux", ref: "2" });

			expect(mockSpawn).toHaveBeenCalledWith(
				"tmux",
				["select-window", "-t", "2"],
				expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
			);
		});
	});
});

// ══════════════════════════════════════════════════════════════════════════
// herdr backend
// ══════════════════════════════════════════════════════════════════════════

describe("herdrBackend", () => {
	beforeEach(() => {
		clearViewEnv();
		mockSpawn.mockReset();
	});
	afterEach(() => restoreViewEnv());

	describe("detect()", () => {
		it("returns true when HERDR_ENV is set", () => {
			process.env.HERDR_ENV = "1";
			expect(herdrBackend.detect()).toBe(true);
		});

		it("returns true when HERDR_SOCKET_PATH is set", () => {
			process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock";
			expect(herdrBackend.detect()).toBe(true);
		});

		it("returns false when neither env var is set", () => {
			expect(herdrBackend.detect()).toBe(false);
		});
	});

	describe("open()", () => {
		it("uses a three-step CLI sequence (split → current → run)", async () => {
			const paneJson = JSON.stringify({
				id: "cli:pane:current",
				result: { pane: { pane_id: "w1:p2" } },
			});

			mockSpawn.mockImplementation((cmd: string, args: string[]) => {
				if (cmd === "herdr" && args[1] === "current") {
					return makeChild({ stdout: paneJson });
				}
				return makeChild({});
			});

			const handle = await herdrBackend.open({
				command: ["mya", "--role", "coder"],
				title: "coder",
				cwd: "/tmp/project",
			});

			expect(handle).toEqual({ backendId: "herdr", ref: "w1:p2" });
			expect(mockSpawn).toHaveBeenCalledTimes(3);

			// Step 1: pane split
			const call1 = mockSpawn.mock.calls[0]!;
			expect(call1[0]).toBe("herdr");
			expect(call1[1]).toContain("pane");
			expect(call1[1]).toContain("split");
			expect(call1[1]).toContain("--cwd");
			expect(call1[1]).toContain("/tmp/project");

			// Step 2: pane current
			const call2 = mockSpawn.mock.calls[1]!;
			expect(call2[0]).toBe("herdr");
			expect(call2[1]).toEqual(
				expect.arrayContaining(["pane", "current"]),
			);

			// Step 3: pane run
			const call3 = mockSpawn.mock.calls[2]!;
			expect(call3[0]).toBe("herdr");
			expect(call3[1]).toEqual(
				expect.arrayContaining([
					"pane",
					"run",
					"w1:p2",
					"mya",
					"--role",
					"coder",
				]),
			);
		});

		it("throws if pane current returns non-JSON", async () => {
			mockSpawn.mockImplementation(() => makeChild({ stdout: "not json" }));

			await expect(
				herdrBackend.open({ command: ["mya"] }),
			).rejects.toThrow("unexpected");
		});

		it("throws if pane_id is missing from JSON", async () => {
			mockSpawn.mockImplementation((cmd: string, args: string[]) => {
				if (args[1] === "current") {
					return makeChild({
						stdout: JSON.stringify({ result: { pane: {} } }),
					});
				}
				return makeChild({});
			});

			await expect(
				herdrBackend.open({ command: ["mya"] }),
			).rejects.toThrow("could not resolve new pane id");
		});

		it("throws if pane split fails", async () => {
			mockSpawn.mockImplementation((cmd: string, args: string[]) => {
				if (args[1] === "split") return makeChild({ exitCode: 1 });
				return makeChild({});
			});

			await expect(
				herdrBackend.open({ command: ["mya"] }),
			).rejects.toThrow("pane split failed");
		});
	});

	describe("focus()", () => {
		it("runs herdr agent focus with the handle ref", async () => {
			mockSpawn.mockReturnValue(makeChild({}));

			await herdrBackend.focus?.({ backendId: "herdr", ref: "w1:p2" });

			expect(mockSpawn).toHaveBeenCalledWith(
				"herdr",
				["agent", "focus", "w1:p2"],
				expect.objectContaining({
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		});

		it("resolves without throwing on non-zero exit (best-effort)", async () => {
			mockSpawn.mockReturnValue(makeChild({ exitCode: 1 }));

			await expect(
				herdrBackend.focus?.({ backendId: "herdr", ref: "w1:p2" }),
			).resolves.toBeUndefined();
		});
	});
});

// ══════════════════════════════════════════════════════════════════════════
// standalone backend
// ══════════════════════════════════════════════════════════════════════════

describe("standaloneBackend", () => {
	beforeEach(() => mockSpawn.mockReset());

	describe("detect()", () => {
		it("always returns true", () => {
			expect(standaloneBackend.detect()).toBe(true);
		});
	});

	describe("open()", () => {
		it("spawns a terminal and returns a standalone handle with pid", async () => {
			mockSpawn.mockReturnValue(makeChild({ pid: 99999 }));

			const handle = await standaloneBackend.open({
				command: ["mya"],
				title: "test",
			});

			expect(handle.backendId).toBe("standalone");
			expect(handle.ref).toBe("99999");
			expect(mockSpawn).toHaveBeenCalledTimes(1);
			expect(mockSpawn).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Array),
				expect.objectContaining({
					detached: true,
					stdio: "ignore",
				}),
			);
		});
	});
});

describe("buildStandaloneCommand", () => {
	const opts: ViewOpenOpts = { command: ["mya", "--role", "coder"] };

	it("darwin uses osascript to open Terminal.app", () => {
		const result = buildStandaloneCommand("darwin", opts);
		expect(result.cmd).toBe("osascript");
		expect(result.args[0]).toBe("-e");
		expect(result.args[1]).toContain("Terminal");
		expect(result.args[1]).toContain("mya --role coder");
	});

	it("darwin includes cwd in the script", () => {
		const result = buildStandaloneCommand("darwin", {
			command: ["mya"],
			cwd: "/home/user/project",
		});
		expect(result.args[1]).toContain("/home/user/project");
	});

	it("win32 uses wt -w new", () => {
		const result = buildStandaloneCommand("win32", opts);
		expect(result.cmd).toBe("wt");
		expect(result.args).toEqual(
			expect.arrayContaining(["-w", "new", "mya", "--role", "coder"]),
		);
	});

	it("linux picks kitty when available", () => {
		const result = buildStandaloneCommand(
			"linux",
			opts,
			(n) => n === "kitty",
		);
		expect(result.cmd).toBe("kitty");
		expect(result.args).toEqual(["mya", "--role", "coder"]);
	});

	it("linux picks gnome-terminal when kitty is unavailable", () => {
		const result = buildStandaloneCommand(
			"linux",
			opts,
			(n) => n === "gnome-terminal",
		);
		expect(result.cmd).toBe("gnome-terminal");
		expect(result.args[0]).toBe("--");
	});

	it("linux picks xterm when neither kitty nor gnome-terminal", () => {
		const result = buildStandaloneCommand(
			"linux",
			opts,
			(n) => n === "xterm",
		);
		expect(result.cmd).toBe("xterm");
		expect(result.args[0]).toBe("-e");
	});

	it("linux falls back to xterm when no terminal is detected", () => {
		const result = buildStandaloneCommand("linux", opts, () => false);
		expect(result.cmd).toBe("xterm");
	});
});

// ══════════════════════════════════════════════════════════════════════════
// resolveViewBackend
// ══════════════════════════════════════════════════════════════════════════

describe("resolveViewBackend", () => {
	beforeEach(() => clearViewEnv());
	afterEach(() => restoreViewEnv());

	it("returns tmux when TMUX is set (first match)", () => {
		process.env.TMUX = "/tmp/tmux,1234,0";
		expect(resolveViewBackend().id).toBe("tmux");
	});

	it("returns herdr when only HERDR_ENV is set", () => {
		process.env.HERDR_ENV = "1";
		expect(resolveViewBackend().id).toBe("herdr");
	});

	it("returns herdr when only HERDR_SOCKET_PATH is set", () => {
		process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock";
		expect(resolveViewBackend().id).toBe("herdr");
	});

	it("returns standalone (fallback) when no env vars are set", () => {
		expect(resolveViewBackend().id).toBe("standalone");
	});

	it("prefers tmux over herdr when both are set", () => {
		process.env.TMUX = "/tmp/tmux,1234,0";
		process.env.HERDR_ENV = "1";
		expect(resolveViewBackend().id).toBe("tmux");
	});
});

// ══════════════════════════════════════════════════════════════════════════
// openView convenience
// ══════════════════════════════════════════════════════════════════════════

describe("openView", () => {
	beforeEach(() => {
		clearViewEnv();
		mockSpawn.mockReset();
		mockSpawn.mockReturnValue(makeChild({ pid: 42 }));
	});
	afterEach(() => restoreViewEnv());

	it("resolves the active backend and opens a view", async () => {
		// No env vars → standalone
		const handle = await openView({ command: ["mya"], title: "test" });
		expect(handle.backendId).toBe("standalone");
		expect(mockSpawn).toHaveBeenCalledTimes(1);
	});
});

// ══════════════════════════════════════════════════════════════════════════
// registry extensibility
// ══════════════════════════════════════════════════════════════════════════

describe("VIEW_BACKENDS extensibility", () => {
	beforeEach(() => clearViewEnv());
	afterEach(() => restoreViewEnv());

	it("a custom backend inserted before the fallback is resolved", () => {
		const custom: ViewBackend = {
			id: "custom-test",
			detect: () => true,
			open: async () => ({ backendId: "custom-test", ref: "x" }),
		};

		// Insert before the last entry (standalone fallback).
		const insertIdx = VIEW_BACKENDS.length - 1;
		VIEW_BACKENDS.splice(insertIdx, 0, custom);

		try {
			expect(resolveViewBackend().id).toBe("custom-test");
		} finally {
			// Clean up — remove the custom backend.
			const idx = VIEW_BACKENDS.indexOf(custom);
			if (idx >= 0) VIEW_BACKENDS.splice(idx, 1);
		}
	});

	it("does not affect resolution when custom backend detect() is false", () => {
		const custom: ViewBackend = {
			id: "never-detects",
			detect: () => false,
			open: async () => ({ backendId: "never-detects", ref: "" }),
		};

		const insertIdx = VIEW_BACKENDS.length - 1;
		VIEW_BACKENDS.splice(insertIdx, 0, custom);

		try {
			// Falls through to standalone
			expect(resolveViewBackend().id).toBe("standalone");
		} finally {
			const idx = VIEW_BACKENDS.indexOf(custom);
			if (idx >= 0) VIEW_BACKENDS.splice(idx, 1);
		}
	});

	it("custom backend that detects wins over standalone but not tmux", () => {
		const custom: ViewBackend = {
			id: "wezterm-test",
			detect: () => true,
			open: async () => ({ backendId: "wezterm-test", ref: "w" }),
		};

		const insertIdx = VIEW_BACKENDS.length - 1;
		VIEW_BACKENDS.splice(insertIdx, 0, custom);

		try {
			// With TMUX set, tmux (first) wins over custom
			process.env.TMUX = "/tmp/tmux,1,0";
			expect(resolveViewBackend().id).toBe("tmux");

			// Without TMUX/herdr, custom (before standalone) wins
			delete process.env.TMUX;
			expect(resolveViewBackend().id).toBe("wezterm-test");
		} finally {
			const idx = VIEW_BACKENDS.indexOf(custom);
			if (idx >= 0) VIEW_BACKENDS.splice(idx, 1);
		}
	});
});
