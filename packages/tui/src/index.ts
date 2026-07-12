/**
 * mya TUI — following claw-code's rendering approach (simplest viable).
 *
 * Line-by-line append with ANSI colors. No raw mode for content.
 * Key patterns ported from claw-code/rusty-claude-cli/src/render.rs:
 *   - Streaming markdown with boundary detection (render only complete blocks)
 *   - Spinner: save cursor → clear line → write frame → restore cursor (stdout)
 *   - Code blocks: adaptive ╭─ {lang} ╰─ border (terminal width)
 *   - <think> tags: dim all content between them
 *   - No background colors (foreground ANSI only for max compatibility)
 */
import { createInterface, type Interface } from "node:readline";
import { execSync } from "node:child_process";
import { stdout, stderr } from "node:process";

// ─── ANSI (foreground only — no backgrounds for max terminal compat) ──
const C = {
  R: "\x1b[0m",
  B: "\x1b[1m",     // bold
  D: "\x1b[2m",     // dim
  I: "\x1b[3m",     // italic
  U: "\x1b[4m",     // underline
  // Pi-style 256 colors
  accent: "\x1b[38;5;110m",    // soft sky
  green: "\x1b[38;5;108m",     // sage green
  red: "\x1b[38;5;168m",       // soft red
  yellow: "\x1b[38;5;179m",    // amber
  gray: "\x1b[38;5;245m",      // light gray
  darkgray: "\x1b[38;5;238m",  // dark gray
  blue: "\x1b[38;5;67m",       // steel blue
  purple: "\x1b[38;5;140m",    // soft purple
  cyan: "\x1b[38;5;73m",       // teal
  border: "\x1b[38;5;239m",    // subtle border color
};

const SAVE = "\x1b7";      // save cursor
const RESTORE = "\x1b8";   // restore cursor
const CLR_LINE = "\x1b[2K"; // clear entire line
const CR = "\r";

export interface TuiHandler {
  prompt(text: string, onEvent: (event: unknown) => void): Promise<unknown>;
  cancel(): void;
}
export type EventRenderer = (event: unknown) => string | null;

// ─── Markdown streaming (claw-code pattern) ───────────────────────────
/** Accumulates streaming text deltas. Only renders complete markdown blocks
 * (delimited by blank lines or closed code fences). Prevents flicker from
 * half-rendered markdown. */
class MarkdownStream {
  private buffer = "";
  private lastRendered = "";

  /** Push a text delta. Returns the complete, ready-to-render text
   * (null if no new complete blocks since last render). */
  push(delta: string): string | null {
    this.buffer += delta;
    // Find stream-safe boundary: end of a complete block.
    // A block ends at a blank line, or after a closed code fence.
    const safeEnd = this.findSafeBoundary();
    if (safeEnd <= this.lastRendered.length) return null;
    const newComplete = this.buffer.slice(0, safeEnd);
    const diff = newComplete.slice(this.lastRendered.length);
    this.lastRendered = newComplete;
    return diff;
  }

  /** Flush remaining buffer (call on turn end). */
  flush(): string | null {
    if (this.buffer.length <= this.lastRendered.length) return null;
    const diff = this.buffer.slice(this.lastRendered.length);
    this.lastRendered = this.buffer;
    return diff;
  }

  reset(): void { this.buffer = ""; this.lastRendered = ""; }

  /** Find the latest safe boundary in the buffer. */
  private findSafeBoundary(): number {
    // Check for code fence state — don't split inside a code block.
    let inFence = false;
    let lastSafe = 0;
    const lines = this.buffer.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineLen = line.length + 1; // +1 for \n
      if (line.startsWith("```")) {
        inFence = !inFence;
        if (!inFence) {
          // Closed fence — safe to render up to here.
          lastSafe = offset + lineLen;
        }
      } else if (!inFence && line.trim() === "") {
        // Blank line outside code block — safe boundary.
        lastSafe = offset + lineLen;
      }
      offset += lineLen;
    }
    // If we're inside a code fence, don't render past the fence start.
    if (inFence) return lastSafe;
    return Math.max(lastSafe, this.lastRendered.length);
  }
}

