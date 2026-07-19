import { describe, it, expect, vi } from "vitest";

// Force the engine resolver "unavailable" so the action tools hit their
// engine-unavailable error path. Regression for B1/B2 (copy-paste err() callId):
// browserBackTool must report "browser_back", browserScreenshotTool must report
// "browser_screenshot" — NOT "browser_snapshot" (the original copy-paste bug).
vi.mock("../engine-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine-resolver.js")>();
  return {
    ...actual,
    resolveBrowserEngine: () => ({
      unavailable: true,
      reason: "no engine (forced by test)",
    }),
  };
});

import { browserBackTool, browserScreenshotTool, browserNavigateTool } from "../index.js";

describe("engine-unavailable err() callId (B1/B2 regression)", () => {
  it("browser_back reports its own callId (not browser_snapshot)", async () => {
    const r = await browserBackTool.run({ taskId: "b1-callid" }, undefined as never);
    expect(r.ok).toBe(false);
    expect(r.callId).toBe("browser_back");
    expect(String(r.error)).toMatch(/no browser engine available/);
  });

  it("browser_screenshot reports its own callId (not browser_snapshot)", async () => {
    const r = await browserScreenshotTool.run({ taskId: "b2-callid" }, undefined as never);
    expect(r.ok).toBe(false);
    expect(r.callId).toBe("browser_screenshot");
    expect(String(r.error)).toMatch(/no browser engine available/);
  });

  it("browser_navigate blocks a blocklisted host (operator deny-list, G2)", async () => {
    process.env.MYA_WEB_BLOCKLIST = "blocked.test";
    try {
      // The guard (checkUrlAsync) blocks BEFORE engine resolution, so the
      // mocked unavailable engine is never consulted here.
      const r = await browserNavigateTool.run(
        { url: "https://blocked.test/x", taskId: "bl-nav" },
        undefined as never,
      );
      expect(r.ok).toBe(false);
      expect(String(r.error)).toMatch(/blocklist/);
    } finally {
      delete process.env.MYA_WEB_BLOCKLIST;
    }
  });
});
