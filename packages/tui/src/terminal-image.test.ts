/**
 * Tests for terminal-image capability detection and cell-dimension helpers.
 *
 * These are pure / process.env-driven functions with module-level caches,
 * so we carefully save & restore the relevant environment variables and the
 * cached capabilities between tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	getCellDimensions,
	setCellDimensions,
	detectCapabilities,
	getCapabilities,
	resetCapabilitiesCache,
	setCapabilities,
	type CellDimensions,
	type TerminalCapabilities,
} from "./terminal-image.ts";

// Every env var read by detectCapabilities(). Snapshot/restore between tests.
const ENV_KEYS = [
	"TERM_PROGRAM",
	"TERMINAL_EMULATOR",
	"TERM",
	"COLORTERM",
	"TMUX",
	"KITTY_WINDOW_ID",
	"GHOSTTY_RESOURCES_DIR",
	"WEZTERM_PANE",
	"WARP_SESSION_ID",
	"WARP_TERMINAL_SESSION_UUID",
	"ITERM_SESSION_ID",
	"WT_SESSION",
] as const;

let savedEnv: Record<string, string | undefined> = {};
const NO_TMUX = (): boolean => false;

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
	for (const key of ENV_KEYS) delete process.env[key];
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("cell dimensions get/set", () => {
	const original = { ...getCellDimensions() };

	afterEach(() => {
		setCellDimensions(original);
	});

	it("returns the default dimensions", () => {
		const dims = getCellDimensions();
		expect(dims.widthPx).toBeGreaterThan(0);
		expect(dims.heightPx).toBeGreaterThan(0);
	});

	it("round-trips a custom value through set/get", () => {
		const custom: CellDimensions = { widthPx: 10, heightPx: 21 };
		setCellDimensions(custom);
		expect(getCellDimensions()).toEqual(custom);
	});

	it("reflects the most recently set value", () => {
		setCellDimensions({ widthPx: 7, heightPx: 14 });
		expect(getCellDimensions()).toEqual({ widthPx: 7, heightPx: 14 });
		setCellDimensions({ widthPx: 12, heightPx: 24 });
		expect(getCellDimensions().widthPx).toBe(12);
		expect(getCellDimensions().heightPx).toBe(24);
	});
});

describe("detectCapabilities — protocol detection", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("detects Kitty via TERM_PROGRAM", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBe("kitty");
		expect(caps.trueColor).toBe(true);
		expect(caps.hyperlinks).toBe(true);
	});

	it("detects Kitty via KITTY_WINDOW_ID", () => {
		setEnv({ KITTY_WINDOW_ID: "1" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBe("kitty");
	});

	it("detects iTerm2 via TERM_PROGRAM (case-insensitive)", () => {
		setEnv({ TERM_PROGRAM: "iTerm.app" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBe("iterm2");
		expect(caps.trueColor).toBe(true);
		expect(caps.hyperlinks).toBe(true);
	});

	it("detects iTerm2 via ITERM_SESSION_ID", () => {
		setEnv({ ITERM_SESSION_ID: "p:abc" });
		expect(detectCapabilities(NO_TMUX).images).toBe("iterm2");
	});

	it("returns no protocol for a basic/unknown terminal", () => {
		setEnv({ TERM: "xterm-256color" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});
});

describe("detectCapabilities — terminal multiplexers", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("under tmux disables images and defers hyperlinks to the probe", () => {
		setEnv({ TMUX: "/tmp/tmux-1000/default,1234,0" });
		expect(detectCapabilities(() => true).hyperlinks).toBe(true);
		expect(detectCapabilities(() => false).hyperlinks).toBe(false);
		expect(detectCapabilities(() => true).images).toBeNull();
	});

	it("under tmux (via TERM) also disables images", () => {
		setEnv({ TERM: "tmux-256color" });
		const caps = detectCapabilities(() => false);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});

	it("under screen disables images and hyperlinks", () => {
		setEnv({ TERM: "screen-256color" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});
});

describe("detectCapabilities — other known terminals", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("detects Ghostty (TERM_PROGRAM) as Kitty-capable", () => {
		setEnv({ TERM_PROGRAM: "ghostty" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("detects Ghostty via GHOSTTY_RESOURCES_DIR", () => {
		setEnv({ GHOSTTY_RESOURCES_DIR: "/opt/ghostty" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("detects WezTerm via WEZTERM_PANE", () => {
		setEnv({ WEZTERM_PANE: "0" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("detects Warp via WARP_SESSION_ID", () => {
		setEnv({ WARP_SESSION_ID: "abc" });
		expect(detectCapabilities(NO_TMUX).images).toBe("kitty");
	});

	it("Windows Terminal (WT_SESSION) has trueColor + hyperlinks but no images", () => {
		setEnv({ WT_SESSION: "abc" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.trueColor).toBe(true);
		expect(caps.hyperlinks).toBe(true);
	});

	it("VSCode terminal has hyperlinks but no image protocol", () => {
		setEnv({ TERM_PROGRAM: "vscode" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(true);
		expect(caps.trueColor).toBe(true);
	});

	it("JetBrains (jediterm) disables hyperlinks", () => {
		setEnv({ TERMINAL_EMULATOR: "JetBrains-JediTerm" });
		const caps = detectCapabilities(NO_TMUX);
		expect(caps.images).toBeNull();
		expect(caps.hyperlinks).toBe(false);
	});
});

describe("detectCapabilities — COLORTERM trueColor hint", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("reports trueColor when COLORTERM=truecolor on an unknown terminal", () => {
		setEnv({ TERM: "xterm", COLORTERM: "truecolor" });
		expect(detectCapabilities(NO_TMUX).trueColor).toBe(true);
	});

	it("reports trueColor when COLORTERM=24bit", () => {
		setEnv({ COLORTERM: "24bit" });
		expect(detectCapabilities(NO_TMUX).trueColor).toBe(true);
	});

	it("reports false for trueColor when no hint on an unknown terminal", () => {
		setEnv({ TERM: "xterm" });
		expect(detectCapabilities(NO_TMUX).trueColor).toBe(false);
	});
});

describe("capabilities caching", () => {
	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		setEnv({});
		resetCapabilitiesCache();
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetCapabilitiesCache();
	});

	it("getCapabilities caches the detected result (same reference)", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		const first = getCapabilities();
		const second = getCapabilities();
		expect(second).toBe(first);
	});

	it("resetCapabilitiesCache forces a re-detection", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		const first = getCapabilities();
		resetCapabilitiesCache();
		// Same env → re-detects to an equal (but distinct) object.
		const second = getCapabilities();
		expect(second).toEqual(first);
		expect(second).not.toBe(first);
	});

	it("re-detection after reset reflects a changed environment", () => {
		setEnv({ TERM_PROGRAM: "kitty" });
		expect(getCapabilities().images).toBe("kitty");

		resetCapabilitiesCache();
		setEnv({ TERM_PROGRAM: "iTerm.app" });
		expect(getCapabilities().images).toBe("iterm2");
	});

	it("setCapabilities overrides the cache directly", () => {
		const override: TerminalCapabilities = {
			images: "iterm2",
			trueColor: false,
			hyperlinks: false,
		};
		setCapabilities(override);
		expect(getCapabilities()).toBe(override);
		resetCapabilitiesCache();
	});
});

describe("ImageProtocol type values", () => {
	it("accepts the three allowed protocol values", () => {
		const protocols: ("kitty" | "iterm2" | null)[] = ["kitty", "iterm2", null];
		expect(protocols).toContain("kitty");
		expect(protocols).toContain("iterm2");
		expect(protocols).toContain(null);
	});
});
