/**
 * @my-agent/web — build pipeline tests.
 *
 * Verifies that the Vite build produces output files and that the built
 * dashboard can be imported correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";

const WEB_DIR = join(import.meta.dirname, "..");
const DIST_DIR = join(WEB_DIR, "dist", "web");

describe("web build pipeline", () => {
  beforeAll(() => {
    // Clean previous build output
    if (existsSync(DIST_DIR)) {
      rmSync(DIST_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up build output
    if (existsSync(DIST_DIR)) {
      rmSync(DIST_DIR, { recursive: true, force: true });
    }
  });

  it("builds successfully with vite", () => {
    // Run the build
    const output = execSync("npx vite build", {
      cwd: WEB_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    
    // Verify build completed without errors
    expect(output).toContain("built in");
  });

  it("produces output in dist/web/", () => {
    // Check that the build output directory exists
    expect(existsSync(DIST_DIR)).toBe(true);
    
    // Check for the built JavaScript file
    const jsFiles = execSync("ls dist/web/", {
      cwd: WEB_DIR,
      encoding: "utf-8",
    });
    
    // Should contain at least one .js file
    expect(jsFiles).toContain("web.js");
  });

  it("produces valid JavaScript output", () => {
    // Read the built JavaScript file
    const jsFiles = execSync("ls dist/web/*.js", {
      cwd: WEB_DIR,
      encoding: "utf-8",
    }).trim().split("\n");
    
    expect(jsFiles.length).toBeGreaterThan(0);
    
    // Check that the file contains expected exports — use web.js (entry point),
    // not sw.js (service worker copied from public/ by Vite).
    const content = execSync(`cat dist/web/web.js`, {
      cwd: WEB_DIR,
      encoding: "utf-8",
    });
    
    // Should contain the dashboardHtml function or its minified version
    expect(content).toContain("dashboardHtml");
  });

  it("built output can be imported", async () => {
    // Import the built module
    const builtModule = await import(join(DIST_DIR, "web.js"));
    
    // Should export dashboardHtml
    expect(typeof builtModule.dashboardHtml).toBe("function");
    
    // Should produce valid HTML
    const html = builtModule.dashboardHtml();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<html");
    expect(html).toContain("mya");
  });
});
