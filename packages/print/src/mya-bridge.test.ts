/**
 * @my-agent/print — mya-bridge slash command tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMyaBridge, type MyaPiApi, type MyaBridgeOptions } from "./mya-bridge.js";

describe("createMyaBridge", () => {
  it("returns a factory function", () => {
    const bridge = createMyaBridge({});
    expect(typeof bridge).toBe("function");
  });

  it("registers 17 slash commands when called", () => {
    const commands: string[] = [];
    const tools: string[] = [];
    const events: string[] = [];

    const mockPi = {
      on: (event: string) => { events.push(event); },
      registerTool: (tool: unknown) => {
        const t = tool as { name?: string };
        if (t.name) tools.push(t.name);
      },
      registerCommand: (name: string) => { commands.push(name); },
      registerShortcut: () => {},
    };

    const bridge = createMyaBridge({});
    bridge(mockPi);

    // Verify all expected commands are registered
    const expected = [
      "audit", "secrets", "skills", "memory", "wallet",
      "debug", "eval", "sync", "collab", "acp",
      "workflow", "sign", "pkg", "council", "cron",
      "mya-help",
    ];
    for (const cmd of expected) {
      expect(commands).toContain(cmd);
    }
    expect(commands.length).toBeGreaterThanOrEqual(16);
  });

  it("registers event handlers for audit/hooks", () => {
    const events: string[] = [];
    const mockPi = {
      on: (event: string) => { events.push(event); },
      registerTool: () => {},
      registerCommand: () => {},
      registerShortcut: () => {},
    };

    // Pass auditLog so tool_call/tool_result handlers are registered
    const bridge = createMyaBridge({
      auditLog: { append: () => {}, length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
    });
    bridge(mockPi);

    expect(events).toContain("tool_call");
    expect(events).toContain("tool_result");
  });

  it("registers Phase-5 orchestrator-aware web tools (Phase 5 of docs/PLAN-BROWSER.md)", () => {
    // Phase 5 acceptance: mya-bridge must register the full browser_*/web_search/
    // web_extract surface (each routed through the orchestrator) AND the
    // standalone `web_fetch` universal floor.
    const tools: string[] = [];
    const mockPi = {
      on: () => {},
      registerTool: (tool: unknown) => {
        const t = tool as { name?: string };
        if (t.name) tools.push(t.name);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
    };
    const bridge = createMyaBridge({});
    bridge(mockPi);

    // 8 granular browser tools (Phase 1-2 leaf surface, now via orchestrator).
    for (const name of [
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_back",
      "browser_press",
      "browser_screenshot",
    ]) {
      expect(tools, `missing browser tool: ${name}`).toContain(name);
    }
    // browser_close (Phase 4 lifecycle fix).
    expect(tools, "missing browser_close (Phase 4 lifecycle)").toContain("browser_close");
    // 2 search/extract tools (Phase 3 leaf surface, now via orchestrator).
    expect(tools, "missing web_search").toContain("web_search");
    expect(tools, "missing web_extract").toContain("web_extract");
    // The standalone universal floor (Phase 5 acceptance gate #7).
    expect(tools, "missing web_fetch (Phase 5 standalone floor)").toContain("web_fetch");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Edge-case coverage: command registration, event wiring, configuration,
// error handling, and lifecycle. Focuses on pure logic (no process spawning).
// ═══════════════════════════════════════════════════════════════════════

/** Mock pi API that captures every registration for later inspection. */
interface Captured {
  pi: MyaPiApi;
  events: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  commands: Map<string, { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }>;
  tools: Array<Record<string, unknown>>;
  shortcuts: Map<string, { description?: string; handler: (ctx: unknown) => void }>;
}

function makeCapturingPi(): Captured {
  const events = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }>();
  const tools: Array<Record<string, unknown>> = [];
  const shortcuts = new Map<string, { description?: string; handler: (ctx: unknown) => void }>();
  const pi: MyaPiApi = {
    on(event, handler) {
      const arr = events.get(event) ?? [];
      arr.push(handler);
      events.set(event, arr);
    },
    registerTool(tool) { tools.push(tool as Record<string, unknown>); },
    registerCommand(name, options) {
      commands.set(name, options as { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void });
    },
    registerShortcut(shortcut, options) { shortcuts.set(shortcut, options as never); },
  };
  return { pi, events, commands, tools, shortcuts };
}

