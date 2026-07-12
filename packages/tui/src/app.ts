/**
 * mya interactive TUI — built on the diff-rendering engine.
 *
 * Layout (top to bottom, matching pi):
 *   Header: ● mya · unified agent + keybinding hints
 *   Chat:   user/assistant/tool messages (scrollable)
 *   Status: spinner ⠋ during thinking
 *   Editor: input with cursor (raw mode key capture)
 *   Footer: cwd · git branch · model · tokens · cost
 *
 * All rendering goes through TUI.doRender() → diff → only changed lines written.
 */
import { TUI, Container, Text, Spacer, Terminal, type Component } from "./engine.js";
import { execSync } from "node:child_process";

// ─── ANSI palette (pi-style 256-color, foreground only for text) ──────
const C = {
  R: "\x1b[0m", B: "\x1b[1m", D: "\x1b[2m", I: "\x1b[3m", U: "\x1b[4m",
  accent: "\x1b[38;5;110m", green: "\x1b[38;5;108m", red: "\x1b[38;5;168m",
  yellow: "\x1b[38;5;179m", gray: "\x1b[38;5;245m", darkgray: "\x1b[38;5;238m",
  blue: "\x1b[38;5;67m", purple: "\x1b[38;5;140m", cyan: "\x1b[38;5;73m",
  border: "\x1b[38;5;239m",
};

// ─── Message types ────────────────────────────────────────────────────
interface Message {
  role: "user" | "assistant" | "tool" | "info" | "error";
  text: string;
  toolName?: string;
}

