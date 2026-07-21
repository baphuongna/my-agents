/**
 * @my-agent/web — build pipeline tests.
 *
 * Verifies that the Vite build produces the SPA output files (React app).
 * The old library-mode build (web.js exporting dashboardHtml) has been
 * replaced by a Vite React app that builds to dist/web/assets/index.js.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, rmSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const WEB_DIR = join(import.meta.dirname, "..");
const DIST_DIR = join(WEB_DIR, "dist", "web");
const ASSETS_DIR = join(DIST_DIR, "assets");

describe("web build pipeline", () => {
  beforeAll(() => {
    if (existsSync(DIST_DIR)) {
      rmSync(DIST_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (existsSync(DIST_DIR)) {
      rmSync(DIST_DIR, { recursive: true, force: true });
    }
  });

  it("builds successfully with vite", () => {
    const output = execSync("npx vite build", {
      cwd: WEB_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("built in");
  });

  it("produces index.html in dist/web/", () => {
    expect(existsSync(join(DIST_DIR, "index.html"))).toBe(true);
    const html = readFileSync(join(DIST_DIR, "index.html"), "utf-8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/assets/index.js"');
  });

  it("produces JavaScript bundle in dist/web/assets/", () => {
    expect(existsSync(ASSETS_DIR)).toBe(true);
    const jsFile = join(ASSETS_DIR, "index.js");
    expect(existsSync(jsFile)).toBe(true);
    const content = readFileSync(jsFile, "utf-8");
    // Should be a substantial bundle (React + app code)
    expect(content.length).toBeGreaterThan(10000);
  });

  it("produces CSS bundle in dist/web/assets/", () => {
    const cssFile = join(ASSETS_DIR, "index.css");
    expect(existsSync(cssFile)).toBe(true);
    const content = readFileSync(cssFile, "utf-8");
    // Should contain Tailwind utilities
    expect(content.length).toBeGreaterThan(1000);
  });

  it("preserves PWA assets in dist/web/", () => {
    const entries = readdirSync(DIST_DIR);
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("sw.js");
    expect(entries).toContain("icons");
  });
});
