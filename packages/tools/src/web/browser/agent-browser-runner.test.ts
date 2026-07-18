/**
 * agent-browser-runner tests — buildCommandArgs validation (Gotcha #5).
 *
 * Tests the pure command-builder logic. runBrowserCommand end-to-end is
 * covered indirectly by the tool tests (with mocked execTempfile).
 *
 * vitest forks pool (per vitest.config.ts).
 */
import { describe, it, expect } from "vitest";
import { buildCommandArgs, type RunBrowserOptions } from "./agent-browser-runner.js";

const mockSession = {
  sessionName: "mya-test",
  socketDir: "/tmp/mock-socket",
  env: {},
  taskId: "test",
};

describe("agent-browser-runner — buildCommandArgs", () => {
  // ── Session mode ───────────────────────────────────────────────────────

  it("builds --session command for local mode", () => {
    const result = buildCommandArgs("open", ["https://example.com"], { session: mockSession });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toContain("--session");
      expect(result.args).toContain("mya-test");
      expect(result.args).toContain("--json");
      expect(result.args).toContain("open");
      expect(result.args).toContain("https://example.com");
    }
  });

  it("builds --cdp command for cloud mode", () => {
    const opts: RunBrowserOptions = { cdpUrl: "ws://browserbase.example/session" };
    const result = buildCommandArgs("open", ["https://example.com"], opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toContain("--cdp");
      expect(result.args).toContain("ws://browserbase.example/session");
      expect(result.args).not.toContain("--session");
    }
  });

  // ── Gotcha #5: --session XOR --cdp ─────────────────────────────────────

  it("rejects both --session and --cdp (Gotcha #5)", () => {
    const opts: RunBrowserOptions = {
      session: mockSession,
      cdpUrl: "ws://cloud.example",
    };
    const result = buildCommandArgs("open", [], opts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("mutually exclusive");
    }
  });

  it("rejects neither --session nor --cdp", () => {
    const result = buildCommandArgs("open", [], {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("must be specified");
    }
  });

  // ── Engine flag ─────────────────────────────────────────────────────────

  it("includes --engine when specified", () => {
    const result = buildCommandArgs("snapshot", ["-c"], {
      session: mockSession,
      engine: "lightpanda",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toContain("--engine");
      expect(result.args).toContain("lightpanda");
    }
  });

  it("omits --engine when not specified", () => {
    const result = buildCommandArgs("snapshot", ["-c"], { session: mockSession });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).not.toContain("--engine");
    }
  });

  // ── Command + args ──────────────────────────────────────────────────────

  it("passes through command and positional args", () => {
    const result = buildCommandArgs("type", ["@e5", "hello world"], { session: mockSession });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toContain("type");
      expect(result.args).toContain("@e5");
      expect(result.args).toContain("hello world");
    }
  });

  it("always includes --json", () => {
    const result = buildCommandArgs("back", [], { session: mockSession });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toContain("--json");
    }
  });
});
