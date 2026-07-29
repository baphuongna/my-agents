/**
 * Standalone terminal backend (unconditional fallback).
 *
 * detect(): always true — this is the last entry in `VIEW_BACKENDS` so it
 *           catches every environment not handled by tmux or herdr.
 *
 * open():   opens a new OS-native terminal window:
 *             macOS   → `osascript` (Terminal.app `do script`)
 *             Linux   → `kitty` / `gnome-terminal` / `xterm -e` (first found)
 *             Windows → `wt -w new` (Windows Terminal)
 */
import { existsSync } from "node:fs";
import { runDetached } from "./run.js";
import type { ViewBackend, ViewHandle, ViewOpenOpts } from "./view-backend.js";

/**
 * Pure command builder for the standalone backend. Exported for unit testing
 * (avoids needing to mock `process.platform` or the filesystem).
 *
 * @param platform     `process.platform` value ("darwin", "linux", "win32", …).
 * @param opts         View-open options (command, optional title/cwd).
 * @param hasTerminal  Optional predicate: "is this terminal binary available?"
 *                     Defaults to checking `/usr/bin/<name>` and `/usr/local/bin/<name>`.
 */
export function buildStandaloneCommand(
	platform: string,
	opts: ViewOpenOpts,
	hasTerminal?: (name: string) => boolean,
): { cmd: string; args: string[] } {
	const cmdStr = [...opts.command].join(" ");
	const cwd = opts.cwd ?? ".";

	if (platform === "darwin") {
		// macOS — use osascript to open Terminal.app and run the command.
		const script = `tell application "Terminal" to do script "cd '${cwd}' && ${cmdStr}"`;
		return { cmd: "osascript", args: ["-e", script] };
	}

	if (platform === "win32") {
		// Windows — Windows Terminal (`wt`).
		return { cmd: "wt", args: ["-w", "new", ...opts.command] };
	}

	// Linux / other — pick the first available terminal emulator.
	const has =
		hasTerminal ??
		((name: string) =>
			existsSync(`/usr/bin/${name}`) ||
			existsSync(`/usr/local/bin/${name}`));

	if (has("kitty")) return { cmd: "kitty", args: [...opts.command] };
	if (has("gnome-terminal"))
		return { cmd: "gnome-terminal", args: ["--", ...opts.command] };
	if (has("xterm")) return { cmd: "xterm", args: ["-e", ...opts.command] };

	// Fallback — assume xterm is available.
	return { cmd: "xterm", args: ["-e", ...opts.command] };
}

export const standaloneBackend: ViewBackend = {
	id: "standalone",

	detect(): boolean {
		return true;
	},

	async open(opts: ViewOpenOpts): Promise<ViewHandle> {
		const { cmd, args } = buildStandaloneCommand(process.platform, opts);
		const pid = runDetached(cmd, args);
		return { backendId: "standalone", ref: String(pid) };
	},
};