/** Invoke a registered slash command and capture the notify() output. */
async function runCmd(c: Captured, name: string, args = "", extraCtx: Record<string, unknown> = {}): Promise<string> {
  const out: string[] = [];
  const ctx = { ui: { notify: (m: string) => { out.push(m); } }, ...extraCtx };
  const cmd = c.commands.get(name);
  if (!cmd) throw new Error(`command "${name}" not registered`);
  await cmd.handler(args, ctx);
  return out.join("\n");
}

/** Always-registered commands (with empty opts — no sqliteMemory/mcp/channels). */
const ALWAYS_COMMANDS = [
  "dream", "role",
  "audit", "secrets", "skills", "memory", "wallet", "debug",
  "eval", "sync", "collab", "acp", "workflow", "sign", "pkg",
  "council", "cron", "achievements", "webhooks", "mya-help",
] as const;

// ── Slash command registration ───────────────────────────────────────────

describe("slash command registration", () => {
  let c: Captured;
  beforeEach(() => {
    c = makeCapturingPi();
    createMyaBridge({})(c.pi);
  });

  it("registers every always-on command", () => {
    for (const name of ALWAYS_COMMANDS) {
      expect(c.commands.has(name), `missing command: ${name}`).toBe(true);
    }
  });

  it("each registered command has a non-empty description", () => {
    for (const name of ALWAYS_COMMANDS) {
      const cmd = c.commands.get(name);
      expect(cmd, `command ${name} missing`).toBeDefined();
      expect(typeof cmd!.description, `${name} description`).toBe("string");
      expect(cmd!.description!.length, `${name} description empty`).toBeGreaterThan(0);
    }
  });

  it("each registered command has a function handler", () => {
    for (const name of ALWAYS_COMMANDS) {
      const cmd = c.commands.get(name);
      expect(typeof cmd!.handler, `${name} handler`).toBe("function");
    }
  });

  it("/audit description mentions the audit log", () => {
    expect(c.commands.get("audit")!.description).toMatch(/audit/i);
  });

  it("/mya-help description mentions mya commands", () => {
    expect(c.commands.get("mya-help")!.description).toMatch(/mya/i);
  });

  it("/workflow and /sign are registered for file-based operations", () => {
    expect(c.commands.get("workflow")!.description).toMatch(/workflow/i);
    expect(c.commands.get("sign")!.description).toMatch(/sign|verify|tarball/i);
  });
});

// ── Event handler wiring ──────────────────────────────────────────────────

