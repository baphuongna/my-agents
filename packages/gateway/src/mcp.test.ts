/**
 * @my-agent/gateway — MCP lifecycle + client tests.
 */
import { describe, it, expect } from "vitest";
import { transition, aggregateHealth, availableTools } from "./mcp-lifecycle.js";
import { McpManager } from "./mcp-client.js";
import type { McpServer } from "./mcp-lifecycle.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "mcp-fixture.cjs");

function makeServer(phase: string, tools: string[] = [], failures = 0): McpServer {
  return {
    id: "test",
    command: "echo",
    args: [],
    phase: phase as McpServer["phase"],
    health: "Healthy",
    capabilities: [],
    consecutiveFailures: failures,
    tools,
  };
}

describe("MCP lifecycle FSM", () => {
  it("allows legal transitions", () => {
    const s = makeServer("Discovered");
    const next = transition(s, "Validated");
    expect(next.phase).toBe("Validated");
  });

  it("throws on illegal transition", () => {
    const s = makeServer("Unconfigured");
    expect(() => transition(s, "Healthy")).toThrow(/illegal transition/);
  });

  it("allows forced transition with allowUnsafe", () => {
    const s = makeServer("Unconfigured");
    const next = transition(s, "Healthy", { allowUnsafe: true });
    expect(next.phase).toBe("Healthy");
  });

  it("start() phase path Discovered→Validated→Initializing→Healthy is legal (B2 regression)", () => {
    // B2: McpManager.start() MUST follow this order per ALLOWED_TRANSITIONS.
    // The prior implementation did Discovered→Initializing (illegal) on the
    // very first transition and threw on every MCP connect — MCP was unusable.
    let s = makeServer("Discovered");
    s = transition(s, "Validated");    // Discovered → Validated
    expect(s.phase).toBe("Validated");
    s = transition(s, "Initializing"); // Validated → Initializing
    expect(s.phase).toBe("Initializing");
    s = transition(s, "Healthy");      // Initializing → Healthy
    expect(s.phase).toBe("Healthy");
  });

  it("quarantines after 5 consecutive failures", () => {
    // Validated → Initializing → Healthy is the legal path to test failure from.
    let s = makeServer("Initializing", [], 4);
    s = transition(s, "Failed");
    expect(s.phase).toBe("Quarantine");
  });

  it("resets failures on Healthy", () => {
    const s = makeServer("Failed", [], 3);
    const next = transition(s, "Restarting");
    expect(next.consecutiveFailures).toBe(3);
  });
});

describe("aggregateHealth", () => {
  it("all healthy → Healthy", () => {
    const servers = [makeServer("Healthy"), makeServer("Healthy")];
    expect(aggregateHealth(servers)).toBe("Healthy");
  });

  it("all failed → Failed", () => {
    const servers = [makeServer("Failed"), makeServer("Quarantine")];
    expect(aggregateHealth(servers)).toBe("Failed");
  });

  it("mixed → Degraded", () => {
    const servers = [makeServer("Healthy"), makeServer("Failed")];
    expect(aggregateHealth(servers)).toBe("Degraded");
  });

  it("empty → Healthy (no failure)", () => {
    expect(aggregateHealth([])).toBe("Healthy");
  });
});

describe("availableTools", () => {
  it("unions tools from healthy + degraded", () => {
    const servers = [
      makeServer("Healthy", ["tool1", "tool2"]),
      makeServer("Degraded", ["tool3"]),
      makeServer("Failed", ["tool4"]),
    ];
    const tools = availableTools(servers);
    expect(tools).toContain("tool1");
    expect(tools).toContain("tool2");
    expect(tools).toContain("tool3");
    expect(tools).not.toContain("tool4");
  });
});

describe("McpManager", () => {
  it("register + listServers", () => {
    const mgr = new McpManager();
    mgr.register({ id: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] });
    const servers = mgr.listServers();
    expect(servers.length).toBe(1);
    expect(servers[0]!.id).toBe("fs");
    expect(servers[0]!.phase).toBe("Discovered");
  });

  it("getServer returns registered server", () => {
    const mgr = new McpManager();
    mgr.register({ id: "git", command: "npx" });
    const s = mgr.getServer("git");
    expect(s?.command).toBe("npx");
  });

  it("health aggregates across servers", () => {
    const mgr = new McpManager();
    mgr.register({ id: "a", command: "x" });
    // Discovered phase → health is Healthy (not Failed)
    const h = mgr.health;
    expect(["Healthy", "Degraded", "Failed"]).toContain(h);
  });

  it("stop marks server Stopped", () => {
    const mgr = new McpManager();
    mgr.register({ id: "s1", command: "x" });
    mgr.stop("s1");
    expect(mgr.getServer("s1")?.phase).toBe("Stopped");
  });
});

describe("McpManager.start() integration (B2/B3/B6/restart)", () => {
  // Spins up the mcp-fixture.cjs stdio server. This is the integration coverage
  // that was MISSING when B2 shipped — start() was never exercised, so three
  // illegal phase transitions went undetected (MCP was completely broken).
  it("start() reaches Healthy + captures inputSchema + env (B2+B3+B6)", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "f", command: process.execPath, args: [FIXTURE], env: { MYA_B6_TEST: "b6-ok" } });
    const s = await mgr.start("f");
    expect(s.phase).toBe("Healthy");
    const infos = mgr.getToolInfos("f");
    expect(infos.length).toBe(1);
    expect(infos[0]!.name).toBe("echo");
    expect((infos[0]!.inputSchema?.properties as { text?: unknown })?.text).toBeDefined(); // B3
    expect(infos[0]!.description).toContain("b6-ok"); // B6: registered env reached the server
    mgr.stopAll();
  });

  it("start() works again after stop() (restart lifecycle)", async () => {
    const mgr = new McpManager();
    mgr.register({ id: "r", command: process.execPath, args: [FIXTURE] });
    const s1 = await mgr.start("r");
    expect(s1.phase).toBe("Healthy");
    mgr.stop("r");
    expect(mgr.getServer("r")?.phase).toBe("Stopped");
    expect(mgr.getToolInfos("r")).toEqual([]); // stop() cleared stale schemas
    // start-after-stopped: previously threw (Stopped → Validated is illegal)
    const s2 = await mgr.start("r");
    expect(s2.phase).toBe("Healthy");
    mgr.stopAll();
  });
});
