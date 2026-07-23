/**
 * Built-in tools — completeness contract tests.
 *
 * Verifies the `builtinTools` array (the single registration surface for all
 * first-party tools) is well-formed: every entry has a valid `.meta.name` and
 * a `.run` function, the core tools are present, names are unique, and the
 * total count matches the declared built-in set.
 *
 *   -  1: builtinTools is a non-empty array
 *   -  2: every entry has a non-empty string name and a `run` function
 *   -  3: every entry declares a requiredMode
 *   -  4: the core expected tools are all present
 *   -  5: there are no duplicate tool names
 *   -  6: the array length matches the expected built-in set (25)
 *   -  7: the screen + browser + generation + security tool groups are present
 */

import { describe, it, expect } from "vitest";
import { builtinTools } from "./builtin.js";

/** The core file/shell tools that must always be present. */
const CORE_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "ls",
  "find",
  "replace",
] as const;

describe("builtinTools — completeness", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(builtinTools)).toBe(true);
    expect(builtinTools.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty string name and a run function", () => {
    for (const tool of builtinTools) {
      expect(typeof tool.meta.name).toBe("string");
      expect(tool.meta.name.length).toBeGreaterThan(0);
      expect(typeof tool.run).toBe("function");
    }
  });

  it("every entry declares a requiredMode", () => {
    for (const tool of builtinTools) {
      expect(tool.meta.requiredMode).toBeDefined();
      expect(typeof tool.meta.requiredMode).toBe("string");
    }
  });

  it("contains all core expected tools (read/write/edit/bash/glob/grep/ls/find/replace)", () => {
    const names = new Set(builtinTools.map((t) => t.meta.name));
    for (const expected of CORE_TOOLS) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("has no duplicate tool names", () => {
    const names = builtinTools.map((t) => t.meta.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("count matches the expected built-in set", () => {
    // 9 core (read/write/edit/replace/bash/glob/grep/ls/find)
    // + 2 screen (capture/find)
    // + 8 browser (navigate/snapshot/click/type/scroll/back/press/screenshot)
    // + 2 security (osv_check/url_safety)
    // + 4 generation/kanban/disk (image_gen/video_gen/kanban/disk_cleanup)
    expect(builtinTools.length).toBe(25);
  });

  it("includes the screen, browser, security, and generation tool groups", () => {
    const names = new Set(builtinTools.map((t) => t.meta.name));
    // screen
    expect(names.has("screen_capture")).toBe(true);
    expect(names.has("screen_find")).toBe(true);
    // browser
    expect(names.has("browser_navigate")).toBe(true);
    expect(names.has("browser_click")).toBe(true);
    expect(names.has("browser_screenshot")).toBe(true);
    // security
    expect(names.has("osv_check")).toBe(true);
    expect(names.has("check_url_safety")).toBe(true);
    // generation / kanban / disk
    expect(names.has("image_generate")).toBe(true);
    expect(names.has("video_generate")).toBe(true);
    expect(names.has("kanban")).toBe(true);
    expect(names.has("disk_cleanup")).toBe(true);
  });
});
