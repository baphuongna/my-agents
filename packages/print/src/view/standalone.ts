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
	if (platform === "darwin") {
		// macOS — use osascript to open Terminal.app and run the command.
		// Shell-escape each argv element (and cwd) with single-quote wrapping
		// so a task prompt containing shell metacharacters (`;`, `$()`, `'`)
		// can't break out of the AppleScript string or inject shell commands.
		// NEW-1 fix (replaces the earlier `"`/`\`-only esc() which left shell
		// metacharacters unescaped).
		const shellEsc = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
		const cmdStr = opts.command.map(shellEsc).join(" ");
		const cwdEsc = shellEsc(opts.cwd ?? ".");
		const script = `tell application "Terminal" to do script "cd ${cwdEsc} && ${cmdStr}"`;
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
		const pid = runDetached(cmd, args, { cwd: opts.cwd });
		return { backendId: "standalone", ref: String(pid) };
	},

	async close(_handle: ViewHandle): Promise<void> {
		// NO-OP: standalone opens a detached terminal window that is already
		// fire-and-forget. The child process runs in a new OS window; closing
		// it would require OS-specific window management (taskkill, pkill,
		// osascript) which is out of scope for the CLI-only view layer.
		// The OS terminal remains open — the user sees the spawned process
		// output and closes the window manually.
	},
};
