/**
 * Smoke tests for npm pi-* package availability.
 *
 * Previously tested the forked coding-agent's internal getAliases() map.
 * After the fork→npm migration, the loader is internal to the npm package
 * (@earendil-works/pi-coding-agent) and getAliases/VIRTUAL_MODULES are no
 * longer exported. This test now verifies the observable contract: that every
 * @earendil-works/pi-* npm package is installed under node_modules with its
 * dist entry file present on disk.
 *
 * Note: the npm loader provides @mariozechner/* aliases but NOT @my-agent/*
 * aliases — a known breaking change documented in packages/print/src/pi-main.ts.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** Root node_modules/@earendil-works directory.
 *  Derived from pi-agent-core (which exports ./package.json in its exports map). */
const earendilDir = path.dirname(
  path.dirname(require.resolve("@earendil-works/pi-agent-core/package.json")),
);

/** Full path to a dist file inside an @earendil-works package. */
function distFile(pkg: string, relPath: string): string {
  return path.join(earendilDir, pkg, "dist", relPath);
}

describe("[smoke] @earendil-works/pi-* packages are installed with dist files", () => {
	it("resolves @earendil-works/pi-agent-core main dist to a real file", () => {
		const entry = distFile("pi-agent-core", "index.js");
		expect(entry).toContain("node_modules");
		expect(entry).toContain("@earendil-works/pi-agent-core");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-tui main dist to a real file", () => {
		const entry = distFile("pi-tui", "index.js");
		expect(entry).toContain("node_modules");
		expect(entry).toContain("@earendil-works/pi-tui");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai main dist to a real file", () => {
		const entry = distFile("pi-ai", "index.js");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai/compat dist to a real file", () => {
		const entry = distFile("pi-ai", "compat.js");
		expect(entry).toContain("node_modules");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai/oauth dist to a real file", () => {
		const entry = distFile("pi-ai", "oauth.js");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-ai/providers/all dist to a real file", () => {
		const entry = distFile("pi-ai", "providers/all.js");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("resolves @earendil-works/pi-coding-agent main dist to a real file", () => {
		const entry = distFile("pi-coding-agent", "index.js");
		expect(entry).toContain("node_modules");
		expect(entry).toContain("@earendil-works/pi-coding-agent");
		expect(existsSync(entry), `${entry} should exist`).toBe(true);
	});

	it("does NOT resolve pi-agent-core to packages/agent (shadowing guard)", () => {
		const entry = distFile("pi-agent-core", "index.js");
		// packages/agent is @my-agent/agent, not pi-agent-core — the npm
		// package must live under node_modules, not packages/.
		expect(entry).toContain("node_modules");
		expect(entry).not.toContain(path.join("packages", "agent"));
	});

	it("does NOT resolve pi-ai to packages/ai (shadowing guard)", () => {
		const entry = distFile("pi-ai", "oauth.js");
		expect(entry).toContain("node_modules");
		expect(entry).not.toContain(path.join("packages", "ai"));
	});
});
