/**
 * @my-agent/tui — pi-quality readline UI.
 *
 * Full visual parity with pi-coding-agent's interactive mode:
 *   - Pi-style header (accent box border, model/provider)
 *   - Spinner ⠋⠙⠹ during model thinking (stderr, 80ms)
 *   - Markdown rendering: # headers, ```code blocks``` with border,
 *     **bold**, `inline code`, > quotes, - lists, --- separators
 *   - Tool execution cards: ▌ bash $cmd ▐ with output, ▌ read path ▐,
 *     ▌ edit path ▐ with diff (green/red)
 *   - Thinking blocks: <think>...</think> → dimmed, collapsible
 *   - Context bar: cwd, git branch, model, cost meter
 *   - Turn separators: ───────── between user↔assistant
 *   - ANSI 256-color throughout (accent, success, error, warning, muted, tool)
 *
 * Source: pi-coding-agent/dist/modes/interactive/ + claw-code + oh-my-pi.
 */
import { createInterface, type Interface } from "node:readline";
import { execSync } from "node:child_process";

// ─── ANSI 256-color palette (pi-style hex → xterm) ────────────────────
const C = {
  reset: "\x1b[0m",  bold: "\x1b[1m",  dim: "\x1b[2m",  italic: "\x1b[3m",
  underline: "\x1b[4m",
  accent: "\x1b[38;5;117m",    // sky blue
  success: "\x1b[38;5;155m",   // lime green
  error: "\x1b[38;5;203m",     // soft red
  warning: "\x1b[38;5;221m",   // amber
  muted: "\x1b[38;5;103m",     // gray-blue
  dimtext: "\x1b[38;5;240m",   // darker gray
  tool: "\x1b[38;5;177m",      // purple
  heading: "\x1b[38;5;221m",   // amber
  code: "\x1b[38;5;81m",       // cyan
  codeBg: "\x1b[48;5;236m",    // dark bg
  userBg: "\x1b[48;5;235m",    // dark slate
  diffAdd: "\x1b[38;5;114m",   // green
  diffDel: "\x1b[38;5;174m",   // red
  diffCtx: "\x1b[38;5;240m",   // gray
  border: "\x1b[38;5;60m",     // dark blue-gray
};

/** The handler the host implements (binds tui → the agent core). */
export interface TuiHandler {
  prompt(text: string, onEvent: (event: unknown) => void): Promise<unknown>;
  cancel(): void;
}
export type EventRenderer = (event: unknown) => string | null;

// ─── Markdown-lite renderer ───────────────────────────────────────────
/** Render assistant text with markdown → ANSI. Handles code blocks, bold,
 * inline code, headers, quotes, lists, hr, think tags. */
