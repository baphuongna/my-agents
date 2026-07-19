import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The shared auth helper cron-cli / launcher / channels-cli use to read the
 * gateway token. Regression guard: a prior 0C commit taught only cron-cli to
 * send the token, breaking launcher (~22 calls) + channels-cli. This test pins
 * the shared helper so all three callers authenticate. */
describe("gw-auth shared helper (Phase 0C)", () => {
  let realHome: string | undefined;
  let dir: string;

  beforeEach(() => {
    realHome = process.env.HOME;
    dir = mkdtempSync(join(tmpdir(), "mya-gwauth-"));
    process.env.HOME = dir;
  });
  afterEach(() => {
    process.env.HOME = realHome;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("readGwToken returns undefined when no token file (gateway not running)", async () => {
    const { readGwToken } = await import("./gw-auth.js");
    expect(readGwToken()).toBeUndefined();
  });

  it("readGwToken returns the token when ~/.mya/agent/gw.token exists", async () => {
    const { readGwToken } = await import("./gw-auth.js");
    mkdirSync(join(dir, ".mya", "agent"), { recursive: true });
    writeFileSync(join(dir, ".mya", "agent", "gw.token"), "abc123secret\n");
    expect(readGwToken()).toBe("abc123secret"); // trimmed
  });

  it("authHeaders returns Bearer when token present, {} when absent", async () => {
    const { authHeaders } = await import("./gw-auth.js");
    expect(authHeaders()).toEqual({});
    mkdirSync(join(dir, ".mya", "agent"), { recursive: true });
    writeFileSync(join(dir, ".mya", "agent", "gw.token"), "tok");
    expect(authHeaders()).toEqual({ authorization: "Bearer tok" });
  });

  it("withAuth merges auth into existing headers", async () => {
    const { withAuth } = await import("./gw-auth.js");
    mkdirSync(join(dir, ".mya", "agent"), { recursive: true });
    writeFileSync(join(dir, ".mya", "agent", "gw.token"), "tok");
    expect(withAuth({ "content-type": "application/json" })).toEqual({
      "content-type": "application/json",
      authorization: "Bearer tok",
    });
  });
});
