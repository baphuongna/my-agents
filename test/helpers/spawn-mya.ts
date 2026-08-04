/**
 * Shared helper for spawning the `mya` binary in [real] and [system] tests.
 *
 * Handles three cases:
 *  1. MYA_BIN=/path/to/mya.js  → spawn("node", [MYA_BIN, ...args])
 *  2. MYA_BIN=./mya            → spawn(MYA_BIN, args)   (compiled binary)
 *  3. MYA_BIN unset            → spawn("node", ["dist/mya.js", ...args])
 *
 * Without this helper, setting MYA_BIN to a .js path caused tests to
 * double-prepend "dist/mya.js" into argv — the binary received garbled
 * positional args and hung indefinitely.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";

/** Returns [command, prefixArgs] for the given MYA_BIN setting. */
export function myaSpawnInfo(): { cmd: string; args: string[] } {
	const bin = process.env["MYA_BIN"];
	if (bin) {
		// .js, .mjs, .cjs → must run via node (has shebang but needs interpreter)
		if (/\.m?js$/.test(bin)) {
			return { cmd: "node", args: [bin] };
		}
		return { cmd: bin, args: [] };
	}
	if (!existsSync("dist/mya.js")) {
		throw new Error("dist/mya.js not found. Run: npm run bundle");
	}
	return { cmd: "node", args: ["dist/mya.js"] };
}

/** Spawn `mya` with the given sub-command args. */
export function spawnMya(args: string[], options: SpawnOptions = {}): ChildProcess {
	const { cmd, args: prefix } = myaSpawnInfo();
	return spawn(cmd, [...prefix, ...args], options);
}
