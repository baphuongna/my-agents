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
const mockCloseRoleSubagentView = vi.hoisted(() => vi.fn());
const mockForgetViewHandle = vi.hoisted(() => vi.fn());
const mockWaitRoleSubagent = vi.hoisted(() => vi.fn());

vi.mock("./role-subagent-spawn.js", () => ({
  spawnRoleSubagent: vi.fn(),
  focusRoleSubagentView: mockFocusRoleSubagentView,
  closeRoleSubagentView: mockCloseRoleSubagentView,
  forgetViewHandle: mockForgetViewHandle,
  waitRoleSubagent: mockWaitRoleSubagent,
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
      status: "working",
      role: "default",
      subagents: [
        {
          id: "child-1",
          goal: "refactor X",
          status: "working",
          depth: 1,
          role: "coder",
          task: "refactor X",
          lastActivity: Date.now(),
          messages: 3,
        },
        {
          id: "child-2",
          goal: "review PR",
          status: "idle",
          depth: 1,
          role: "reviewer",
          task: "review PR",
          lastActivity: Date.now(),
          messages: 1,
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
    expect(out).toContain("working");
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

  // ── Phase 2: task-status glyphs (working/done/failed/idle) ──────────────

  it("renders ● glyph for 'working' status", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "w1", busy: false, messages: 0, lastActivity: 0, status: "working", subagents: [] },
    ];
    expect(renderAgentTree(tree)).toContain("● w1");
  });

  it("renders ✓ glyph for 'done' status", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "d1", busy: false, messages: 0, lastActivity: 0, status: "done", subagents: [] },
    ];
    expect(renderAgentTree(tree)).toContain("✓ d1");
  });

  it("renders ✗ glyph for 'failed' status", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "f1", busy: false, messages: 0, lastActivity: 0, status: "failed", subagents: [] },
    ];
    expect(renderAgentTree(tree)).toContain("✗ f1");
  });

  it("renders ○ glyph for 'idle' status", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "i1", busy: false, messages: 0, lastActivity: 0, status: "idle", subagents: [] },
    ];
    expect(renderAgentTree(tree)).toContain("○ i1");
  });

  it("falls back to busy-derived glyph when status is absent (backward compat)", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "b1", busy: true, messages: 0, lastActivity: 0, subagents: [] },
    ];
    const out = renderAgentTree(tree);
    expect(out).toContain("● b1");
    expect(out).toContain("busy");
  });

  // ── Phase 2: relative lastActivity ─────────────────────────────────────

  it("renders lastActivity as relative time", () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    const tree: AgentTreeNode[] = [
      { sessionId: "s1", busy: false, messages: 0, lastActivity: twoMinutesAgo, subagents: [] },
    ];
    expect(renderAgentTree(tree)).toContain("2m ago");
  });

  it("omits relative time when lastActivity is 0", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "s1", busy: false, messages: 0, lastActivity: 0, subagents: [] },
    ];
    expect(renderAgentTree(tree)).not.toContain("ago");
  });

  // ── Phase 2: subagent message counts ───────────────────────────────────

  it("renders message count for subagents when present", () => {
    const out = renderAgentTree(makeTree());
    expect(out).toContain("child-1");
    // child-1 has messages: 3
    expect(out).toMatch(/child-1.*3 msgs/);
    expect(out).toMatch(/child-2.*1 msgs/);
  });

  // ── Phase 3: structured result rendering (summary + keyOutputs) ──────────

  it("shows summary for done agents that have one", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "done-1", busy: false, messages: 2, lastActivity: 0, status: "done", summary: "Refactored the auth module", subagents: [] },
    ];
    const out = renderAgentTree(tree);
    expect(out).toContain("Refactored the auth module");
  });

  it("shows keyOutputs count for done agents", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "done-2", busy: false, messages: 1, lastActivity: 0, status: "done", summary: "Done", keyOutputs: ["a.ts", "b.ts", "c.ts"], subagents: [] },
    ];
    const out = renderAgentTree(tree);
    expect(out).toContain("3 outputs");
  });

  it("shows up to 2 keyOutputs items inline when ≤2", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "done-3", busy: false, messages: 1, lastActivity: 0, status: "done", summary: "Done", keyOutputs: ["only-file.ts"], subagents: [] },
    ];
    const out = renderAgentTree(tree);
    expect(out).toContain("only-file.ts");
  });

  it("shows summary for done subagents", () => {
    const tree: AgentTreeNode[] = [
      {
        sessionId: "main-x", busy: false, messages: 0, lastActivity: 0, status: "working", subagents: [
          { id: "sub-done", goal: "test", status: "done", depth: 1, summary: "Subagent finished", keyOutputs: ["x.ts"], lastActivity: 0 },
        ],
      },
    ];
    const out = renderAgentTree(tree);
    expect(out).toContain("Subagent finished");
  });

  it("agents without summary render normally (backward compat)", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "plain-1", busy: false, messages: 0, lastActivity: 0, status: "done", subagents: [] },
    ];
    const out = renderAgentTree(tree);
    // No extra indented result lines
    expect(out).not.toContain("↳");
    expect(out).toContain("✓ plain-1");
  });

  it("does not show summary for working agents (only done)", () => {
    const tree: AgentTreeNode[] = [
      { sessionId: "work-1", busy: true, messages: 3, lastActivity: 0, status: "working", summary: "Should not appear", subagents: [] },
    ];
    const out = renderAgentTree(tree);
    expect(out).not.toContain("Should not appear");
  });

  it("truncates long summary to ~80 chars", () => {
    const longSummary = "S".repeat(120);
    const tree: AgentTreeNode[] = [
      { sessionId: "done-long", busy: false, messages: 0, lastActivity: 0, status: "done", summary: longSummary, subagents: [] },
    ];
    const out = renderAgentTree(tree);
    // Should contain the truncated version (77 chars + "...")
    expect(out).toContain("S".repeat(77) + "...");
    // Should NOT contain the full 120-char string
    expect(out).not.toContain("S".repeat(120));
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
    mockCloseRoleSubagentView.mockReset();
    mockForgetViewHandle.mockReset();
    mockWaitRoleSubagent.mockReset();
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
    expect(mockCloseRoleSubagentView).toHaveBeenCalledWith("s-target");
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

  it("kill still calls forgetViewHandle when closeRoleSubagentView rejects (NEW-4)", async () => {
    // kill POST succeeds, but closeRoleSubagentView throws.
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200 }) as Response);
    mockCloseRoleSubagentView.mockRejectedValue(new Error("view backend gone"));

    const out = await runCmd(commands, "agents", "kill s-x");
    expect(out).toMatch(/killed/i);
    // forgetViewHandle MUST still be called despite the close rejection.
    expect(mockForgetViewHandle).toHaveBeenCalledWith("s-x");
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

  // ── /agents wait <id> action ──────────────────────────────────────────

  it("wait <id> calls waitRoleSubagent and returns done result with summary", async () => {
    mockWaitRoleSubagent.mockResolvedValue({
      status: "done",
      summary: "All tests pass",
      keyOutputs: ["file1.ts", "file2.ts"],
    });

    const out = await runCmd(commands, "agents", "wait s-target");
    expect(mockWaitRoleSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s-target" }),
    );
    expect(out).toContain("done");
    expect(out).toContain("All tests pass");
    expect(out).toContain("file1.ts");
  });

  it("wait <id> returns failed status with summary", async () => {
    mockWaitRoleSubagent.mockResolvedValue({
      status: "failed",
      summary: "Build error occurred",
    });

    const out = await runCmd(commands, "agents", "wait s-failed");
    expect(out).toContain("failed");
    expect(out).toContain("Build error occurred");
  });

  it("wait <id> returns timeout status", async () => {
    mockWaitRoleSubagent.mockResolvedValue({
      status: "timeout",
    });

    const out = await runCmd(commands, "agents", "wait s-stuck");
    expect(out).toMatch(/timeout/i);
  });

  it("wait <id> returns not_found status", async () => {
    mockWaitRoleSubagent.mockResolvedValue({
      status: "not_found",
    });

    const out = await runCmd(commands, "agents", "wait s-missing");
    expect(out).toContain("not_found");
  });
});