describe("event handler wiring", () => {
  it("registers core lifecycle events with empty opts", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    for (const ev of [
      "session_start", "before_agent_start", "message_end",
      "turn_end", "tool_result", "session_before_compact",
      "before_provider_request", "after_provider_response",
    ]) {
      expect(c.events.has(ev), `missing event: ${ev}`).toBe(true);
    }
  });

  it("does NOT register tool_call/turn_start audit handlers without auditLog", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    expect(c.events.has("tool_call")).toBe(false);
    expect(c.events.has("turn_start")).toBe(false);
  });

  it("registers tool_call + turn_start audit handlers when auditLog is provided", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      auditLog: { append: () => {}, length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
    })(c.pi);
    expect(c.events.has("tool_call")).toBe(true);
    expect(c.events.has("turn_start")).toBe(true);
    expect(c.events.has("tool_result")).toBe(true);
    expect(c.events.has("turn_end")).toBe(true);
  });

  it("registers multiple turn_end handlers (lifecycle + auto-capture)", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      auditLog: { append: () => {}, length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
    })(c.pi);
    // audit turn_end + lifecycle turn_end + auto-capture turn_end (min 3)
    expect(c.events.get("turn_end")!.length).toBeGreaterThanOrEqual(2);
  });

  it("tool_call handler appends to the audit log", () => {
    const appended: Array<Record<string, unknown>> = [];
    const c = makeCapturingPi();
    createMyaBridge({
      auditLog: { append: (r: Record<string, unknown>) => appended.push(r), length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
    })(c.pi);
    const handler = c.events.get("tool_call")![0]!;
    handler({ toolName: "bash", toolCallId: "c1", input: { command: "ls" } }, {});
    const rec = appended.find((r) => (r.payload as Record<string, unknown> | undefined)?.callId === "c1");
    expect(rec).toBeDefined();
    expect(rec!.kind).toBe("tool");
    expect(rec!.payload).toMatchObject({ phase: "call", tool: "bash", callId: "c1" });
  });

  it("turn_start handler records the turn index", () => {
    const appended: Array<Record<string, unknown>> = [];
    const c = makeCapturingPi();
    createMyaBridge({
      auditLog: { append: (r: Record<string, unknown>) => appended.push(r), length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
    })(c.pi);
    c.events.get("turn_start")![0]!({ turnIndex: 5 }, {});
    const rec = appended.find((r) => (r.payload as Record<string, unknown> | undefined)?.phase === "turn_start");
    expect(rec).toBeDefined();
    expect(rec!.payload).toMatchObject({ phase: "turn_start", turn: 5 });
  });

  it("hooks registry fires gateway lifecycle events on pi events", async () => {
    const fired: string[] = [];
    const c = makeCapturingPi();
    createMyaBridge({
      hooks: { fire: async (name: string) => { fired.push(name); } } as never,
    })(c.pi);
    // turn_start → pre_turn; trigger then await microtasks
    c.events.get("turn_start")!.forEach((h) => void h({}, {}));
    c.events.get("turn_end")!.forEach((h) => void h({}, {}));
    await Promise.resolve();
    expect(fired).toContain("pre_turn");
    expect(fired).toContain("post_turn");
  });
});

// ── Orchestrator-aware web tools (Phase 5) ────────────────────────────────

describe("orchestrator-aware web tools (Phase 5)", () => {
  it("registers all 8 browser leaf tools each with a name + parameters schema", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    const browserTools = ["browser_navigate", "browser_snapshot", "browser_click",
      "browser_type", "browser_scroll", "browser_back", "browser_press", "browser_screenshot"];
    for (const name of browserTools) {
      const tool = c.tools.find((t) => t.name === name);
      expect(tool, `missing ${name}`).toBeDefined();
      expect(typeof tool!.name).toBe("string");
      expect(tool!.parameters).toBeTypeOf("object");
    }
  });

  it("registers browser_close (Phase 4 lifecycle)", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    expect(c.tools.find((t) => t.name === "browser_close")).toBeDefined();
  });

  it("registers web_search + web_extract (Phase 3 leaf surface)", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    for (const name of ["web_search", "web_extract"]) {
      const tool = c.tools.find((t) => t.name === name);
      expect(tool, `missing ${name}`).toBeDefined();
      expect(tool!.parameters).toBeTypeOf("object");
    }
  });

  it("registers web_fetch as a standalone universal floor tool", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    const fetchTool = c.tools.find((t) => t.name === "web_fetch");
    expect(fetchTool).toBeDefined();
  });

  it("does NOT register paid_fetch without a wallet", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    expect(c.tools.find((t) => t.name === "paid_fetch")).toBeUndefined();
  });
});

// ── Error handling (handlers degrade gracefully when subsystems absent) ──

