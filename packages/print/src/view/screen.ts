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
 * focus():  `screen -p <ref>` — best-effort switch to the window referenced by
 *           `handle.ref` (a title or number). Non-zero exit is silently ignored
 *           (best-effort), mirroring the herdr convention.
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
		// number). `-p` selects the window by number or title. Non-zero exit is
		// silently ignored — `runCapture` only rejects on spawn-level errors
		// (ENOENT), mirroring the herdr backend convention.
		await runCapture("screen", ["-p", handle.ref]);
	},
};
