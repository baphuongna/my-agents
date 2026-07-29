/**
 * herdr view backend (VIEW-ONLY).
 *
 * detect(): true when `$HERDR_ENV` **or** `$HERDR_SOCKET_PATH` is set
 *           (running inside a herdr-managed terminal).
 *
 * open():   herdr has NO single one-shot "open pane + run command" CLI
 *           subcommand. Instead we use a three-step sequence with CLI
 *           pane-management commands (pure display operations):
 *
 *             1. `herdr pane split --direction right --focus [--cwd <dir>]`
 *                → creates a new pane in the current tab and focuses it.
 *             2. `herdr pane current`
 *                → JSON containing the now-current pane's `pane_id`.
 *             3. `herdr pane run <pane_id> <command…>`
 *                → runs the command inside the new pane.
 *
 *           These are view/display operations only. We do NOT use herdr's
 *           socket API (`agent.start` / `session.snapshot` / `pane.read`)
 *           for spawn, track, or control — those concerns stay in the
 *           gateway logic layer.
 *
 * focus():  `herdr agent focus <pane_id>` — switch to a previously opened
 *           pane. NOTE: herdr's `pane focus` verb is direction-only
 *           (cli/pane.rs requires `--direction`); there is no absolute
 *           "focus this pane by id" under the `pane` verb. Absolute focus
 *           lives under `agent`: herdr resolves the public pane id (the
 *           `<workspace>:<pane_number>` stored in `ViewHandle.ref`) to the
 *           detected agent and focuses its pane. Best-effort: non-zero exit
 *           is silently ignored (older herdr / agent-not-yet-detected).
 *
 * Env vars for detection: `HERDR_ENV`, `HERDR_SOCKET_PATH`.
 */
import { runCapture } from "./run.js";
import type { ViewBackend, ViewHandle, ViewOpenOpts } from "./view-backend.js";

/** Minimal shape of `herdr pane current` JSON output. */
interface HerdrPaneCurrent {
	result?: {
		pane?: {
			pane_id?: string;
		};
	};
}

export const herdrBackend: ViewBackend = {
	id: "herdr",

	detect(): boolean {
		return !!(process.env.HERDR_ENV || process.env.HERDR_SOCKET_PATH);
	},

	async open(opts: ViewOpenOpts): Promise<ViewHandle> {
		// Step 1 — split the current pane to create a new one (focused). herdr's
		// `pane split` may emit the new pane's JSON (pane_id); if so, use it directly
		// to avoid a split→current TOCTOU race (MEDIUM-2). Fall back to `pane
		// current` only if split didn't yield a pane_id.
		const splitArgs = ["pane", "split", "--direction", "right", "--focus"];
		if (opts.cwd) splitArgs.push("--cwd", opts.cwd);
		const split = await runCapture("herdr", splitArgs);
		if (split.code !== 0) {
			throw new Error(`herdr pane split failed (exit ${split.code})`);
		}

		let paneId = "";
		try {
			const parsed = JSON.parse(split.stdout) as HerdrPaneCurrent;
			paneId = parsed.result?.pane?.pane_id ?? "";
		} catch {
			// split output wasn't JSON — fall through to `pane current`.
		}

		// Step 2 — fall back to reading the now-current pane id if split didn't
		// return one.
		if (!paneId) {
			const current = await runCapture("herdr", ["pane", "current"]);
			if (current.code !== 0) {
				throw new Error(
					`herdr pane current failed (exit ${current.code})`,
				);
			}
			try {
				const parsed = JSON.parse(current.stdout) as HerdrPaneCurrent;
				paneId = parsed.result?.pane?.pane_id ?? "";
			} catch {
				throw new Error(
					"herdr pane current returned unexpected (non-JSON) output",
				);
			}
		}
		if (!paneId) {
			throw new Error("herdr: could not resolve new pane id (split + current both failed)");
		}

		// Step 3 — run the command in the new pane.
		const run = await runCapture("herdr", [
			"pane",
			"run",
			paneId,
			...opts.command,
		]);
		if (run.code !== 0) {
			throw new Error(`herdr pane run failed (exit ${run.code})`);
		}

		return { backendId: "herdr", ref: paneId };
	},

	async focus(handle: ViewHandle): Promise<void> {
		// herdr has NO absolute `pane focus <id>` — that verb is direction-only
		// (cli/pane.rs requires `--direction`). Absolute focus lives under
		// `agent`: herdr resolves the public pane id to the detected agent and
		// focuses its pane. Best-effort: silently ignore non-zero exit (older
		// herdr / agent-not-yet-detected). `runCapture` only rejects on
		// spawn-level errors (ENOENT), mirroring the tmux backend.
		await runCapture("herdr", ["agent", "focus", handle.ref]);
	},
};
