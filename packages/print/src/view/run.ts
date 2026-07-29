/**
 * Shared process-execution helpers for view backends.
 *
 * These wrap `node:child_process`::spawn into two ergonomic shapes:
 *  - runCapture: wait for exit, collect stdout/stderr (for CLI commands that
 *    return data, e.g. `tmux new-window -P` or `herdr pane current`).
 *  - runDetached: fire-and-forget a detached child (for launching a terminal
 *    window that outlives the parent), returning the PID.
 *
 * This module is part of the VIEW layer — it must not import any gateway,
 * pool, or logic-layer code.
 */
import { spawn } from "node:child_process";

/** Result of a captured child process run. */
export interface RunResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number | null;
}

/**
 * Spawn a command, capture stdout/stderr, and resolve on close.
 *
 * Rejects only on spawn-level errors (ENOENT etc.); a non-zero exit code is
 * returned in `code` so callers can decide how to handle it.
 */
export function runCapture(
	cmd: string,
	args: readonly string[],
	opts?: { cwd?: string },
): Promise<RunResult> {
	return new Promise<RunResult>((resolve, reject) => {
		const child = spawn(cmd, [...args], {
			cwd: opts?.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (d: string) => {
			stdout += d;
		});
		child.stderr?.on("data", (d: string) => {
			stderr += d;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ stdout, stderr, code }));
	});
}

/**
 * Spawn a detached child (new process group) and return immediately.
 *
 * Used for launching terminal windows that should outlive the parent process.
 * Returns the child PID.
 */
export function runDetached(cmd: string, args: readonly string[]): number {
	const child = spawn(cmd, [...args], { stdio: "ignore", detached: true });
	child.on("error", () => {}); // best-effort — ENOENT (missing terminal) must not crash the parent (F8)
	child.unref();
	return child.pid ?? 0;
}
