import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("[unit] view backends detect()", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["TMUX", "ZELLIJ", "STY", "CMUX"]) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("tmux detect: TMUX set → true", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
    const { tmuxBackend } = await import("./tmux.js");
    expect(tmuxBackend.detect()).toBe(true);
  });

  it("tmux detect: TMUX unset → false", async () => {
    const { tmuxBackend } = await import("./tmux.js");
    expect(tmuxBackend.detect()).toBe(false);
  });

  it("zellij detect: ZELLIJ set → true", async () => {
    process.env.ZELLIJ = "1";
    const { zellijBackend } = await import("./zellij.js");
    expect(zellijBackend.detect()).toBe(true);
  });

  it("zellij detect: ZELLIJ unset → false", async () => {
    const { zellijBackend } = await import("./zellij.js");
    expect(zellijBackend.detect()).toBe(false);
  });

  it("screen detect: STY set → true", async () => {
    process.env.STY = "12345.pts-0.host";
    const { screenBackend } = await import("./screen.js");
    expect(screenBackend.detect()).toBe(true);
  });

  it("screen detect: STY unset → false", async () => {
    const { screenBackend } = await import("./screen.js");
    expect(screenBackend.detect()).toBe(false);
  });

  it("cmux detect: CMUX set but no binary → false (commandExists check)", async () => {
    process.env.CMUX = "1";
    const { cmuxBackend } = await import("./cmux.js");
    // cmux detect requires BOTH $CMUX + binary exists — binary not installed in test env
    expect(cmuxBackend.detect()).toBe(false);
  });

  it("standalone detect: always true", async () => {
    const { standaloneBackend } = await import("./standalone.js");
    expect(standaloneBackend.detect()).toBe(true);
  });
});
