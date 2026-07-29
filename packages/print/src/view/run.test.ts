/**
 * runDetached — the detached-spawn helper used by the standalone view backend.
 *
 * F8 regression guard: a missing terminal binary (ENOENT) emits an async
 * 'error' event. Without an error handler this crashes the parent mya process
 * (Unhandled 'error' event). The handler swallows it → runDetached returns a
 * pid + the process survives. This test verifies both (no sync throw + the
 * async error is handled, not unhandled).
 */
import { describe, it, expect } from "vitest";
import { runDetached } from "./run.js";

describe("[unit] runDetached (F8 — ENOENT must not crash the parent)", () => {
  it("returns a number + swallows the async ENOENT error (no unhandled 'error' event)", async () => {
    const pid = runDetached("nonexistent-binary-xyz-12345", []);
    expect(typeof pid).toBe("number");
    // Let the async 'error' (ENOENT) event fire + be swallowed by the handler.
    // If the handler were absent, vitest surfaces the unhandled 'error' as a
    // failure (process crash) — so this await is the real assertion.
    await new Promise((r) => setTimeout(r, 50));
  });
});
