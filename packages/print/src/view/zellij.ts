/**
 * zellij view backend.
 *
 * detect(): true when `$ZELLIJ` is set (running inside a zellij session).
 *
 * open():   `zellij run --name <title> --cwd <cwd> -- <cmd…>` — opens a new
 *           zellij pane running the command. The `--name` flag is included
 *           when a title is provided (zellij supports naming panes). Output
 *           (session/pane info printed by zellij) is captured; the ref is
 *           derived from the title or the captured output.
 * focus():  `zellij action focus-next-pane` — best-effort focus (zellij does
 *           not have a stable "focus pane by id" CLI verb, so we cycle to the
 *           next pane). Non-zero exit is silently ignored (best-effort).
 *
 * Env vars for detection: `ZELLIJ`.
 */
import { runCapture } from "./run.js";
import type { ViewBackend, ViewHandle, ViewOpenOpts } from "./view-backend.js";

export const zellijBackend: ViewBackend = {
	id: "zellij",

	detect(): boolean {
		return !!process.env.ZELLIJ;
	},

	async open(opts: ViewOpenOpts): Promise<ViewHandle> {
		const args = ["run"];
		if (opts.title) args.push("--name", opts.title);
		if (opts.cwd) args.push("--cwd", opts.cwd);
		args.push("--", ...opts.command);

		const { stdout, code } = await runCapture("zellij", args, {
			cwd: opts.cwd,
		});
		if (code !== 0) {
			throw new Error(`zellij run failed (exit ${code})`);
		}
		// zellij may print session/pane info on stdout; use it as the ref,
		// falling back to the title or a constant.
		const ref = stdout.trim() || (opts.title ?? "zellij-pane");
		return { backendId: "zellij", ref };
	},

	async focus(handle: ViewHandle): Promise<void> {
		// Best-effort: zellij lacks a stable "focus pane by ref" CLI verb.
		// We use `action focus-next-pane` to cycle focus. Non-zero exit is
		// silently ignored — `runCapture` only rejects on spawn-level errors
		// (ENOENT), mirroring the tmux/herdr backend convention.
		//
		// NOTE: `handle.ref` is not used because zellij does not support
		// addressing panes by an externally-known ref via CLI.
		await runCapture("zellij", ["action", "focus-next-pane"]);
	},
};
