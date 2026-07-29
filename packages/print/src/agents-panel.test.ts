/**
 * agents-panel pure-function tests.
 *
 * Tests the pure rendering + key-handling logic of the `mya agents` live panel:
 *  - renderAgentsPanel: empty tree, tree with subagents, done/failed status glyphs.
 *  - handlePanelKey: arrow keys adjust sel, q sets quit, o/Enter=open, x=kill,
 *    r=refresh, unknown=none, Ctrl+C=quit, sel clamping.
 *  - flattenTree: tree-to-flat-list conversion.
 *
 * The full TUI takeover (runAgentsPanel) is [real]-tier — not unit-testable.
 *
 * [unit]
 */
import { describe, it, expect } from "vitest";
import {
  renderAgentsPanel,
  handlePanelKey,
  flattenTree,
  type PanelState,
} from "./agents-panel.js";
import type { AgentTreeNode } from "./mya-bridge.js";

// ── Tree data helpers ────────────────────────────────────────────────────

function makeEmptyTree(): AgentTreeNode[] {
  return [];
}

function makeTreeWithSubagents(): AgentTreeNode[] {
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
          messages: 3,
        },
        {
          id: "child-2",
          goal: "review PR",
          status: "idle",
          depth: 1,
          role: "reviewer",
          task: "review PR",
          messages: 1,
        },
      ],
    },
  ];
}

function makeDoneFailedTree(): AgentTreeNode[] {
  return [
    {
      sessionId: "s-done",
      busy: false,
      messages: 10,
      lastActivity: Date.now(),
      status: "done",
      role: "coder",
      task: "write tests",
      summary: "All tests written.",
      subagents: [
        {
          id: "child-failed",
          goal: "deploy",
          status: "failed",
          depth: 1,
          role: "deployer",
          task: "deploy app",
        },
      ],
    },
  ];
}

function makeState(sel = 0): PanelState {
  return { sel, quit: false };
}

// Strip ANSI escape sequences for plain-text assertions.
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ══════════════════════════════════════════════════════════════════════════
// flattenTree
// ══════════════════════════════════════════════════════════════════════════

