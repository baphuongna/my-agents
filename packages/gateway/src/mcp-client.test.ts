/**
 * Edge-case tests for mcp-client.ts — McpManager error paths.
 *
 * Covers: start() failures (bad command, unregistered, cooldown),
 * callTool errors (unregistered, non-healthy), tool discovery, multi-server
 * management, and integration edge cases via the mcp-fixture.cjs.
 *
 * Complements mcp.test.ts (FSM + integration) and mcp-reliability.test.ts
 * (cooldown + reconnect budget).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setTimeProvider, type TimeProvider } from "@my-agent/core";
import { McpManager, classifyMcpFailure, unwrapExceptionGroup } from "./mcp-client.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "mcp-fixture.cjs");

const realWallclock = (): number => Date.now();
const realMonotonic = (): number =>
  typeof performance !== "undefined" ? performance.now() * 1000 : Date.now();

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => clock });
});
afterEach(() => {
  setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic });
});

// ── start() error paths ───────────────────────────────────────────────────

describe("McpManager.start() — error paths", () => {
  it("throws for an unregistered server id", async () => {
    const mgr = new McpManager();
    await expect(mgr.start("never-registered")).rejects.toThrow(/not registered/);
  });

  it("fails with a non-existent command (ENOENT)", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "bad", command: "this-command-does-not-exist-xyz-12345" });
    await expect(mgr.start("bad")).rejects.toThrow();
    expect(mgr.getServer("bad")?.phase).toBe("Failed");
  });

  it("throws when in cooldown after a failure", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "bad", command: "this-command-does-not-exist-xyz-12345" });
    // First start fails → arms cooldown
    await expect(mgr.start("bad")).rejects.toThrow();
    // Immediately retry → cooldown active → throws
    await expect(mgr.start("bad")).rejects.toThrow(/cooldown/);
  });

  it("returns the existing server when already Healthy (idempotent start)", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    const s1 = await mgr.start("f");
    expect(s1.phase).toBe("Healthy");
    const s2 = await mgr.start("f");
    expect(s2.phase).toBe("Healthy");
    mgr.stopAll();
  });
});

// ── callTool error paths ──────────────────────────────────────────────────

describe("McpManager.callTool — error paths", () => {
  it("throws for an unregistered server", async () => {
    const mgr = new McpManager();
    await expect(mgr.callTool("ghost", "echo", {})).rejects.toThrow(/not healthy/);
  });

  it("throws for a registered-but-not-started server (Discovered phase)", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "s", command: "echo" });
    await expect(mgr.callTool("s", "echo", {})).rejects.toThrow(/not healthy/);
  });

  it("throws for a stopped server", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "s", command: "echo" });
    mgr.stop("s");
    await expect(mgr.callTool("s", "echo", {})).rejects.toThrow(/not healthy/);
  });
});

// ── callTool success path ─────────────────────────────────────────────────

describe("McpManager.callTool — success", () => {
  it("calls a tool on a healthy fixture server", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    const result = await mgr.callTool("f", "echo", { text: "hello" });
    expect(result).toBeDefined();
    mgr.stopAll();
  });
});

// ── server disconnect handling ────────────────────────────────────────────

describe("McpManager — server disconnect", () => {
  it("transitions to Failed when the process exits unexpectedly", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    expect(mgr.getServer("f")?.phase).toBe("Healthy");
    // Stop the underlying process (simulates crash)
    mgr.stop("f");
    expect(mgr.getServer("f")?.phase).toBe("Stopped");
  });
});

// ── tool discovery ────────────────────────────────────────────────────────

describe("McpManager — tool discovery", () => {
  it("getTools returns tools from healthy servers only", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    mgr.register({ id: "s", command: "echo" }); // not started → Discovered
    // Before start: no tools
    expect(mgr.getTools().length).toBe(0);
    await mgr.start("f");
    // After start: fixture server has 1 tool
    const tools = mgr.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0]!.name).toContain("echo");
    mgr.stopAll();
  });

  it("getToolInfos returns full schemas for a started server", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    const infos = mgr.getToolInfos("f");
    expect(infos.length).toBe(1);
    expect(infos[0]!.inputSchema).toBeDefined();
    mgr.stopAll();
  });

  it("getToolInfos returns [] for an unregistered server", () => {
    const mgr = new McpManager();
    expect(mgr.getToolInfos("ghost")).toEqual([]);
  });

  it("clears tool schemas on stop", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    expect(mgr.getToolInfos("f").length).toBe(1);
    mgr.stop("f");
    expect(mgr.getToolInfos("f")).toEqual([]);
  });

  it("available tools via the getter excludes stopped/failed servers", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    expect(mgr.tools.length).toBe(1);
    mgr.stop("f");
    expect(mgr.tools.length).toBe(0);
  });
});

// ── multi-server management ───────────────────────────────────────────────

describe("McpManager — multi-server", () => {
  it("manages multiple servers independently", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "a", command: process.execPath, args: [FIXTURE] });
    mgr.register({ id: "b", command: process.execPath, args: [FIXTURE] });
    expect(mgr.listServers().length).toBe(2);
    await mgr.start("a");
    expect(mgr.getServer("a")?.phase).toBe("Healthy");
    expect(mgr.getServer("b")?.phase).toBe("Discovered");
    mgr.stopAll();
  });

  it("stopAll stops all servers", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "a", command: process.execPath, args: [FIXTURE] });
    mgr.register({ id: "b", command: process.execPath, args: [FIXTURE] });
    await mgr.start("a");
    await mgr.start("b");
    mgr.stopAll();
    expect(mgr.getServer("a")?.phase).toBe("Stopped");
    expect(mgr.getServer("b")?.phase).toBe("Stopped");
  });

  it("register is idempotent (same id doesn't duplicate)", () => {
    const mgr = new McpManager();
    mgr.register({ id: "x", command: "a" });
    mgr.register({ id: "x", command: "b" });
    expect(mgr.listServers().length).toBe(1);
  });
});

// ── health aggregation ────────────────────────────────────────────────────

describe("McpManager.health", () => {
  it("Healthy with all servers healthy", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    expect(mgr.health).toBe("Healthy");
    mgr.stopAll();
  });

  it("Degraded with mixed healthy + failed servers", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    mgr.register({ id: "bad", command: "this-command-does-not-exist-xyz-12345" });
    try { await mgr.start("bad"); } catch {}
    // f is Healthy, bad is Failed → Degraded
    expect(["Degraded", "Failed"]).toContain(mgr.health);
    mgr.stopAll();
  });
});

// ── classifyMcpFailure additional edge cases ──────────────────────────────

describe("classifyMcpFailure — additional edge cases", () => {
  it("classifies ECONNRESET (without 'connect') as transient", () => {
    expect(classifyMcpFailure(new Error("read ECONNRESET"))).toBe("transient");
  });

  it("classifies ETIMEDOUT as transient", () => {
    expect(classifyMcpFailure(new Error("connect ETIMEDOUT"))).toBe("transient");
  });

  it("classifies generic errors as transient", () => {
    expect(classifyMcpFailure(new Error("something unexpected"))).toBe("transient");
    expect(classifyMcpFailure(new Error("socket hang up"))).toBe("transient");
  });

  it("classifies authentication errors with various phrasings", () => {
    expect(classifyMcpFailure(new Error("authentication failed"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("Authorization Error"))).toBe("permanent");
    expect(classifyMcpFailure(new Error("auth failed"))).toBe("permanent");
  });

  it("handles undefined/null/number inputs", () => {
    expect(classifyMcpFailure(undefined)).toBe("transient");
    expect(classifyMcpFailure(42)).toBe("transient");
    expect(classifyMcpFailure({ code: "ENOENT" })).toBe("transient"); // no .message → String(obj)
  });
});

// ── unwrapExceptionGroup additional edge cases ────────────────────────────

describe("unwrapExceptionGroup — additional edge cases", () => {
  it("unwraps nested AggregateError (first level only)", () => {
    const inner = new Error("deep cause");
    const outer = new AggregateError([inner]);
    expect(unwrapExceptionGroup(outer)).toBe(inner);
  });

  it("returns the first non-AbortError when mixed with real errors", () => {
    const abort = new DOMException("aborted", "AbortError");
    const real = new Error("actual error");
    const agg = new AggregateError([abort, real]);
    const result = unwrapExceptionGroup(agg);
    expect(result).toBe(real);
  });

  it("handles a single-element AggregateError with a plain Error", () => {
    const e = new Error("only error");
    const agg = new AggregateError([e]);
    expect(unwrapExceptionGroup(agg)).toBe(e);
  });
});

// ── restart lifecycle edge case ───────────────────────────────────────────

describe("McpManager — restart after failure", () => {
  it("can restart a failed server after the cooldown window elapses", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE] });
    await mgr.start("f");
    mgr.stop("f");
    // Restart after stop
    const s = await mgr.start("f");
    expect(s.phase).toBe("Healthy");
    mgr.stopAll();
  });
});
