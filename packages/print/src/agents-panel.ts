/**
 * mya agents — live role-subagent panel (Track 2).
 *
 * A standalone fullscreen TUI (alt-screen + raw mode) that polls GET /pool/tree
 * every 2s and renders the agent tree with status glyphs. Mirrors the launcher.ts
 * takeover pattern (READ-ONLY reference — this file does NOT modify launcher.ts).
 *
 * Keys: ↑/↓ select, o/Enter=open selected, x=kill, r=refresh, q=quit.
 *
 * Pure functions (renderAgentsPanel, handlePanelKey, flattenTree) are exported
 * for unit testing. The TUI takeover (runAgentsPanel) is [real]-tier (needs a
 * real terminal — not unit-testable).
 */
import { supervisedTask, type SupervisedTaskHandle } from "@my-agent/core";
import { authHeaders } from "./gw-auth.js";
import { focusRoleSubagentView, closeRoleSubagentView, forgetViewHandle } from "./role-subagent-spawn.js";
import type { AgentTreeNode } from "./mya-bridge.js";

// ── ANSI helpers (mirror the `A` object pattern from launcher.ts) ──────────

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[38;2;210;153;34m${s}\x1b[39m`,
  red: (s: string) => `\x1b[38;2;201;79;79m${s}\x1b[39m`,
  blue: (s: string) => `\x1b[38;2;120;170;220m${s}\x1b[39m`,
  selBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clrEol: "\x1b[K",
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clear: "\x1b[2J\x1b[H",
};

const GW_PORT = parseInt(process.env["MYA_PORT"] ?? "3000", 10);
const REFRESH_MS = 2000;

// ── Types ─────────────────────────────────────────────────────────────────

/** A flat display item derived from the tree (for rendering + selection). */
export interface PanelItem {
  kind: "main" | "sub";
  id: string;
  label: string;
  status?: string;
  busy?: boolean;
  role?: string;
  task?: string;
  messages?: number;
  depth: number;
}

/** Mutable panel state (selection cursor + quit flag). */
export interface PanelState {
  sel: number;
  quit: boolean;
}

/** Action emitted by the key handler for the TUI loop to execute. */
export type PanelAction =
  | { kind: "none" }
  | { kind: "open" }
  | { kind: "kill" }
  | { kind: "refresh" };

/** Result of processing a key: updated state + optional action. */
export interface PanelKeyResult {
  state: PanelState;
  action: PanelAction;
}

// ── Pure helpers (unit-testable) ──────────────────────────────────────────

/** Flatten the tree into a display list (main sessions + nested subagents). */
export function flattenTree(tree: AgentTreeNode[]): PanelItem[] {
  const items: PanelItem[] = [];
  for (const node of tree) {
    const label = node.task
      ? node.task.slice(0, 40)
      : node.sessionId.replace(/^(ch-|s-)/, "").replace(/-/g, " ").slice(0, 40);
    items.push({
      kind: "main",
      id: node.sessionId,
      label,
      status: node.status,
      busy: node.busy,
      role: node.role,
      task: node.task,
      messages: node.messages,
      depth: 0,
    });
    for (const sub of node.subagents) {
      const subLabel = sub.task
        ? sub.task.slice(0, 40)
        : sub.goal
          ? sub.goal.slice(0, 40)
          : sub.id;
      items.push({
        kind: "sub",
        id: sub.id,
        label: subLabel,
        status: sub.status,
        role: sub.role,
        task: sub.task,
        messages: sub.messages,
        depth: sub.depth,
      });
    }
  }
  return items;
}

/** Map a task-status to a colored ANSI glyph string. */
function statusGlyph(status?: string, busy?: boolean): string {
  switch (status) {
    case "working":
    case "busy":
    case "running":
      return A.blue("●");
    case "done":
      return A.green("✓");
    case "failed":
      return A.red("✗");
    case "idle":
    case "acquired":
      return A.dim2("○");
    default:
      return busy ? A.yellow("●") : A.green("○");
  }
}

/**
 * Render the agent tree as ANSI-colored lines. Pure — no I/O, no side effects.
 *
 * @param tree   Agent tree from GET /pool/tree.
 * @param state  Panel state (sel = cursor position for highlight).
 * @returns      Array of ANSI strings (one per terminal line).
 */
export function renderAgentsPanel(tree: AgentTreeNode[], state: PanelState): string[] {
  const lines: string[] = [];
  const w = process.stdout.columns || 100;

  // Header
  lines.push(`  ${A.bold(A.accent("mya"))} ${A.muted("Agents Panel")}  ${A.dim2("· live tree")}`);
  lines.push(`  ${A.dim2("─".repeat(Math.max(40, w - 4)))}`);
  lines.push("");

  const items = flattenTree(tree);

  if (items.length === 0) {
    lines.push(`  ${A.muted("No active agents.")}`);
    lines.push("");
    lines.push(`  ${A.dim2("Spawn a role-subagent via the spawn-role-subagent tool")}`);
    lines.push(`  ${A.dim2("or /agents in your TUI session.")}`);
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const isSel = i === state.sel;
      const indent = item.kind === "sub" ? "    └─ " : "";
      const glyph = statusGlyph(item.status, item.busy);
      const roleTag = item.role ? ` ${A.dim2(`(${item.role})`)}` : "";
      const msgInfo = item.messages != null ? ` ${A.dim2(`${item.messages}m`)}` : "";
      const statusLabel = item.status ? ` ${A.dim2(`[${item.status}]`)}` : "";
      const baseLine = `${glyph} ${indent}${item.label.slice(0, 36).padEnd(38)}${roleTag}${msgInfo}${statusLabel}`;
      lines.push(isSel ? `  ${A.selBg(baseLine + A.clrEol)}` : `  ${baseLine}`);
    }
  }

  // Footer
  lines.push("");
  lines.push(`  ${A.dim2("─".repeat(Math.max(40, w - 4)))}`);
  lines.push(`  ${A.dim2("↑/↓ select  ·  o/Enter open  ·  x kill  ·  r refresh  ·  q quit")}`);

  return lines;
}

/**
 * Process a raw keypress. Pure — returns new state + action signal.
 *
 * @param key        Raw key string from stdin data event.
 * @param state      Current panel state.
 * @param itemCount  Number of selectable items (for clamping sel). Defaults to
 *                   a large value so callers that don't need clamping can omit it.
 * @returns          Updated state + action for the TUI loop.
 */
export function handlePanelKey(
  key: string,
  state: PanelState,
  itemCount = Number.MAX_SAFE_INTEGER,
): PanelKeyResult {
  const maxSel = Math.max(0, itemCount - 1);

  // Ctrl+C / Ctrl+D → quit
  if (key === "\x03" || key === "\x04") {
    return { state: { sel: state.sel, quit: true }, action: { kind: "none" } };
  }

  // q → quit
  if (key === "q") {
    return { state: { sel: state.sel, quit: true }, action: { kind: "none" } };
  }

  // ↑ → move up
  if (key === "\x1b[A") {
    return { state: { sel: Math.max(0, state.sel - 1), quit: false }, action: { kind: "none" } };
  }

  // ↓ → move down
  if (key === "\x1b[B") {
    return { state: { sel: Math.min(maxSel, state.sel + 1), quit: false }, action: { kind: "none" } };
  }

  // o / Enter → open selected
  if (key === "o" || key === "\r" || key === "\n") {
    return { state: { sel: state.sel, quit: false }, action: { kind: "open" } };
  }

  // x → kill selected
  if (key === "x") {
    return { state: { sel: state.sel, quit: false }, action: { kind: "kill" } };
  }

  // r → refresh
  if (key === "r") {
    return { state: { sel: state.sel, quit: false }, action: { kind: "refresh" } };
  }

  // Unrecognized → no change
  return { state: { sel: state.sel, quit: false }, action: { kind: "none" } };
}

// ── Gateway helpers (TUI layer — not unit-tested) ─────────────────────────

/** Fetch the agent tree from GET /pool/tree. Returns [] on failure. */
async function fetchAgentTree(): Promise<AgentTreeNode[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/tree`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return [];
    return (await r.json()) as AgentTreeNode[];
  } catch {
    return [];
  }
}

/** Kill a session via POST /pool/kill/<id>. */
export async function killSession(sessionId: string): Promise<boolean> {
  try {
    const r = await fetch(
      `http://127.0.0.1:${GW_PORT}/pool/kill/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: authHeaders(),
        signal: AbortSignal.timeout(1000),
      },
    );
    if (r.ok) {
      // F9: close the view pane/window before forgetting the handle.
      // NEW-4: best-effort close so forgetViewHandle always runs even if close throws.
      try { await closeRoleSubagentView(sessionId); } catch { /* best-effort */ }
      forgetViewHandle(sessionId);
    }
    return r.ok;
  } catch {
    return false;
  }
}

// ── TUI takeover (NOT unit-testable — [real]-tier) ────────────────────────

/**
 * Run the live agents panel. Sets up alt-screen + raw mode, polls /pool/tree
 * every 2s, and handles key input. Restores the terminal on exit.
 *
 * This mirrors the launcher.ts takeover pattern (READ-ONLY reference — does
 * NOT modify launcher.ts). Uses `supervisedTask` from @my-agent/core for the
 * interval-based refresh loop (same as launcher's `launcher-refresh` task).
 */
export async function runAgentsPanel(): Promise<void> {
  return new Promise<void>((resolve) => {
    const state: PanelState = { sel: 0, quit: false };
    let tree: AgentTreeNode[] = [];
    let refreshTimer: SupervisedTaskHandle | undefined;
    let cleanedUp = false;
    const isTTY = !!process.stdin.isTTY;

    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.altScreenOn + A.hideCursor);

    const refresh = async (): Promise<void> => {
      tree = await fetchAgentTree();
      render();
    };

    const render = (): void => {
      const lines = renderAgentsPanel(tree, state);
      process.stdout.write(A.clear + lines.join("\n") + "\n");
    };

    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (refreshTimer) refreshTimer.stop();
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.altScreenOff + A.clear + A.showCursor);
      resolve();
    };

    const onData = (data: Buffer): void => {
      if (cleanedUp) return;
      const key = data.toString();
      const items = flattenTree(tree);
      const result = handlePanelKey(key, state, items.length);

      // Propagate pure result into mutable state
      state.sel = result.state.sel;
      state.quit = result.state.quit;

      if (state.quit) {
        cleanup();
        return;
      }

      if (result.action.kind === "open") {
        const item = items[state.sel];
        if (item) {
          void focusRoleSubagentView(item.id).then(() => render());
        }
        return;
      }

      if (result.action.kind === "kill") {
        const item = items[state.sel];
        if (item) {
          void killSession(item.id).then(() => refresh());
        }
        return;
      }

      if (result.action.kind === "refresh") {
        void refresh();
        return;
      }

      // sel changed or unrecognized → re-render
      render();
    };

    void refresh();
    refreshTimer = supervisedTask(() => void refresh(), "agents-panel-refresh", {
      intervalMs: REFRESH_MS,
    });
    render();
    process.stdin.on("data", onData);
  });
}
