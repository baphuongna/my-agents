/**
 * GNU screen view backend.
 *
 * detect(): true when `$STY` is set (running inside a screen session).
 *
 * open():   `screen -t <title> <cmd…>` — creates a new screen window with the
 *           given title running the command. `screen` by default operates on
 *           the current session (`$STY`), so no explicit session reference is
 *           needed. The ref is the window title (or a constant when no title
 *           is given).
 * focus():  `screen -X select <ref>` — in-session window select. The old
 *           verb `-p <ref>` was WRONG (preselects on new screen start, not
 *           switch). Non-zero exit is silently ignored (best-effort).
 *
 * Env vars for detection: `STY`.
 */
import { runCapture } from "./run.js";
import type { ViewBackend, ViewHandle, ViewOpenOpts } from "./view-backend.js";

export const screenBackend: ViewBackend = {
	id: "screen",

	detect(): boolean {
		return !!process.env.STY;
	},

	async open(opts: ViewOpenOpts): Promise<ViewHandle> {
		const title = opts.title ?? "screen-window";
		const args = ["-t", title, ...opts.command];

		const { code } = await runCapture("screen", args, {
			cwd: opts.cwd,
		});
		if (code !== 0) {
			throw new Error(`screen -t failed (exit ${code})`);
		}
		// ref is the window title; screen addresses windows by title or number.
		const ref = title;
		return { backendId: "screen", ref };
	},

	async focus(handle: ViewHandle): Promise<void> {
		// Best-effort: switch to the window referenced by handle.ref (title or
		// number). Use `-X select` — the CORRECT in-session window-select verb
		// (`-p` preselects on new screen start, does NOT switch). Non-zero exit
		// is silently ignored — `runCapture` only rejects on spawn-level errors
		// (ENOENT), mirroring the herdr backend convention.
		await runCapture("screen", ["-X", "select", handle.ref]);
	},

	async close(handle: ViewHandle): Promise<void> {
		// F3R-3: screen -X select returns 0 regardless of whether the window
		// exists (exit code reflects command delivery, not success), so a
		// code-guard is ineffective. Use `screen -Q windows` (≥4.06) to verify
		// the window exists BEFORE selecting + killing — otherwise kill hits
		// the currently-focused window (could be the main session).
		const windows = await runCapture("screen", ["-Q", "windows"]);
		if (windows.stdout.includes(handle.ref)) {
			await runCapture("screen", ["-X", "select", handle.ref]);
			await runCapture("screen", ["-X", "kill"]);
		}
	},
};
