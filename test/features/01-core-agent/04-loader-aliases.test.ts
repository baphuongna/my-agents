/**
 * Smoke tests for the extension loader alias resolution.
 *
 * Verifies that the dev-mode alias map resolves every @earendil-works/pi-*
 * specifier to a real file inside node_modules (not a workspace package that
 * happens to share a directory name — the "alias shadowing" bug fixed in the
 * pi migration cold-review).
 *
 * The test imports loader.ts which transitively pulls in the full coding-agent
 * index. We vi.mock the handful of deep imports that don't resolve under the
 * root vitest config (highlight.js/lib/index.js) so the module loads cleanly.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

// highlight.js v11 removed the ./lib/index.js subpath from its exports map.
// The coding-agent bundles fine (Bun resolves it) but the root vitest config
// uses strict exports resolution. Mock it so the transitive import chain works.
vi.mock("highlight.js/lib/index.js", () => ({ default: { highlight: () => ({ value: "" }), highlightAuto: () => ({ value: "" }) } }));

const { getAliases, VIRTUAL_MODULES } = await import("../../../packages/coding-agent/src/core/extensions/loader.ts");

describe("[smoke] extension loader aliases", () => {
	const aliases = getAliases();

	it("returns entries for all @earendil-works/pi-* specifiers", () => {
		const required = [
			"@earendil-works/pi-agent-core",
			"@earendil-works/pi-tui",
			"@earendil-works/pi-ai",
			"@earendil-works/pi-ai/compat",
			"@earendil-works/pi-ai/oauth",
			"@earendil-works/pi-ai/providers/all",
			"@earendil-works/pi-coding-agent",
		];
		for (const key of required) {
			expect(aliases[key], `alias for ${key} should exist`).toBeDefined();
			expect(typeof aliases[key]).toBe("string");
		}
	});

	it("resolves @earendil-works/pi-agent-core to a real node_modules file", () => {
		const entry = aliases["@earendil-works/pi-agent-core"];
		expect(entry).toContain("node_modules");
		expect(entry).toContain("@earendil-works/pi-agent-core");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-tui to a real node_modules file", () => {
		const entry = aliases["@earendil-works/pi-tui"];
		expect(entry).toContain("node_modules");
		expect(entry).toContain("@earendil-works/pi-tui");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai/compat to a real node_modules file", () => {
		const entry = aliases["@earendil-works/pi-ai/compat"];
		expect(entry).toContain("node_modules");
		expect(entry).toContain("@earendil-works/pi-ai");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai/oauth to a real node_modules file", () => {
		const entry = aliases["@earendil-works/pi-ai/oauth"];
		expect(entry).toContain("node_modules");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai/providers/all to a real node_modules file", () => {
		const entry = aliases["@earendil-works/pi-ai/providers/all"];
		expect(entry).toContain("node_modules");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("does NOT resolve pi-agent-core to packages/agent/dist (shadowing guard)", () => {
		const entry = aliases["@earendil-works/pi-agent-core"];
		// packages/agent is @my-agent/agent, not pi-agent-core — it must never
		// be used as the resolution target.
		expect(entry).not.toContain(path.join("packages", "agent", "dist"));
	});

	it("does NOT resolve pi-ai/oauth to packages/ai/dist (shadowing guard)", () => {
		const entry = aliases["@earendil-works/pi-ai/oauth"];
		expect(entry).not.toContain(path.join("packages", "ai", "dist"));
	});
});

describe("[smoke] VIRTUAL_MODULES covers all alias keys", () => {
	it("has a VIRTUAL_MODULES entry for every alias key", () => {
		const aliases = getAliases();
		for (const key of Object.keys(aliases)) {
			expect(VIRTUAL_MODULES[key], `VIRTUAL_MODULES should contain "${key}"`).toBeDefined();
		}
	});
});
