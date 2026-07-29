/**
 * tmux view backend.
 *
 * detect(): true when `$TMUX` is set (running inside a tmux session).
 * open():   `tmux new-window -P -n <title> <cmd…>` — creates a new tmux
 *           window running the command and prints its window index (`-P`).
 * focus():  `tmux select-window -t <ref>` — switch to a previously opened window.
 */
import { runCapture } from "./run.js";
import type { ViewBackend, ViewHandle, ViewOpenOpts } from "./view-backend.js";

export const tmuxBackend: ViewBackend = {
	id: "tmux",

	detect(): boolean {
		return !!process.env.TMUX;
	},

	async open(opts: ViewOpenOpts): Promise<ViewHandle> {
		const args = ["new-window", "-P"];
		if (opts.title) args.push("-n", opts.title);
		args.push(...opts.command);

		const { stdout, code } = await runCapture("tmux", args, {
			cwd: opts.cwd,
		});
		if (code !== 0) {
			throw new Error(`tmux new-window failed (exit ${code})`);
		}
		// `-P` prints the new window index; fall back to title or a constant.
		const ref = stdout.trim() || (opts.title ?? "tmux-window");
		return { backendId: "tmux", ref };
	},

	async focus(handle: ViewHandle): Promise<void> {
		await runCapture("tmux", ["select-window", "-t", handle.ref]);
	},

	async close(handle: ViewHandle): Promise<void> {
		await runCapture("tmux", ["kill-window", "-t", handle.ref]);
	},
};
