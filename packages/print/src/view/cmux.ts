/**
 * cmux view backend (macOS tmux-compatible multiplexer).
 *
 * **ASSUMPTION:** cmux is a macOS terminal multiplexer that provides a
 * tmux-compatible CLI. This backend assumes cmux accepts the same CLI
 * invocations as tmux (`new-window`, `select-window`) and sets a `$CMUX`
 * environment variable (analogous to how tmux sets `$TMUX`). In practice
 * cmux may behave differently — if `detect()` returns false (because
 * `$CMUX` is unset), the resolver falls through to other backends.
 *
 * detect(): true when `$CMUX` is set (assumed set inside a cmux session).
 * open():   `cmux new-window -P -n <title> <cmd…>` — creates a new cmux
 *           window running the command and prints its window index (`-P`).
 * focus():  `cmux select-window -t <ref>` — switch to a previously opened window.
 */
import { runCapture } from "./run.js";
import type { ViewBackend, ViewHandle, ViewOpenOpts } from "./view-backend.js";

export const cmuxBackend: ViewBackend = {
	id: "cmux",

	detect(): boolean {
		return !!process.env.CMUX;
	},

	async open(opts: ViewOpenOpts): Promise<ViewHandle> {
		const args = ["new-window", "-P"];
		if (opts.title) args.push("-n", opts.title);
		args.push(...opts.command);

		const { stdout, code } = await runCapture("cmux", args, {
			cwd: opts.cwd,
		});
		if (code !== 0) {
			throw new Error(`cmux new-window failed (exit ${code})`);
		}
		// `-P` prints the new window index; fall back to title or a constant.
		const ref = stdout.trim() || (opts.title ?? "cmux-window");
		return { backendId: "cmux", ref };
	},

	async focus(handle: ViewHandle): Promise<void> {
		await runCapture("cmux", ["select-window", "-t", handle.ref]);
	},
};