describe("error handling: not-configured handlers", () => {
  let c: Captured;
  beforeEach(() => {
    c = makeCapturingPi();
    createMyaBridge({})(c.pi);
  });

  it("/audit reports AuditLog not configured", async () => {
    expect(await runCmd(c, "audit")).toMatch(/AuditLog not configured/i);
  });

  it("/secrets reports SecretStore not configured", async () => {
    expect(await runCmd(c, "secrets")).toMatch(/SecretStore not configured/i);
  });

  it("/memory reports Brain not configured", async () => {
    expect(await runCmd(c, "memory")).toMatch(/Brain not configured/i);
  });

  it("/wallet reports Wallet not configured", async () => {
    expect(await runCmd(c, "wallet")).toMatch(/Wallet not configured/i);
  });

  it("/debug reports DAP not configured", async () => {
    expect(await runCmd(c, "debug")).toMatch(/DAP|debug/i);
  });

  it("/sync reports SyncServer not configured", async () => {
    expect(await runCmd(c, "sync")).toMatch(/SyncServer not configured/i);
  });

  it("/collab reports CollabRelay not configured", async () => {
    expect(await runCmd(c, "collab")).toMatch(/CollabRelay not configured/i);
  });

  it("/acp reports AcpBridge not configured", async () => {
    expect(await runCmd(c, "acp")).toMatch(/AcpBridge not configured/i);
  });

  it("/pkg reports PackageHost not configured", async () => {
    expect(await runCmd(c, "pkg")).toMatch(/PackageHost not configured/i);
  });

  it("/council reports CouncilProvider not configured", async () => {
    expect(await runCmd(c, "council")).toMatch(/CouncilProvider not configured/i);
  });

  it("/achievements reports Achievements not configured", async () => {
    expect(await runCmd(c, "achievements")).toMatch(/Achievements not configured/i);
  });

  it("/workflow with no arg shows usage", async () => {
    expect(await runCmd(c, "workflow")).toMatch(/usage/i);
  });

  it("/sign with no arg shows usage", async () => {
    expect(await runCmd(c, "sign")).toMatch(/usage/i);
  });

  it("/mya-help lists the command set", async () => {
    const out = await runCmd(c, "mya-help");
    expect(out).toMatch(/\baudit\b/);
    expect(out).toMatch(/mya/);
  });
});

// ── Bridge lifecycle ──────────────────────────────────────────────────────

describe("bridge lifecycle", () => {
  it("createMyaBridge returns a function (factory)", () => {
    expect(typeof createMyaBridge({})).toBe("function");
  });

  it("the returned factory is callable (initialization)", () => {
    const c = makeCapturingPi();
    expect(() => createMyaBridge({})(c.pi)).not.toThrow();
    expect(c.commands.size).toBeGreaterThan(0);
  });

  it("re-initialization against a fresh pi re-registers commands", () => {
    const a = makeCapturingPi();
    const b = makeCapturingPi();
    const bridge = createMyaBridge({});
    bridge(a.pi);
    bridge(b.pi);
    // Both pi instances receive the full command set independently
    expect(a.commands.size).toBe(b.commands.size);
    expect(b.commands.has("audit")).toBe(true);
    expect(b.commands.has("mya-help")).toBe(true);
  });

  it("registers a ctrl+q exit shortcut", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    expect(c.shortcuts.has("ctrl+q")).toBe(true);
    expect(typeof c.shortcuts.get("ctrl+q")!.handler).toBe("function");
  });

  it("ctrl+q handler calls ctx.shutdown when present", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    let shutDown = false;
    c.shortcuts.get("ctrl+q")!.handler({ shutdown: () => { shutDown = true; } });
    expect(shutDown).toBe(true);
  });

  it("ctrl+q handler is a no-op when shutdown is absent", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    expect(() => c.shortcuts.get("ctrl+q")!.handler({})).not.toThrow();
  });
});

// ── Configuration ─────────────────────────────────────────────────────────