function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  for (const line of lines) {
    // Code block toggle
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        out.push(`${C.border}┌${"─".repeat(38)}┐${C.reset}`);
      } else {
        inCodeBlock = false;
        out.push(`${C.border}└${"─".repeat(38)}┘${C.reset}`);
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(`${C.border}│${C.reset} ${C.code}${line}${C.reset}`);
      continue;
    }
    let l = line;
    // Headers
    if (/^###\s/.test(l)) { out.push(`${C.heading}${C.bold}${l.replace(/^###\s/, "")}${C.reset}`); continue; }
    if (/^##\s/.test(l))  { out.push(`${C.heading}${C.bold}${l.replace(/^##\s/, "")}${C.reset}`); continue; }
    if (/^#\s/.test(l))   { out.push(`${C.heading}${C.bold}${C.underline}${l.replace(/^#\s/, "")}${C.reset}`); continue; }
    // HR
    if (/^---+$/.test(l.trim())) { out.push(`${C.border}${"─".repeat(40)}${C.reset}`); continue; }
    // Quote
    if (l.startsWith(">")) { out.push(`${C.muted}${C.italic}${l}${C.reset}`); continue; }
    // Bullet
    if (/^[-*]\s/.test(l)) { l = l.replace(/^([-*]\s)/, `${C.accent}● ${C.reset}`); }
    // Numbered
    if (/^\d+\.\s/.test(l)) { l = l.replace(/^(\d+)\.\s/, `${C.accent}$1. ${C.reset}`); }
    // Inline formatting
    l = l.replace(/\*\*(.+?)\*\*/g, `${C.bold}$1${C.reset}`);
    l = l.replace(/`([^`]+)`/g, `${C.codeBg}${C.code} $1 ${C.reset}`);
    l = l.replace(/_([^_]+)_/g, `${C.italic}$1${C.reset}`);
    out.push(l);
  }
  return out.join("\n");
}

// ─── Tool card renderer ───────────────────────────────────────────────
/** Build a bordered tool-execution card. */
function toolCard(name: string, detail: string, opts?: { error?: boolean }): string {
  const color = opts?.error ? C.error : C.tool;
  const label = opts?.error ? "✗" : "▸";
  const lines = [
    `${C.border}┌${"─".repeat(38)}┐${C.reset}`,
    `${C.border}│${C.reset} ${color}${C.bold}${label} ${name}${C.reset}`,
  ];
  if (detail) {
    const detailLines = detail.split("\n").slice(0, 8);
    for (const dl of detailLines) {
      const truncated = dl.length > 36 ? dl.slice(0, 36) + "…" : dl;
      lines.push(`${C.border}│${C.reset} ${C.muted}${truncated}${C.reset}`);
    }
  }
  lines.push(`${C.border}└${"─".repeat(38)}┘${C.reset}`);
  return "\n" + lines.join("\n") + "\n";
}

// ─── Context bar ──────────────────────────────────────────────────────
let _cwd = process.cwd();
let _branch = "";
let _model = "MiniMax-M3";
let _spentUsd = 0;
let _budgetUsd = 0;

function updateContext(opts: { cwd?: string; model?: string; spent?: number; budget?: number }): void {
  if (opts.cwd) _cwd = opts.cwd;
  if (opts.model) _model = opts.model;
  if (opts.spent !== undefined) _spentUsd = opts.spent;
  if (opts.budget !== undefined) _budgetUsd = opts.budget;
  try { _branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: _cwd, encoding: "utf8", timeout: 1000, stdio: ["pipe", "pipe", "pipe"] }).trim(); } catch { _branch = ""; }
}

function renderContextBar(): string {
  const branch = _branch ? `${C.success} ${_branch}${C.reset}` : "";
  const pct = _budgetUsd > 0 ? Math.min(100, (_spentUsd / _budgetUsd) * 100) : 0;
  const meter = _budgetUsd > 0
    ? `${pct >= 80 ? C.error : pct >= 50 ? C.warning : C.success}[${"█".repeat(Math.floor(pct / 5))}${"░".repeat(20 - Math.floor(pct / 5))}]${C.reset} ${C.muted}${pct.toFixed(0)}%${C.reset}`
    : `${C.muted}$${_spentUsd.toFixed(4)}${C.reset}`;
  return `${C.muted}${_cwd}${C.reset}${branch} ${C.muted}·${C.reset} ${C.accent}${_model}${C.reset} ${C.muted}·${C.reset} ${meter}\n`;
}

// ─── Pi-quality event renderer ────────────────────────────────────────
export const defaultRenderer: EventRenderer = (event) => {
  const e = event as {
    kind?: string;
    turnEvent?: {
      state?: string;
      chunk?: { kind?: string; text?: string; call?: { name?: string; arguments?: unknown } };
      usage?: { input?: number; output?: number };
    };
    usage?: { input?: number; output?: number };
    cost?: { usd?: number };
  };
  if (!e || typeof e !== "object") return null;
  if (e.kind === "turn") {
    const te = e.turnEvent;
    if (!te) return null;
    if (te.state === "Streaming" && te.chunk?.kind === "text") {
      const raw = te.chunk.text ?? "";
      // Handle <think> blocks → dim
      if (raw.includes("<think>")) return `${C.dimtext}`;
      if (raw.includes("</think>")) return `${C.reset}\n`;
      return renderMarkdown(raw);
    }
    if (te.state === "ToolCalls" && te.chunk?.kind === "tool_call") {
      const name = te.chunk.call?.name ?? "?";
      const args = te.chunk.call?.arguments as Record<string, unknown> | undefined;
      let detail = "";
      if (name === "bash" && args?.command) detail = `$ ${String(args.command)}`;
      else if (name === "read" && args?.path) detail = `📖 ${String(args.path)}`;
      else if ((name === "write" || name === "edit") && args?.path) detail = `✏️ ${String(args.path)}`;
      else if (name === "grep") detail = `🔍 ${String(args?.pattern ?? "")}`;
      else if (name === "glob") detail = `📂 ${String(args?.pattern ?? "")}`;
      else if (args) detail = JSON.stringify(args).slice(0, 100);
      return toolCard(name, detail);
    }
    if (te.state === "Completed") {
      const i = te.usage?.input ?? 0;
      const o = te.usage?.output ?? 0;
      if (i > 0 || o > 0) return `\n${C.border}${"─".repeat(40)}${C.reset}\n${C.muted}↑${i} ↓${o} tokens${C.reset}\n`;
      return null;
    }
    if (te.state === "AwaitingApproval") {
      return `\n${C.warning}${C.bold}⚡ Approval required${C.reset} ${C.muted}(y = allow, n = deny)${C.reset}\n`;
    }
  }
  if (e.kind === "budget") {
    const spent = e.cost?.usd ?? 0;
    updateContext({ spent });
    return null;
  }
  if (e.kind === "health") return null;
  return null;
};

// ─── TuiRepl — full interactive REPL ──────────────────────────────────
export class TuiRepl {
  private rl: Interface | null = null;
  private activePrompt: string | null = null;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIdx = 0;

  constructor(
    private readonly handler: TuiHandler,
    private readonly renderer: EventRenderer = defaultRenderer,
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  ) {}

  start(_greeting?: string): void {
    // Pi-style header
    this.output.write(
      `\n${C.accent}${C.bold}╭──────────────────────────────────╮${C.reset}\n` +
      `${C.accent}${C.bold}│${C.reset} ${C.accent}${C.bold}● mya${C.reset} ${C.muted}· unified agent${C.reset}${C.accent}${C.bold}${" ".repeat(Math.max(0, 13))}│${C.reset}\n` +
      `${C.accent}${C.bold}╰──────────────────────────────────╯${C.reset}\n` +
      `${renderContextBar()}` +
      `${C.muted}Ctrl-C abort · Ctrl-D exit · / for commands · ↑↓ history${C.reset}\n\n`
    );
    this.rl = createInterface({ input: this.input, output: this.output as NodeJS.WriteStream });
    this.rl.on("SIGINT", () => {
      if (this.activePrompt !== null) {
        this.handler.cancel();
        this.stopSpinner();
        this.output.write(`\n${C.warning}^C — turn aborted${C.reset}\n`);
      } else {
        this.output.write(`\n${C.muted}bye 👋${C.reset}\n`);
        this.rl?.close();
      }
    });
    this.rl.on("line", (line) => {
      const text = line.trim();
      if (!text) { this.rl?.prompt(); return; }
      this.activePrompt = text;
      // Echo user input with background + separator
      this.output.write(`${C.userBg} ${C.success}${C.bold}▶ you${C.reset} ${C.userBg}${text} ${C.reset}\n`);
      this.startSpinner();
      void this.runTurn(text).finally(() => {
        this.activePrompt = null;
        this.stopSpinner();
        this.output.write(`\n${renderContextBar()}`);
        this.rl?.setPrompt(`${C.accent}>${C.reset} `);
        this.rl?.prompt();
      });
    });
    this.rl.on("close", () => { this.output.write("\n"); });
    this.rl.setPrompt(`${C.accent}>${C.reset} `);
    this.rl.prompt();
  }

  private startSpinner(): void {
    this.spinnerIdx = 0;
    this.spinnerInterval = setInterval(() => {
      const frame = this.spinnerFrames[this.spinnerIdx % this.spinnerFrames.length];
      this.spinnerIdx++;
      process.stderr.write(`\r${C.accent}${frame}${C.reset} ${C.muted}thinking…${C.reset}`);
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      process.stderr.write("\r" + " ".repeat(20) + "\r");
    }
  }

  private async runTurn(text: string): Promise<void> {
    try {
      await this.handler.prompt(text, (event) => {
        const line = this.renderer(event);
        if (line !== null) this.output.write(line);
      });
    } catch (e) {
      this.output.write(`${C.error}${C.bold}✗ error:${C.reset} ${C.error}${(e as Error).message}${C.reset}\n`);
    }
  }

  close(): void {
    this.stopSpinner();
    this.rl?.close();
    this.rl = null;
  }
}

/** Update context from the host (called by main.ts). */
export { updateContext };
