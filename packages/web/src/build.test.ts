/**
 * @my-agent/web — build pipeline tests.
 * Uses a temp directory so the real dist/ is never touched.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

const WEB_DIR = join(import.meta.dirname, "..");
// Use a temp directory so tests never delete the real dist/
const TEST_DIR = mkdtempSync(join(tmpdir(), "mya-web-build-"));

describe("web build pipeline (temp dir, no real dist cleanup)", () => {
  beforeAll(() => {
    // No-op: we build into TEST_DIR, not the real dist
  });

  afterAll(() => {
    // Clean up only the temp directory, never the real dist
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("builds successfully with vite", () => {
    const output = execSync("npx vite build --outDir " + TEST_DIR, {
      cwd: WEB_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("built in");
  });

  it("produces index.html in temp dir", () => {
    const indexPath = join(TEST_DIR, "index.html");
    expect(existsSync(indexPath)).toBe(true);
    const html = readFileSync(indexPath, "utf-8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="root"');
    // Verify FOUC prevention script is present
    expect(html).toContain("mya-theme");
  });

  it("produces JavaScript bundle", () => {
    const jsFile = join(TEST_DIR, "assets", "index.js");
    expect(existsSync(jsFile)).toBe(true);
    const content = readFileSync(jsFile, "utf-8");
    expect(content.length).toBeGreaterThan(10000);
  });

  it("produces CSS bundle", () => {
    const cssFile = join(TEST_DIR, "assets", "index.css");
    expect(existsSync(cssFile)).toBe(true);
    const content = readFileSync(cssFile, "utf-8");
    expect(content.length).toBeGreaterThan(1000);
  });
});