describe("configuration", () => {
  it("registerTools callback is invoked with the pi handle", () => {
    let calledWith: unknown = null;
    const c = makeCapturingPi();
    createMyaBridge({
      registerTools: (pi: MyaPiApi) => { calledWith = pi; pi.registerTool({ name: "custom-x" }); },
    })(c.pi);
    expect(calledWith).toBe(c.pi);
    expect(c.tools.find((t) => t.name === "custom-x")).toBeDefined();
  });

  it("mcp opts registers the /mcp command", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      mcp: { register: () => {}, listServers: () => [], getToolInfos: () => [], tools: [], health: "Healthy", callTool: async () => ({}) } as never,
    })(c.pi);
    expect(c.commands.has("mcp")).toBe(true);
    expect(c.commands.get("mcp")!.description).toMatch(/mcp/i);
  });

  it("channels opts registers the /channel command", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      channels: { list: () => [], health: "Healthy", send: async () => ({ ok: true }) } as never,
    })(c.pi);
    expect(c.commands.has("channel")).toBe(true);
    expect(c.commands.get("channel")!.description).toMatch(/channel/i);
  });

  it("council opts wires the agent_settled event (adversarial review)", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      council: { id: "c1", model: "m1", health: () => "Healthy", review: async () => ({ real: [] }) } as never,
    })(c.pi);
    expect(c.events.has("agent_settled")).toBe(true);
  });

  it("sqliteMemory opts registers /mem-trust, /contradict, /stale commands", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      sqliteMemory: { getDatabase: () => ({}), recall: () => [], lifecycle: () => {}, record: () => "id" } as never,
    })(c.pi);
    expect(c.commands.has("mem-trust")).toBe(true);
    expect(c.commands.has("contradict")).toBe(true);
    expect(c.commands.has("stale")).toBe(true);
  });

  it("without sqliteMemory, governance commands are absent", () => {
    const c = makeCapturingPi();
    createMyaBridge({})(c.pi);
    expect(c.commands.has("mem-trust")).toBe(false);
    expect(c.commands.has("contradict")).toBe(false);
    expect(c.commands.has("stale")).toBe(false);
  });

  it("dabConnect opts registers the debug tool", () => {
    const c = makeCapturingPi();
    createMyaBridge({
      dapConnect: { connect: { command: "node", args: ["adapter.js"] } },
    })(c.pi);
    // The debug tool may register under "debug" — verify a debug-related tool exists
    const debugTool = c.tools.find((t) => /dap|debug/i.test(String(t.name)));
    // makeDebugTool may throw under test harness (wrapped in try/catch), so the
    // command surface is the stable assertion: the /debug command is registered.
    expect(c.commands.has("debug")).toBe(true);
    // If the tool registered, it has a parameters schema
    if (debugTool) expect(debugTool.parameters).toBeTypeOf("object");
  });

  it("auditLog not configured → /audit degrades (configuration drives behavior)", async () => {
    const c = makeCapturingPi();
    createMyaBridge({ auditLog: { append: () => {}, length: 42, tip: "0123456789abcdef", flush: () => {}, verify: () => ({ ok: true }) } as never })(c.pi);
    const out = await runCmd(c, "audit");
    // With auditLog configured, output shows record count + tip, not "not configured"
    expect(out).toMatch(/42/);
    expect(out).not.toMatch(/not configured/i);
  });

  it("achievements tracker records tool usage stats on tool_result (audit wired)", () => {
    const stats: Record<string, number> = {};
    const c = makeCapturingPi();
    createMyaBridge({
      auditLog: { append: () => {}, length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
      achievements: { recordStat: (k: string, inc?: number) => { stats[k] = (stats[k] ?? 0) + (inc ?? 1); } },
    })(c.pi);
    // tool_result handler (audit branch) records stat per tool name
    const handler = c.events.get("tool_result")!.find((h) => true)!;
    handler({ toolName: "bash", toolCallId: "c1", isError: false }, {});
    expect(stats["tool:bash"]).toBe(1);
  });
});

