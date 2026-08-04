/**
 * [unit] spawn-mya helper — verifies the 3-case MYA_BIN dispatch.
 *
 * The helper was extracted from 3 feature test files that all had the same
 * bug: when MYA_BIN was set to a .js path, they still prepended "dist/mya.js"
 * to argv, causing the binary to hang.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("[unit] myaSpawnInfo", () => {
	const origBin = process.env["MYA_BIN"];

	afterEach(() => {
		if (origBin === undefined) delete process.env["MYA_BIN"];
		else process.env["MYA_BIN"] = origBin;
	});

	it("MYA_BIN=<file>.js → spawn node with [MYA_BIN]", async () => {
		process.env["MYA_BIN"] = "/abs/path/to/mya.js";
		const { myaSpawnInfo } = await import("../../../test/helpers/spawn-mya.ts");
		const info = myaSpawnInfo();
		expect(info.cmd).toBe("node");
		expect(info.args).toEqual(["/abs/path/to/mya.js"]);
	});

	it("MYA_BIN=<file>.mjs → spawn node with [MYA_BIN]", async () => {
		process.env["MYA_BIN"] = "./build/mya.mjs";
		const { myaSpawnInfo } = await import("../../../test/helpers/spawn-mya.ts");
		const info = myaSpawnInfo();
		expect(info.cmd).toBe("node");
		expect(info.args).toEqual(["./build/mya.mjs"]);
	});

	it("MYA_BIN=<file>.cjs → spawn node with [MYA_BIN]", async () => {
		process.env["MYA_BIN"] = "./build/mya.cjs";
		const { myaSpawnInfo } = await import("../../../test/helpers/spawn-mya.ts");
		const info = myaSpawnInfo();
		expect(info.cmd).toBe("node");
		expect(info.args).toEqual(["./build/mya.cjs"]);
	});

	it("MYA_BIN=./mya (compiled binary) → spawn directly with no prefix", async () => {
		process.env["MYA_BIN"] = "./mya";
		const { myaSpawnInfo } = await import("../../../test/helpers/spawn-mya.ts");
		const info = myaSpawnInfo();
		expect(info.cmd).toBe("./mya");
		expect(info.args).toEqual([]);
	});

	it("MYA_BIN unset + dist/mya.js exists → spawn node dist/mya.js", async () => {
		delete process.env["MYA_BIN"];
		const { myaSpawnInfo } = await import("../../../test/helpers/spawn-mya.ts");
		// Test runs from project root where dist/mya.js exists (after npm run bundle).
		// If dist/mya.js is missing, myaSpawnInfo throws — which is correct behavior.
		try {
			const info = myaSpawnInfo();
			expect(info.cmd).toBe("node");
			expect(info.args).toEqual(["dist/mya.js"]);
		} catch (e) {
			// Acceptable: dist/mya.js not built yet.
			expect((e as Error).message).toContain("not found");
		}
	});

	it("MYA_BIN='' (empty) → treated as unset, falls through to dist/mya.js", async () => {
		process.env["MYA_BIN"] = "";
		const { myaSpawnInfo } = await import("../../../test/helpers/spawn-mya.ts");
		try {
			const info = myaSpawnInfo();
			expect(info.cmd).toBe("node");
			expect(info.args).toEqual(["dist/mya.js"]);
		} catch (e) {
			expect((e as Error).message).toContain("not found");
		}
	});
});