// ─── Markdown renderer (returns string[] for the diff engine) ─────────
function renderMarkdownToLines(text: string, width: number): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let inThink = false; // Stateful: dim ALL lines inside <think>...</think>
  for (const line of lines) {
    // Handle <think> blocks (stateful — dim spans multiple lines)
    if (line.includes("<think>")) { inThink = true; }
    if (line.includes("</think>")) {
      inThink = false;
      out.push(`${C.darkgray}${line.replace(/<\/?think>/g, "")}${C.R}`);
      continue;
    }
    if (inThink) {
      out.push(`${C.darkgray}${line.replace(/<\/?think>/g, "")}${C.R}`);
      continue;
    }
    let ml = line.replace(/<\/?think>/g, "");
    if (ml.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        const lang = ml.slice(3).trim();
        const label = lang || "code";
        out.push(`${C.border}╭${C.gray}─ ${label} ${C.border}${"─".repeat(Math.max(0, width - label.length - 8))}╮${C.R}`);
        continue;
      } else {
        inCodeBlock = false;
        out.push(`${C.border}╰${"─".repeat(Math.max(0, width - 2))}╯${C.R}`);
        continue;
      }
    }
    if (inCodeBlock) { out.push(`${C.cyan}  ${ml}${C.R}`); continue; }
    if (/^###\s/.test(ml)) { out.push(`${C.yellow}${C.B}${ml.replace(/^###\s/, "")}${C.R}`); continue; }
    if (/^##\s/.test(ml))  { out.push(`${C.yellow}${C.B}${ml.replace(/^##\s/, "")}${C.R}`); continue; }
    if (/^#\s/.test(ml))   { out.push(`${C.yellow}${C.B}${C.U}${ml.replace(/^#\s/, "")}${C.R}`); continue; }
    if (/^---+$/.test(ml.trim())) { out.push(`${C.border}${"─".repeat(width)}${C.R}`); continue; }
    if (ml.startsWith(">")) { out.push(`${C.gray}${C.I}${ml}${C.R}`); continue; }
    if (/^\s*[-*]\s/.test(ml)) ml = ml.replace(/^(\s*)[-*]\s/, `$1${C.accent}● ${C.R}`);
    ml = ml.replace(/\*\*(.+?)\*\*/g, `${C.B}$1${C.R}`);
    ml = ml.replace(/`([^`]+)`/g, `${C.cyan}$1${C.R}`);
    // Word wrap: don't break mid-word (strip ANSI for width calculation)
    const visibleLen = ml.replace(/\x1b\[[0-9;]*m/g, "").length;
    if (visibleLen > width - 2) {
      const words = ml.split(" ");
      let cur = "";
      for (const w of words) {
        const testLen = (cur + " " + w).replace(/\x1b\[[0-9;]*m/g, "").trimStart().length;
        if (testLen > width - 2 && cur) {
          out.push(cur);
          cur = w;
        } else {
          cur = cur ? cur + " " + w : w;
        }
      }
      if (cur) out.push(cur);
    } else {
      out.push(ml);
    }
  }
  return out;
}

// ─── Chat message component ───────────────────────────────────────────
class MessageComponent implements Component {
  constructor(public msg: Message) {}
  invalidate(): void {}
  render(width: number): string[] {
    const m = this.msg;
    if (m.role === "user") {
      return [
        ``,
        `${C.green}${C.B}▶ you${C.R} ${m.text}`,
      ];
    }
    if (m.role === "assistant") {
      const lines = renderMarkdownToLines(m.text, width);
      return [
        `${C.border}${"─".repeat(Math.min(width, 40))}${C.R}`,
        ...lines.map(l => `  ${l}`),
      ];
    }
    if (m.role === "tool" && m.toolName) {
      return [
        `  ${C.purple}${C.B}▸ ${m.toolName}${C.R} ${C.gray}${m.text}${C.R}`,
      ];
    }
    if (m.role === "error") {
      return [`  ${C.red}${C.B}✗ ${m.text}${C.R}`];
    }
    return [`  ${C.gray}${m.text}${C.R}`];
  }
}

// ─── Spinner component ────────────────────────────────────────────────
class SpinnerComponent implements Component {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private idx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private label: string, private requestRender: () => void) {}
  start(): void {
    this.idx = 0;
    this.timer = setInterval(() => { this.idx++; this.requestRender(); }, 80);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  invalidate(): void {}
  render(_width: number): string[] {
    if (!this.timer) return [];
    const f = this.frames[this.idx % this.frames.length];
    return [` ${C.accent}${f}${C.R} ${C.gray}${this.label}${C.R}`];
  }
}

// ─── DynamicFill — fills remaining terminal space (pins editor to bottom) ─
class DynamicFill implements Component {
  constructor(private getTermHeight: () => number, private getOtherLines: () => number) {}
  invalidate(): void {}
  render(_width: number): string[] {
    const fill = Math.max(1, this.getTermHeight() - this.getOtherLines());
    return Array(fill).fill("");
  }
}

// ─── Editor component (raw-mode key capture) ──────────────────────────
class EditorComponent implements Component {
  private lines: string[] = [""];
  private cursorCol = 0;
  private cursorLine = 0;
  onSubmit: ((text: string) => void) | null = null;

  invalidate(): void {}

  handleInput(data: string): boolean {
    // Enter → submit
    if (data === "\r" || data === "\n") {
      const text = this.lines.join("\n").trim();
      if (text && this.onSubmit) {
        this.onSubmit(text);
        this.lines = [""];
        this.cursorCol = 0;
        this.cursorLine = 0;
        return true;
      }
      return false;
    }
    // Ctrl-C → cancel (handled by caller)
    if (data === "\x03") return false;
    // Ctrl-D → exit (handled by caller)
    if (data === "\x04") return false;
    // Backspace
    if (data === "\x7f" || data === "\b") {
      if (this.cursorCol > 0) {
        const line = this.lines[this.cursorLine]!;
        this.lines[this.cursorLine] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
        this.cursorCol--;
      }
      return true;
    }
    // Printable chars
    if (data >= " " && data <= "~" || data === "\t") {
      const line = this.lines[this.cursorLine]!;
      const ch = data === "\t" ? "  " : data;
      this.lines[this.cursorLine] = line.slice(0, this.cursorCol) + ch + line.slice(this.cursorCol);
      this.cursorCol += ch.length;
      return true;
    }
    return false;
  }

  getText(): string { return this.lines.join("\n"); }

  render(width: number): string[] {
    const innerWidth = width - 4;
    const out: string[] = [];
    // Top border with accent label
    out.push(`${C.border}${"─".repeat(2)}${C.accent}┤ mya ├${C.border}${"─".repeat(Math.max(0, width - 9))}${C.R}`);
    // Content lines
    for (let i = 0; i < this.lines.length; i++) {
      const text = this.lines[i]!;
      // Show cursor with reverse video
      let display = text;
      if (i === this.cursorLine && this.cursorCol < text.length) {
        const before = text.slice(0, this.cursorCol);
        const char = text[this.cursorCol]!;
        const after = text.slice(this.cursorCol + 1);
        display = `${before}\x1b[7m${char}\x1b[0m${after}`;
      } else if (i === this.cursorLine && this.cursorCol >= text.length) {
        display = `${text}\x1b[7m \x1b[0m`;
      }
      // Truncate to width
      if (display.length > innerWidth) display = display.slice(0, innerWidth);
      const placeholder = this.lines.length === 1 && text === "" ? `${C.gray}type a message…${C.R}` : display;
      out.push(`  ${this.lines.length === 1 && text === "" ? placeholder : display}`);
    }
    // Bottom border
    out.push(`${C.border}${"─".repeat(width)}${C.R}`);
    return out;
  }
}

// ─── Footer component ─────────────────────────────────────────────────
class FooterComponent implements Component {
  constructor(private model: string, private tokensIn: number, private tokensOut: number, private cost: number) {}
  setStats(ti: number, to: number, cost: number): void { this.tokensIn = ti; this.tokensOut = to; this.cost = cost; }
  invalidate(): void {}
  render(width: number): string[] {
    let cwd = process.cwd().replace(process.env["HOME"] ?? "", "~");
    let branch = "";
    try { branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf8", timeout: 500, stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch {}
    const left = `${C.gray}${cwd}${C.R}${branch ? ` ${C.green}${branch}${C.R}` : ""}`;
    const right = `${C.accent}${this.model}${C.R} ${C.gray}· ↑${this.tokensIn} ↓${this.tokensOut} · $${this.cost.toFixed(4)}${C.R}`;
    return [`${left}${" ".repeat(Math.max(1, width - left.length - right.length + 20))}${right}`];
  }
}

// ─── Header component ─────────────────────────────────────────────────
class HeaderComponent implements Component {
  invalidate(): void {}
  render(width: number): string[] {
    return [
      `${C.border}${"─".repeat(width)}${C.R}`,
      ` ${C.accent}${C.B}● mya${C.R} ${C.gray}· unified agent${C.R}`,
      ` ${C.gray}Ctrl-C abort · Ctrl-D exit · / for commands${C.R}`,
      `${C.border}${"─".repeat(width)}${C.R}`,
    ];
  }
}

/** Shows a subtle hint when chat is empty. */
class WelcomeComponent implements Component {
  invalidate(): void {}
  render(width: number): string[] {
    return [
      ``,
      `  ${C.gray}Welcome. Type a message below and press Enter.${C.R}`,
      `  ${C.gray}Use / for slash commands.↑↓ for history.${C.R}`,
      ``,
    ];
  }
}

// ─── Interactive TUI Application ──────────────────────────────────────
export interface InteractiveTuiOpts {
  onPrompt: (text: string, onEvent: (event: unknown) => void) => Promise<void>;
  onCancel: () => void;
  model?: string;
}

export function runInteractiveTui(opts: InteractiveTuiOpts): Promise<void> {
  return new Promise((resolve) => {
    const terminal = new Terminal();
    const ui = new TUI(terminal);

    // Component tree
    const header = new HeaderComponent();
    const chat = new Container();
    const statusSlot = new Container(); // spinner goes here when active
    const editor = new EditorComponent();
    const footer = new FooterComponent(opts.model ?? "MiniMax-M3", 0, 0, 0);

    ui.addChild(header);     // 4 lines
    const welcome = new WelcomeComponent();
    ui.addChild(welcome);    // hint when empty
    ui.addChild(chat);       // variable (grows with conversation)
    ui.addChild(statusSlot); // 0-1 lines (spinner)
    // DynamicFill: fills remaining space to pin editor + footer to the bottom
    const fill = new DynamicFill(
      () => terminal.rows,
      () => header.render(80).length + chat.render(80).length + statusSlot.render(80).length + editor.render(80).length + footer.render(80).length,
    );
    ui.addChild(fill);
    ui.addChild(editor);     // 3 lines (border + input + border)
    ui.addChild(footer);     // 1 line

    let busy = false;
    let tokensIn = 0, tokensOut = 0, cost = 0;
    let spinner: SpinnerComponent | null = null;

    // Editor submit handler
    // Commit old chat messages to scrollback when chat exceeds visible space.
    // This pins header at top + editor/footer at bottom — old chat scrolls up.
    const commitChatOverflow = () => {
      const termH = terminal.rows;
      const headerH = header.render(80).length;
      const editorH = editor.render(80).length;
      const footerH = footer.render(80).length;
      const statusH = statusSlot.render(80).length;
      const maxChat = Math.max(1, termH - headerH - editorH - footerH - statusH - 1);
      const chatChildren = (chat as unknown as { children: Component[] }).children;
      while (chatChildren.length > 0) {
        const chatH = chat.render(80).length;
        if (chatH <= maxChat) break;
        // Commit oldest message to scrollback (permanent)
        const oldest = chatChildren[0];
        if (!oldest) break;
        const lines = oldest.render(80);
        for (const line of lines) {
          process.stdout.write(line + "\x1b[0m\n");
        }
        chat.removeChild(oldest);
      }
    };
    let welcomeShown = true;
    editor.onSubmit = (text) => {
      if (busy) return;
      if (welcomeShown) { ui.removeChild(welcome); welcomeShown = false; }
      busy = true;
      chat.addChild(new MessageComponent({ role: "user", text }));
      commitChatOverflow();
      ui.forceFullRedraw();

      // Start spinner
      spinner = new SpinnerComponent("thinking…", () => ui.requestRender());
      statusSlot.addChild(spinner);
      spinner.start();
      ui.requestRender();

      // Run the agent
      void opts.onPrompt(text, (event) => {
        const e = event as { kind?: string; turnEvent?: { state?: string; chunk?: { kind?: string; text?: string; call?: { name?: string; arguments?: unknown } }; usage?: { input?: number; output?: number } } };
        if (!e) return;
        if (e.kind === "turn") {
          const te = e.turnEvent;
          if (!te) return;
          if (te.state === "Streaming" && te.chunk?.kind === "text") {
            // Accumulate streaming text into a single assistant message
            const lastMsg = chat["children"][chat["children"].length - 1];
            if (lastMsg instanceof MessageComponent && (lastMsg as { msg: Message }).msg.role === "assistant") {
              (lastMsg as { msg: Message }).msg.text += te.chunk.text ?? "";
              (lastMsg as unknown as { invalidate: () => void }).invalidate();
            } else {
              chat.addChild(new MessageComponent({ role: "assistant", text: te.chunk.text ?? "" }));
            }
            commitChatOverflow();
            ui.forceFullRedraw();
          } else if (te.state === "ToolCalls" && te.chunk?.kind === "tool_call") {
            const name = te.chunk.call?.name ?? "?";
            const args = te.chunk.call?.arguments as Record<string, unknown> | undefined;
            const detail = name === "bash" && args?.command ? `$ ${args.command}` : args ? JSON.stringify(args).slice(0, 80) : "";
            chat.addChild(new MessageComponent({ role: "tool", text: detail, toolName: name }));
            ui.requestRender();
          } else if (te.state === "Completed") {
            tokensIn += te.usage?.input ?? 0;
            tokensOut += te.usage?.output ?? 0;
            footer.setStats(tokensIn, tokensOut, cost);
            ui.requestRender();
          }
        }
      }).then(() => {
        // Stop spinner
        if (spinner) { spinner.stop(); statusSlot.removeChild(spinner); spinner = null; }
        busy = false;
        ui.forceFullRedraw();
      }).catch((err) => {
        chat.addChild(new MessageComponent({ role: "error", text: String(err) }));
        if (spinner) { spinner.stop(); statusSlot.removeChild(spinner); spinner = null; }
        busy = false;
        ui.forceFullRedraw();
      });
    };

    // Input handler (raw mode) — split multi-char data into individual keys
    const onInput = (data: string) => {
      for (const ch of data) {
        // Ctrl-C: abort or exit
        if (ch === "\x03") {
          if (busy) { opts.onCancel(); }
          else { ui.stop(); process.stdout.write(`\n${C.gray}bye${C.R}\n`); resolve(); }
          return;
        }
        // Ctrl-D: exit
        if (ch === "\x04") {
          ui.stop(); process.stdout.write(`\n${C.gray}bye${C.R}\n`); resolve();
          return;
        }
        // Forward each character to editor
        editor.handleInput(ch);
      }
      ui.requestRender();
    };

    // Start the TUI
    ui.start(onInput);
  });
}
