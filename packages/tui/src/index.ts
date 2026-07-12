/**
 * @my-agent/tui — interactive transport (§20/§3/§25.1).
 *
 * Pi-quality ANSI rendering for the readline fallback path. Works on
 * EVERY terminal (no raw mode needed). Rich colors, box-drawing borders,
 * markdown-lite, spinner, tool cards.
 */
import { createInterface, type Interface } from "node:readline";

// ─── ANSI helpers ──────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  // Pi-style hex colors via 256-color escape
  accent: "\x1b[38;5;117m",      // sky blue
  success: "\x1b[38;5;155m",     // lime green
  error: "\x1b[38;5;203m",       // soft red
  warning: "\x1b[38;5;221m",     // amber
  muted: "\x1b[38;5;103m",       // gray-blue
  tool: "\x1b[38;5;177m",        // purple
  heading: "\x1b[38;5;221m",     // amber bold
  code: "\x1b[38;5;177m",        // purple
  codeBg: "\x1b[48;5;236m",      // dark bg
  // Backgrounds
  userBg: "\x1b[48;5;235m",      // dark slate
  toolBg: "\x1b[48;5;237m",      // slightly lighter
};

/** The handler the host implements (binds tui → the agent core). */
export interface TuiHandler {
  prompt(text: string, onEvent: (event: unknown) => void): Promise<unknown>;
  cancel(): void;
}

/** Render a RuntimeEvent to a human-readable ANSI-colored line. */
export type EventRenderer = (event: unknown) => string | null;

/** Pi-quality ANSI renderer — markdown-lite + colors + tool cards. */
export const defaultRenderer: EventRenderer = (event) => {
  const e = event as { kind?: string; turnEvent?: { state?: string; chunk?: { kind?: string; text?: string; call?: { name?: string; arguments?: unknown } }; usage?: { input?: number; output?: number } } };
  if (!e || typeof e !== "object") return null;
  if (e.kind === "turn") {
    const te = e.turnEvent;
    if (!te) return null;
    // Streaming text → render with markdown-lite
    if (te.state === "Streaming" && te.chunk?.kind === "text") {
      return renderMarkdownLite(te.chunk.text ?? "");
    }
    // Tool call → render as a card
    if (te.state === "ToolCalls" && te.chunk?.kind === "tool_call") {
      const name = te.chunk.call?.name ?? "?";
      return `\n${C.toolBg}▌ ${C.tool}${C.bold}${name}${C.reset}${C.toolBg} ▐${C.reset}\n`;
    }
    // Completed → show token usage
    if (te.state === "Completed") {
      const i = te.usage?.input ?? 0;
      const o = te.usage?.output ?? 0;
      if (i > 0 || o > 0) return `\n${C.muted}─── ↑${i} ↓${o} tokens ───${C.reset}\n`;
      return null;
    }
    // AwaitingApproval
    if (te.state === "AwaitingApproval") {
      return `\n${C.warning}${C.bold}⚡ Approval required${C.reset} ${C.muted}(y/n)${C.reset}\n`;
    }
  }
  if (e.kind === "health") return null;
  return null;
};

/** Parse a chunk of assistant text for markdown-lite → ANSI. */
function renderMarkdownLite(text: string): string {
  let out = text;
  // Bold **text** → bold
  out = out.replace(/\*\*(.+?)\*\*/g, `${C.bold}$1${C.reset}`);
  // Inline code `text` → colored with bg
  out = out.replace(/`([^`]+)`/g, `${C.codeBg}${C.code} $1 ${C.reset}`);
  // Headers # text → amber bold
  out = out.replace(/^#{1,3}\s+(.+)/gm, `${C.heading}${C.bold}$1${C.reset}`);
  // Bullet points → accent
  out = out.replace(/^(\s*[-*]\s)/gm, `${C.accent}• ${C.reset}`);
  // Strip <think> tags → dim
  out = out.replace(/<think>/g, `${C.dim}`);
  out = out.replace(/<\/think>/g, `${C.reset}`);
  return out;
}

/** A minimal interactive REPL with ANSI-colored output. */
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

  /** Start the REPL loop. Returns when input closes (EOF). */
  start(greeting?: string): void {
    // Pi-style header
    this.output.write(
      `\n${C.accent}${C.bold}╭───────────────────╮${C.reset}\n` +
      `${C.accent}${C.bold}│${C.reset} ${C.accent}${C.bold}● mya${C.reset} ${C.muted}· unified agent${C.reset} ${C.accent}${C.bold} │${C.reset}\n` +
      `${C.accent}${C.bold}╰───────────────────╯${C.reset}\n` +
      `${C.muted}Ctrl-C abort · Ctrl-D exit · / for commands${C.reset}\n\n`
    );

    this.rl = createInterface({ input: this.input, output: this.output as NodeJS.WriteStream });
    this.rl.on("SIGINT", () => {
      if (this.activePrompt !== null) {
        this.handler.cancel();
        this.stopSpinner();
        this.output.write(`\n${C.warning}^C — turn aborted${C.reset}\n`);
      } else {
        this.output.write(`\n${C.muted}bye${C.reset}\n`);
        this.rl?.close();
      }
    });
    this.rl.on("line", (line) => {
      const text = line.trim();
      if (!text) { this.rl?.prompt(); return; }
      this.activePrompt = text;
      // Echo user input with accent
      this.output.write(`${C.userBg} ${C.success}${C.bold}you${C.reset} ${C.userBg}${text} ${C.reset}\n`);
      this.startSpinner();
      void this.runTurn(text).finally(() => {
        this.activePrompt = null;
        this.stopSpinner();
        this.rl?.setPrompt(`${C.accent}>${C.reset} `);
      this.rl?.prompt();
      });
    });
    this.rl.on("close", () => { this.output.write("\n"); });
    this.rl.setPrompt(`${C.accent}>${C.reset} `);
    this.rl.prompt();
  }

  /** Show an animated spinner while the model is thinking. */
  private startSpinner(): void {
    this.spinnerIdx = 0;
    this.spinnerInterval = setInterval(() => {
      const frame = this.spinnerFrames[this.spinnerIdx % this.spinnerFrames.length];
      this.spinnerIdx++;
      // Use CR to overwrite the spinner line
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
