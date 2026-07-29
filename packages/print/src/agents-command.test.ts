/**
 * /agents slash command + renderAgentTree tests.
 *
 * Tests:
 *  - renderAgentTree: tree rendering format from PoolTreeNode-like data.
 *  - /agents command: kill action posts to /pool/kill/<id>, open action calls
 *    focusRoleSubagentView, default action renders the tree.
 *  - /agents command: handles gateway unreachable gracefully.
 *
 * [unit]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderAgentTree, type AgentTreeNode } from "./mya-bridge.js";

// ── Mock the role-subagent-spawn module so /agents command can import it ──

const mockFocusRoleSubagentView = vi.hoisted(() => vi.fn());
const mockForgetViewHandle = vi.hoisted(() => vi.fn());

vi.mock("./role-subagent-spawn.js", () => ({
  spawnRoleSubagent: vi.fn(),
  focusRoleSubagentView: mockFocusRoleSubagentView,
  forgetViewHandle: mockForgetViewHandle,
}));

// Mock gw-auth to avoid reading real token files
vi.mock("./gw-auth.js", () => ({
  authHeaders: () => ({}),
  readGwToken: () => undefined,
  withAuth: (h: Record<string, string>) => h,
}));

import { createMyaBridge } from "./mya-bridge.js";

// ── Tree data helpers ────────────────────────────────────────────────────

function makeTree(): AgentTreeNode[] {
  return [
    {
      sessionId: "main-1",
      busy: true,
      messages: 5,
      lastActivity: Date.now(),
      role: "default",
      subagents: [
        {
          id: "child-1",
          goal: "refactor X",
          status: "busy",
          depth: 1,
          role: "coder",
          task: "refactor X",
        },
        {
          id: "child-2",
          goal: "review PR",
          status: "idle",
          depth: 1,
          role: "reviewer",
          task: "review PR",
        },
      ],
    },
  ];
}

// ══════════════════════════════════════════════════════════════════════════
// renderAgentTree (pure function)
// ══════════════════════════════════════════════════════════════════════════

describe("[unit] renderAgentTree", () => {
  it("renders an empty tree message when no sessions", () => {
    expect(renderAgentTree([])).toMatch(/No active sessions/i);
  });

  it("renders the main session with role + status", () => {
    const out = renderAgentTree(makeTree());
    expect(out).toContain("[agents] Agent tree:");
    expect(out).toContain("main-1");
    expect(out).toContain("(default)");
    expect(out).toContain("busy");
  });

  it("renders subagents nested under the main session", () => {
    const out = renderAgentTree(makeTree());
    expect(out).toContain("child-1");
    expect(out).toContain("(coder)");
    expect(out).toContain("child-2");
    expect(out).toContain("(reviewer)");
  });

  it("shows task text for role-subagents", () => {
    const out = renderAgentTree(makeTree());
    expect(out).toContain("refactor X");
    expect(out).toContain("review PR");
  });

  it("includes action hints at the bottom", () => {
    const out = renderAgentTree(makeTree());
    expect(out).toContain("/agents open <id>");
    expect(out).toContain("/agents kill <id>");
  });

  it("truncates long task text to 60 chars", () => {
    const longTask = "A".repeat(100);
    const tree: AgentTreeNode[] = [
      {
        sessionId: "s1",
        busy: false,
        messages: 0,
        lastActivity: 0,
        subagents: [
          { id: "c1", goal: longTask, status: "idle", depth: 1, task: longTask },
        ],
      },
    ];
    const out = renderAgentTree(tree);
    // The task should be truncated (60 chars + quotes)
    expect(out).toContain(`"${"A".repeat(60)}"`);
    expect(out).not.toContain("A".repeat(61));
  });

  it("uses ● for busy and ○ for idle sessions", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "busy-s", busy: true, messages: 1, lastActivity: 0, subagents: [] },
      { sessionId: "idle-s", busy: false, messages: 0, lastActivity: 0, subagents: [] },
    ];
    const out = renderAgentTree(tree);
    expect(out).toContain("● busy-s");
    expect(out).toContain("○ idle-s");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// /agents slash command (integration with mocked gateway)
// ══════════════════════════════════════════════════════════════════════════

/** Minimal capturing pi for command testing. */
function makeCapturingPi() {
  const commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }>();
  const pi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }) {
      commands.set(name, options);
    },
    registerShortcut() {},
  };
  return { pi, commands };
}

/** Run a registered command and capture notify output. */
async function runCmd(
  commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> | void }>,
  name: string,
  args = "",
): Promise<string> {
  const out: string[] = [];
  const ctx = { ui: { notify: (m: string) => { out.push(m); } } };
  const cmd = commands.get(name);
  if (!cmd) throw new Error(`command "${name}" not registered`);
  await cmd.handler(args, ctx);
  return out.join("\n");
}

describe("[unit] /agents slash command", () => {
  let pi: ReturnType<typeof makeCapturingPi>["pi"];
  let commands: ReturnType<typeof makeCapturingPi>["commands"];

  beforeEach(() => {
    vi.unstubAllGlobals();
    mockFocusRoleSubagentView.mockReset();
    mockForgetViewHandle.mockReset();
    const c = makeCapturingPi();
    pi = c.pi;
    commands = c.commands;
    createMyaBridge({})(pi as never);
  });

  it("registers the /agents command", () => {
    expect(commands.has("agents")).toBe(true);
    expect(commands.get("agents")!.description).toMatch(/agents/i);
  });

  it("renders the tree when called with no args (gateway reachable)", async () => {
    vi.stubGlobal("fetch", async (url: string) => ({
      ok: true,
      json: async () => makeTree(),
    }) as Response);

    const out = await runCmd(commands, "agents");
    expect(out).toContain("Agent tree:");
    expect(out).toContain("main-1");
  });

  it("reports unreachable when gateway is down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    const out = await runCmd(commands, "agents");
    expect(out).toMatch(/unreachable|ECONNREFUSED/i);
  });

  it("kill <id> posts to /pool/kill/<id>", async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), method: init?.method ?? "GET" });
      return { ok: true, status: 200 } as Response;
    });

    const out = await runCmd(commands, "agents", "kill s-target");
    expect(fetchCalls.some((c) => c.url.includes("/pool/kill/s-target") && c.method === "POST")).toBe(true);
    expect(out).toMatch(/killed/i);
    expect(mockForgetViewHandle).toHaveBeenCalledWith("s-target");
  });

  it("kill reports failure on non-OK response", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 404,
    }) as Response);

    const out = await runCmd(commands, "agents", "kill missing");
    expect(out).toMatch(/failed/i);
  });

  it("open <id> calls focusRoleSubagentView", async () => {
    mockFocusRoleSubagentView.mockResolvedValue(true);

    const out = await runCmd(commands, "agents", "open s-123");
    expect(mockFocusRoleSubagentView).toHaveBeenCalledWith("s-123");
    expect(out).toMatch(/focused/i);
  });

  it("open <id> reports when no handle exists", async () => {
    mockFocusRoleSubagentView.mockResolvedValue(false);

    const out = await runCmd(commands, "agents", "open s-nohandle");
    expect(out).toMatch(/no view handle/i);
  });
});