// ─── Markdown renderer (line-by-line ANSI) ────────────────────────────
function renderMarkdownLine(line: string, width: number): string {
  // Code block border
  if (line.startsWith("```")) {
    const lang = line.slice(3).trim();
    return `${C.border}╭${lang ? `${C.gray}─ ${lang}` : "─"}${"─".repeat(Math.max(0, width - lang.length - 4))}${C.border}╮${C.R}`;
  }
  // Headers
  if (/^###\s/.test(line)) return `${C.yellow}${C.B}${line.replace(/^###\s/, "")}${C.R}`;
  if (/^##\s/.test(line))  return `${C.yellow}${C.B}${line.replace(/^##\s/, "")}${C.R}`;
  if (/^#\s/.test(line))   return `${C.yellow}${C.B}${C.U}${line.replace(/^#\s/, "")}${C.R}`;
  // HR
  if (/^---+$/.test(line.trim())) return `${C.border}${"─".repeat(width)}${C.R}`;
  // Quote
  if (line.startsWith(">")) return `${C.gray}${C.I}${line}${C.R}`;
  // Bullet
  let l = line;
  if (/^\s*[-*]\s/.test(l)) l = l.replace(/^(\s*)[-*]\s/, `$1${C.accent}● ${C.R}`);
  // Numbered
  if (/^\d+\.\s/.test(l)) l = l.replace(/^(\d+)\.\s/, `${C.accent}$1. ${C.R}`);
  // Inline formatting
  l = l.replace(/\*\*(.+?)\*\*/g, `${C.B}$1${C.R}`);
  l = l.replace(/`([^`]+)`/g, `${C.cyan}$1${C.R}`);
  l = l.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${C.blue}$1${C.R}${C.gray} ($2)${C.R}`);
  return l;
}

// ─── Context bar ──────────────────────────────────────────────────────
function getContextBar(): string {
  const cwd = process.cwd().replace(process.env["HOME"] ?? "", "~");
  let branch = "";
  try { branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf8", timeout: 500, stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch {}
  const cols = stdout.columns || 80;
  const left = `${C.gray}${cwd}${C.R}${branch ? ` ${C.green}${branch}${C.R}` : ""}`;
  return left;
}

// ─── TuiRepl ──────────────────────────────────────────────────────────
export class TuiRepl {
  private rl: Interface | null = null;
  private activePrompt: string | null = null;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerIdx = 0;
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private md = new MarkdownStream();
  private inThinkBlock = false;
  private width = 80;

  constructor(
    private readonly handler: TuiHandler,
    private readonly renderer: EventRenderer = defaultRenderer,
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = stdout,
  ) {
    this.width = stdout.columns || 80;
    stdout.on("resize", () => { this.width = stdout.columns || 80; });
  }

  start(_greeting?: string): void {
    const w = this.width;
    // Pi-style header (foreground colors only, no backgrounds)
    const hdr = "● mya";
    const sub = " · unified agent";
    const padR = Math.max(2, w - hdr.length - sub.length - 4);
    this.output.write(
      `\n${C.border}╭${"─".repeat(w - 2)}╮${C.R}\n` +
      `${C.border}│${C.R} ${C.accent}${C.B}${hdr}${C.R}${C.gray}${sub}${C.R}${" ".repeat(padR)}${C.border}│${C.R}\n` +
      `${C.border}╰${"─".repeat(w - 2)}╯${C.R}\n` +
      `${getContextBar()}\n` +
      `${C.gray}Ctrl-C abort · Ctrl-D exit · / commands${C.R}\n\n`
    );
    this.rl = createInterface({ input: this.input, output: this.output as NodeJS.WriteStream });
    this.rl.on("SIGINT", () => {
      if (this.activePrompt !== null) {
        this.handler.cancel();
        this.stopSpinner();
        this.output.write(`\n${C.yellow}^C aborted${C.R}\n`);
      } else {
        this.output.write(`\n${C.gray}bye${C.R}\n`);
        this.rl?.close();
      }
    });
    this.rl.on("line", (line) => {
      const text = line.trim();
      if (!text) { this.rl?.prompt(); return; }
      this.activePrompt = text;
      this.md.reset();
      this.output.write(`${C.green}${C.B}▶ you${C.R} ${text}\n`);
      this.startSpinner();
      void this.runTurn(text).finally(() => {
        this.activePrompt = null;
        this.stopSpinner();
        // Flush any remaining markdown
        const flushed = this.md.flush();
        if (flushed) this.renderText(flushed);
        this.output.write(`\n${C.border}${"─".repeat(this.width)}${C.R}\n`);
        this.rl?.setPrompt(`${C.accent}>${C.R} `);
        this.rl?.prompt();
      });
    });
    this.rl.on("close", () => { this.output.write("\n"); });
    this.rl.setPrompt(`${C.accent}>${C.R} `);
    this.rl.prompt();
  }

  // Spinner: claw-code pattern (save cursor, clear line, write, restore)
  private startSpinner(): void {
    this.spinnerIdx = 0;
    this.spinnerTimer = setInterval(() => {
      const frame = this.spinnerFrames[this.spinnerIdx % this.spinnerFrames.length];
      this.spinnerIdx++;
      // Write to STDOUT (not stderr) with save/restore cursor
      stdout.write(`${SAVE}${CR}${CLR_LINE}${C.accent}${frame}${C.R} ${C.gray}thinking…${C.R}${RESTORE}`);
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      stdout.write(`${SAVE}${CR}${CLR_LINE}${RESTORE}`);
    }
  }

  private renderText(text: string): void {
    // Handle <think> blocks
    const parts = text.split(/(<\/?think>)/);
    for (const part of parts) {
      if (part === "<think>") { this.inThinkBlock = true; continue; }
      if (part === "</think>") { this.inThinkBlock = false; this.output.write("\n"); continue; }
      if (this.inThinkBlock) {
        // Dim thinking text
        this.output.write(`${C.darkgray}${part}${C.R}`);
        continue;
      }
      // Render markdown line-by-line
      const lines = part.split("\n");
      for (const line of lines) {
        this.output.write(renderMarkdownLine(line, this.width) + "\n");
      }
    }
  }

  private async runTurn(text: string): Promise<void> {
    try {
      await this.handler.prompt(text, (event) => {
        const line = this.renderer(event);
        if (line !== null) this.output.write(line);
      });
    } catch (e) {
      this.output.write(`${C.red}${C.B}✗ ${(e as Error).message}${C.R}\n`);
    }
  }

  close(): void {
    this.stopSpinner();
    this.rl?.close();
    this.rl = null;
  }
}

// ─── Event renderer ───────────────────────────────────────────────────
export const defaultRenderer: EventRenderer = (event) => {
  const e = event as {
    kind?: string;
    turnEvent?: {
      state?: string;
      chunk?: { kind?: string; text?: string; call?: { name?: string; arguments?: unknown } };
      usage?: { input?: number; output?: number };
    };
  };
  if (!e || typeof e !== "object") return null;
  if (e.kind === "turn") {
    const te = e.turnEvent;
    if (!te) return null;
    if (te.state === "Streaming" && te.chunk?.kind === "text") {
      return te.chunk.text ?? "";
    }
    if (te.state === "ToolCalls" && te.chunk?.kind === "tool_call") {
      const name = te.chunk.call?.name ?? "?";
      const args = te.chunk.call?.arguments as Record<string, unknown> | undefined;
      let detail = "";
      if (name === "bash" && args?.command) detail = `$ ${args.command}`;
      else if (args) detail = JSON.stringify(args).slice(0, 80);
      return `\n${C.purple}${C.B}▸ ${name}${C.R} ${C.gray}${detail}${C.R}\n`;
    }
    if (te.state === "Completed") {
      const i = te.usage?.input ?? 0, o = te.usage?.output ?? 0;
      if (i > 0 || o > 0) return `${C.gray}↑${i} ↓${o} tokens${C.R}`;
      return null;
    }
    if (te.state === "AwaitingApproval") {
      return `\n${C.yellow}${C.B}⚡ approval${C.R} ${C.gray}(y/n)${C.R}\n`;
    }
  }
  if (e.kind === "health") return null;
  return null;
};