describe("[unit] flattenTree", () => {
  it("returns empty array for empty tree", () => {
    expect(flattenTree(makeEmptyTree())).toEqual([]);
  });

  it("flattens main session + nested subagents into a flat list", () => {
    const items = flattenTree(makeTreeWithSubagents());
    expect(items).toHaveLength(3);
    expect(items[0]!.kind).toBe("main");
    expect(items[0]!.id).toBe("main-1");
    expect(items[1]!.kind).toBe("sub");
    expect(items[1]!.id).toBe("child-1");
    expect(items[2]!.kind).toBe("sub");
    expect(items[2]!.id).toBe("child-2");
  });

  it("preserves status and role metadata", () => {
    const items = flattenTree(makeTreeWithSubagents());
    expect(items[1]!.status).toBe("working");
    expect(items[1]!.role).toBe("coder");
    expect(items[2]!.status).toBe("idle");
    expect(items[2]!.role).toBe("reviewer");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// renderAgentsPanel
// ══════════════════════════════════════════════════════════════════════════

describe("[unit] renderAgentsPanel", () => {
  it("renders an empty-tree message when no sessions", () => {
    const lines = renderAgentsPanel(makeEmptyTree(), makeState());
    const plain = lines.map(stripAnsi).join("\n");
    expect(plain).toMatch(/No active agents/i);
  });

  it("renders a header with 'mya' and 'Agents Panel'", () => {
    const lines = renderAgentsPanel(makeEmptyTree(), makeState());
    const plain = lines.map(stripAnsi).join("\n");
    expect(plain).toContain("mya");
    expect(plain).toContain("Agents Panel");
  });

  it("renders a footer with key hints", () => {
    const lines = renderAgentsPanel(makeEmptyTree(), makeState());
    const plain = lines.map(stripAnsi).join("\n");
    expect(plain).toContain("open");
    expect(plain).toContain("kill");
    expect(plain).toContain("quit");
  });

  it("renders main sessions and nested subagents", () => {
    const lines = renderAgentsPanel(makeTreeWithSubagents(), makeState());
    const plain = lines.map(stripAnsi).join("\n");
    // main-1 has no task → label is the stripped sessionId ("main 1")
    expect(plain).toContain("main 1");
    // child nodes use their task as the label
    expect(plain).toContain("refactor X");
    expect(plain).toContain("review PR");
    // Subagents should be indented with the tree prefix
    expect(plain).toContain("└─");
  });

  it("renders role tags for nodes with a role", () => {
    const lines = renderAgentsPanel(makeTreeWithSubagents(), makeState());
    const plain = lines.map(stripAnsi).join("\n");
    expect(plain).toContain("(coder)");
    expect(plain).toContain("(reviewer)");
  });

  it("renders message counts for nodes with messages", () => {
    const lines = renderAgentsPanel(makeTreeWithSubagents(), makeState());
    const plain = lines.map(stripAnsi).join("\n");
    expect(plain).toContain("5m"); // main session
    expect(plain).toContain("3m"); // child-1
  });

  it("renders ● glyph (working status) with ANSI color", () => {
    const lines = renderAgentsPanel(makeTreeWithSubagents(), makeState());
    const raw = lines.join("\n");
    // The working node should contain the ● character (wrapped in ANSI codes)
    expect(raw).toContain("●");
  });

  it("renders ○ glyph (idle status) with ANSI color", () => {
    const lines = renderAgentsPanel(makeTreeWithSubagents(), makeState());
    const raw = lines.join("\n");
    expect(raw).toContain("○");
  });

  it("renders ✓ glyph for done status", () => {
    const lines = renderAgentsPanel(makeDoneFailedTree(), makeState());
    const raw = lines.join("\n");
    expect(raw).toContain("✓");
  });

  it("renders ✗ glyph for failed status", () => {
    const lines = renderAgentsPanel(makeDoneFailedTree(), makeState());
    const raw = lines.join("\n");
    expect(raw).toContain("✗");
  });

  it("highlights the selected item with the selection background", () => {
    const tree = makeTreeWithSubagents();
    // 3 items (main + 2 sub). Select item index 1 (child-1).
    const lines0 = renderAgentsPanel(tree, makeState(0));
    const lines1 = renderAgentsPanel(tree, makeState(1));

    // The selection background escape (\x1b[48;...) should appear exactly once
    const selEsc = "\x1b[48;2;58;58;74m";
    const count0 = lines0.join("\n").split(selEsc).length - 1;
    const count1 = lines1.join("\n").split(selEsc).length - 1;
    expect(count0).toBe(1);
    expect(count1).toBe(1);
    // The highlighted line should differ between sel=0 and sel=1
    const hl0 = lines0.find((l) => l.includes(selEsc));
    const hl1 = lines1.find((l) => l.includes(selEsc));
    expect(hl0).not.toEqual(hl1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// handlePanelKey
// ══════════════════════════════════════════════════════════════════════════

describe("[unit] handlePanelKey", () => {
  it("q sets quit=true and returns no action", () => {
    const result = handlePanelKey("q", makeState(2));
    expect(result.state.quit).toBe(true);
    expect(result.action.kind).toBe("none");
  });

  it("Ctrl+C sets quit=true", () => {
    const result = handlePanelKey("\x03", makeState(0));
    expect(result.state.quit).toBe(true);
  });

  it("Ctrl+D sets quit=true", () => {
    const result = handlePanelKey("\x04", makeState(0));
    expect(result.state.quit).toBe(true);
  });

  it("↑ decreases sel by 1 (clamped at 0)", () => {
    const r1 = handlePanelKey("\x1b[A", makeState(2));
    expect(r1.state.sel).toBe(1);
    expect(r1.action.kind).toBe("none");

    const r2 = handlePanelKey("\x1b[A", makeState(0));
    expect(r2.state.sel).toBe(0); // clamped
  });

  it("↓ increases sel by 1 (clamped at itemCount-1)", () => {
    const r1 = handlePanelKey("\x1b[B", makeState(0), 5);
    expect(r1.state.sel).toBe(1);

    const r2 = handlePanelKey("\x1b[B", makeState(4), 5);
    expect(r2.state.sel).toBe(4); // clamped at max
  });

  it("↓ without itemCount does not clamp", () => {
    const r = handlePanelKey("\x1b[B", makeState(99));
    expect(r.state.sel).toBe(100);
  });

  it("↓ on empty tree (itemCount=0) clamps to 0", () => {
    const r = handlePanelKey("\x1b[B", makeState(0), 0);
    expect(r.state.sel).toBe(0);
  });

  it("o returns open action", () => {
    const result = handlePanelKey("o", makeState(1));
    expect(result.action.kind).toBe("open");
    expect(result.state.quit).toBe(false);
  });

  it("Enter returns open action", () => {
    const result = handlePanelKey("\r", makeState(0));
    expect(result.action.kind).toBe("open");
  });

  it("newline returns open action", () => {
    const result = handlePanelKey("\n", makeState(0));
    expect(result.action.kind).toBe("open");
  });

  it("x returns kill action", () => {
    const result = handlePanelKey("x", makeState(2));
    expect(result.action.kind).toBe("kill");
    expect(result.state.quit).toBe(false);
  });

  it("r returns refresh action", () => {
    const result = handlePanelKey("r", makeState(0));
    expect(result.action.kind).toBe("refresh");
  });

  it("unrecognized key returns none and preserves state", () => {
    const result = handlePanelKey("z", makeState(3));
    expect(result.action.kind).toBe("none");
    expect(result.state.sel).toBe(3);
    expect(result.state.quit).toBe(false);
  });

  it("does not mutate the input state (returns a new object)", () => {
    const original = makeState(2);
    handlePanelKey("\x1b[B", original, 10);
    expect(original.sel).toBe(2); // unchanged
    expect(original.quit).toBe(false);
  });

  it("quit key does not mutate the input state", () => {
    const original = makeState(1);
    handlePanelKey("q", original);
    expect(original.quit).toBe(false);
  });
});
