import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Mock the engine-resolver to force "unavailable" so browser_navigate must
// degrade to the web_fetch floor. This is the regression for the user's
// "feature never dies" directive (PLAN-BROWSER.md §3.C).
vi.mock("../engine-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine-resolver.js")>();
  return {
    ...actual,
    // Force "unavailable" so browser_navigate must degrade to the web_fetch floor.
    resolveBrowserEngine: () => ({ unavailable: true, reason: "no engine (forced by test)" }),
  };
});
import { browserNavigateTool } from "../index.js";

describe("browser_navigate → web_fetch fallback floor", () => {
  it("degrades to web_fetch when no browser engine is available", async () => {
    const r = await browserNavigateTool.run({ url: "https://example.com/", taskId: "fb-test" }, undefined as never);
    expect(r.ok).toBe(true);
    const o = r.output as Record<string, unknown>;
    expect(o.engine).toBe("web_fetch_fallback");
    expect(o.degraded).toBe(true);
    // The floor must still return real page content (title + snapshot-as-markdown).
    expect(String(o.title)).toBe("Example Domain");
    expect(String(o.snapshot ?? "").length).toBeGreaterThan(0);
  });
});
