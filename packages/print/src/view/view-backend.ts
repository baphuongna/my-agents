/**
 * View layer — extensible SPI for opening terminal views (panes/windows/tabs).
 *
 * The LOGIC layer (mya gateway, spawn-role-subagent) NEVER imports a mux
 * directly. It calls `openView()` / `resolveViewBackend()` against this
 * interface. Adding a new backend (wezterm, zellij, screen, ssh-detach, …) =
 * insert one entry into `VIEW_BACKENDS` before the fallback. Zero change to
 * the interface or resolver.
 *
 * See: docs/mya-subagent-design.md — "View layer — the extensible SPI".
 */
import { tmuxBackend } from "./tmux.js";
import { herdrBackend } from "./herdr.js";
import { cmuxBackend } from "./cmux.js";
import { zellijBackend } from "./zellij.js";
import { screenBackend } from "./screen.js";
import { standaloneBackend } from "./standalone.js";

/** Opaque handle to an opened view (pane / window / tab). */
export interface ViewHandle {
	/** Which backend created this view (e.g. "tmux", "herdr", "standalone"). */
	readonly backendId: string;
	/** Backend-specific reference (tmux window id, herdr pane id, OS pid, …). */
	readonly ref: string;
}

/** Options for opening a new view. */
export interface ViewOpenOpts {
	/** Command to run inside the view (argv[0] = executable). */
	command: readonly string[];
	/** Optional title / label for the view. */
	title?: string;
	/** Optional working directory. */
	cwd?: string;
}

/** A pluggable terminal-view backend. */
export interface ViewBackend {
	/** Stable identifier (e.g. "tmux", "herdr", "standalone"). */
	readonly id: string;
	/** Return true if this backend is active in the current environment. */
	detect(): boolean;
	/** Open a new view running the given command. */
	open(opts: ViewOpenOpts): Promise<ViewHandle>;
	/** Optional: bring an existing view to the foreground. */
	focus?(handle: ViewHandle): Promise<void>;
	/** Optional: close / destroy an existing view. */
	close?(handle: ViewHandle): Promise<void>;
}

/**
 * Ordered registry of view backends.
 *
 * `resolveViewBackend()` scans in order and returns the FIRST whose
 * `detect()` is true. The LAST entry must always be a fallback whose
 * `detect()` is unconditionally true (standalone).
 *
 * To register a new backend at runtime, insert it before the fallback:
 *   ```ts
 *   VIEW_BACKENDS.splice(VIEW_BACKENDS.length - 1, 0, myBackend);
 *   ```
 */
export const VIEW_BACKENDS: ViewBackend[] = [
	tmuxBackend,
	herdrBackend,
	cmuxBackend,
	zellijBackend,
	screenBackend,
	standaloneBackend,
];

/**
 * Pick the best available backend: first whose `detect()` returns true,
 * or the last entry (the unconditional fallback).
 */
export function resolveViewBackend(): ViewBackend {
	return (
		VIEW_BACKENDS.find((b) => b.detect()) ??
		VIEW_BACKENDS[VIEW_BACKENDS.length - 1]!
	);
}

/** Convenience: resolve the active backend and open a view in one call. */
export async function openView(opts: ViewOpenOpts): Promise<ViewHandle> {
	return resolveViewBackend().open(opts);
}
