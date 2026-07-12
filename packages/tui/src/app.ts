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
import { nowMonotonic } from "@my-agent/core";

// ─── ANSI palette (pi-style 256-color, foreground + selected backgrounds) ─
const C = {
  R: "\x1b[0m", B: "\x1b[1m", D: "\x1b[2m", I: "\x1b[3m", U: "\x1b[4m",
  accent: "\x1b[38;5;110m", green: "\x1b[38;5;108m", red: "\x1b[38;5;168m",
  yellow: "\x1b[38;5;179m", gray: "\x1b[38;5;245m", darkgray: "\x1b[38;5;238m",
  blue: "\x1b[38;5;67m", purple: "\x1b[38;5;140m", cyan: "\x1b[38;5;73m",
  border: "\x1b[38;5;239m",
  // Backgrounds — see pi (userBg #343541) and claw-code (\x1b[48;5;236m).
  bg236: "\x1b[48;5;236m",   // dark gray #303030 — user msgs, code blocks, running tools
  bgGreen: "\x1b[48;5;22m",  // dark green — successful tool card fill
  bgRed: "\x1b[48;5;52m",    // dark red — error tool card fill
};

/** Default context-window size for the context-bar percentage. Claude-class. */
const DEFAULT_CONTEXT_LIMIT = 200_000;

/** Tool-name → icon table for the tool card header. */
const TOOL_ICON: Record<string, string> = {
  bash: "⌘",
  read: "📄",
  write: "✏️",
  edit: "📝",
  search: "🔎",
  grep: "🔎",
  glob: "📂",
};

/** Visible (non-ANSI) character count. */
function countVisibleChars(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

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

  // --- SINGLE PASS: think-collapse + markdown render ---
  // When <think> is encountered, skip to </think> and emit ONE collapsed line.
  // Then continue rendering regular markdown. This avoids the double-render bug.
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";

    // ── Thinking-block collapse (claw-code pattern) ──
    if (raw.includes("<think>")) {
      let hiddenChars = 0;
      const openIdx = raw.indexOf("<think>");
      const afterOpen = raw.slice(openIdx + 7);
      const closeSameIdx = afterOpen.indexOf("</think>");
      if (closeSameIdx !== -1) {
        // Both on same line — count between them
        hiddenChars = countVisibleChars(afterOpen.slice(0, closeSameIdx));
        out.push(`  ${C.darkgray}▶ Thinking (${hiddenChars} chars hidden)${C.R}`);
        i++;
        continue;
      } else {
        // Multi-line: count rest of open line, then consume until </think>
        hiddenChars += countVisibleChars(afterOpen);
        i++;
        while (i < lines.length) {
          const inner = lines[i] ?? "";
          const ci = inner.indexOf("</think>");
          if (ci !== -1) {
            hiddenChars += countVisibleChars(inner.slice(0, ci));
            break;
          }
          hiddenChars += countVisibleChars(inner) + 1;
          i++;
        }
        out.push(`  ${C.darkgray}▶ Thinking (${hiddenChars} chars hidden)${C.R}`);
        i++;
        continue;
      }
    }

    // Skip stray </think> (shouldn't happen, but defensive)
    if (raw.includes("</think>")) { i++; continue; }

    let ml = raw.replace(/<\/?think>/g, "");

    if (ml.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        const lang = ml.slice(3).trim();
        const label = lang || "code";
        const borderW = Math.max(0, width - label.length - 8);
        out.push(`${C.border}╭${C.gray}─ ${label} ${C.border}${"─".repeat(borderW)}╮${C.R}`);
        i++;
        continue;
      } else {
        inCodeBlock = false;
        out.push(`${C.border}╰${"─".repeat(Math.max(0, width - 4))}╯${C.R}`);
        i++;
        continue;
      }
    }
    if (inCodeBlock) {
      // Background fill on every code line. Re-assert bg after every ${C.R}
      // so the reset doesn't punch a hole in the card. Word-wrap inside code
      // blocks (rare, but possible when width shrinks after rendering) also
      // re-asserts bg per wrapped sub-line.
      const bodyWidth = Math.max(1, width - 4);
      const codeInner = ml.length > bodyWidth ? ml.slice(0, bodyWidth) : ml;
      const pad = " ".repeat(Math.max(0, bodyWidth - countVisibleChars(codeInner)));
      out.push(`${C.bg236}${C.cyan}  ${codeInner}${C.bg236}${pad}${C.R}`);
      i++;
      continue;
    }

    if (/^###\s/.test(ml)) { out.push(`${C.yellow}${C.B}${ml.replace(/^###\s/, "")}${C.R}`); i++; continue; }
    if (/^##\s/.test(ml))  { out.push(`${C.yellow}${C.B}${ml.replace(/^##\s/, "")}${C.R}`); i++; continue; }
    if (/^#\s/.test(ml))   { out.push(`${C.yellow}${C.B}${C.U}${ml.replace(/^#\s/, "")}${C.R}`); i++; continue; }
    if (/^---+$/.test(ml.trim())) { out.push(`${C.border}${"─".repeat(width)}${C.R}`); i++; continue; }

    // Blockquote gutter (pi/claw-code/hermes pattern)
    if (ml.startsWith(">")) {
      const inner = ml.replace(/^>\s?/, "");
      const body = `${C.gray}${C.I}${inner}${C.R}`;
      const bodyWidth = Math.max(1, width - 4);
      const padLen = Math.max(0, bodyWidth - countVisibleChars(inner));
      out.push(`${C.border}│ ${C.R}${body}${" ".repeat(padLen)}`);
      i++;
      continue;
    }

    if (/^\s*[-*]\s/.test(ml)) ml = ml.replace(/^(\s*)[-*]\s/, `$1${C.accent}● ${C.R}`);
    ml = ml.replace(/\*\*(.+?)\*\*/g, `${C.B}$1${C.R}`);
    ml = ml.replace(/`([^`]+)`/g, `${C.cyan}$1${C.R}`);
    // Word wrap: don't break mid-word (strip ANSI for width calculation)
    const visibleLen = countVisibleChars(ml);
    if (visibleLen > width - 2) {
      const words = ml.split(" ");
      let cur = "";
      for (const w of words) {
        const testLen = countVisibleChars((cur + " " + w).trimStart());
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
    i++;
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
      // Feature 1a: pad the entire user line to terminal width with bg236.
      const line = `${C.green}${C.B}▶ you${C.R} ${m.text}`;
      const padLen = Math.max(0, width - countVisibleChars(line));
      return [
        ``,
        `${C.bg236}${line}${" ".repeat(padLen)}${C.R}`,
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

// ─── Tool card component (claw-code pattern) ──────────────────────────
type ToolStatus = "running" | "success" | "error";
class ToolCardComponent implements Component {
  constructor(
    public toolName: string,
    public detail: string,
    public status: ToolStatus = "running",
  ) {}
  invalidate(): void {}
  setStatus(s: ToolStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.invalidate();
    }
  }
  render(width: number): string[] {
    const icon = TOOL_ICON[this.toolName] ?? "🔧";
    const statusGlyph =
      this.status === "success" ? `${C.green}✓${C.R}` :
      this.status === "error"   ? `${C.red}✗${C.R}` :
      "";
    // Background by status
    const bg =
      this.status === "success" ? C.bgGreen :
      this.status === "error"   ? C.bgRed :
      C.bg236;

    // Header: ╭─ {status} {icon} {name} ─…─╮
    const headerInner = `─ ${statusGlyph ? statusGlyph + " " : ""}${icon} ${this.toolName} `;
    const headerVisibleLen = countVisibleChars(headerInner) + 2; // +2 for the leading "╭" and trailing "╮"
    const fillCount = Math.max(0, width - headerVisibleLen - 2); // -2 for the "╭" + "╮"
    const header = `${C.border}╭${headerInner}${C.border}${"─".repeat(fillCount)}╮${C.R}`;

    // Body: 1–N lines, each prefixed `│ ` and padded to (width - 4) so the
    // status background fills the full card width.
    const bodyInnerWidth = Math.max(1, width - 4);
    const bodyLines = this.detail === "" ? ["(no detail)"] : this.detail.split("\n");
    const bodyOut: string[] = [];
    for (const bl of bodyLines) {
      // Wrap long body lines to bodyInnerWidth (ANSI-stripped word-wrap).
      const words = bl.split(" ");
      let cur = "";
      for (const w of words) {
        const testLen = countVisibleChars(cur + (cur ? " " : "") + w);
        if (testLen > bodyInnerWidth && cur) {
          bodyOut.push(cur);
          cur = w;
        } else {
          cur = cur ? cur + " " + w : w;
        }
      }
      if (cur) bodyOut.push(cur);
      if (bodyOut.length === 0) bodyOut.push("");
    }
    const bodyRendered: string[] = bodyOut.map((line) => {
      const visibleLen = countVisibleChars(line);
      const padLen = Math.max(0, bodyInnerWidth - visibleLen);
      // Continuous bg fill across the entire row: the bg attribute persists
      // through the reset because we re-assert it on the next emit. The `│`
      // separator is colored via ${C.border} but its cell carries the bg fill.
      return `${bg}${C.border}│${C.R}${bg}${C.gray} ${line}${" ".repeat(padLen)}${C.R}`;
    });

    // Bottom border (no bg) — account for 2-space assistant indent
    const bottom = `${C.border}╰${"─".repeat(Math.max(0, width - 4))}╯${C.R}`;

    return [header, ...bodyRendered, bottom];
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

/** ScrollableContainer — limits render output to last N lines (old content scrolls into native scrollback). */
export class ScrollableContainer extends Container {
  private _maxLines = 1000;
  setMaxLines(n: number): void { this._maxLines = n; }
  override render(width: number): string[] {
    const all = super.render(width);
    if (all.length <= this._maxLines) return all;
    return all.slice(all.length - this._maxLines);
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
  constructor(
    private model: string,
    private tokensIn: number,
    private tokensOut: number,
    private cost: number,
  ) {}
  private contextLimit: number = DEFAULT_CONTEXT_LIMIT;
  /** Seconds since submit (null = idle). Drives the trailing "· 12s" segment. */
  private durationSec: number | null = null;

  setStats(ti: number, to: number, cost: number): void {
    this.tokensIn = ti;
    this.tokensOut = to;
    this.cost = cost;
  }
  setContextLimit(limit: number): void {
    if (limit > 0) this.contextLimit = limit;
  }
  setDuration(sec: number | null): void {
    this.durationSec = sec;
  }
  invalidate(): void {}
  render(width: number): string[] {
    let cwd = process.cwd().replace(process.env["HOME"] ?? "", "~");
    let branch = "";
    try { branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf8", timeout: 500, stdio: ["pipe", "pipe", "ignore"] }).trim(); } catch {}

    // ── Line 1: cwd (branch) — branch is green if present, '(detached)' gray otherwise.
    const branchStr = branch
      ? `${C.green}${branch}${C.R}`
      : `${C.gray}(detached)${C.R}`;
    const line1Inner = `${C.gray}${cwd}${C.R} ${branchStr}`;
    const line1Visible = countVisibleChars(line1Inner);
    const line1Pad = Math.max(0, width - line1Visible);
    const line1 = `${line1Inner}${" ".repeat(line1Pad)}`;

    // ── Line 2: context bar + stats.
    const ratio = this.contextLimit > 0 ? this.tokensIn / this.contextLimit : 0;
    const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
    const empty = 10 - filled;
    const pct = Math.round(ratio * 100);
    const barColor = ratio < 0.5 ? C.green : ratio < 0.8 ? C.yellow : C.red;
    const bar = `${barColor}[${"█".repeat(filled)}${"░".repeat(empty)}]${C.R}`;

    const fmtToken = (n: number): string => {
      if (n < 1000) return `${n}`;
      if (n < 10_000) {
        const k = (n / 1000).toFixed(1);
        return `${k.endsWith(".0") ? k.slice(0, -2) : k}k`;
      }
      if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
      return `${(n / 1_000_000).toFixed(1)}M`;
    };

    const stats =
      `${C.gray}· ${this.model} · ↑${fmtToken(this.tokensIn)} ↓${fmtToken(this.tokensOut)} · $${this.cost.toFixed(4)}` +
      (this.durationSec !== null ? ` · ${this.durationSec}s` : "") +
      `${C.R}`;

    const line2Inner = `${bar} ${pct}%${stats}`;
    const line2Visible = countVisibleChars(line2Inner);
    const line2Pad = Math.max(0, width - line2Visible);
    const line2 = `${line2Inner}${C.darkgray}${" ".repeat(line2Pad)}${C.R}`;

    return [line1, line2];
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
    const chat = new ScrollableContainer();
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
    /** Monotonic ms when the current turn was submitted (null = idle). */
    let submitAt: number | null = null;
    /** callId → ToolCardComponent for status updates from ToolExec events. */
    const toolCards = new Map<string, ToolCardComponent>();

    // Editor submit handler
    // Set chat max height = terminal - header - editor - footer - status - 1
    const updateChatMax = () => {
      const termH = terminal.rows;
      const headerH = header.render(80).length;
      const editorH = editor.render(80).length;
      const footerH = footer.render(80).length;
      chat.setMaxLines(Math.max(1, termH - headerH - editorH - footerH - 1));
    };
    updateChatMax();
    process.stdout.on("resize", updateChatMax);

    // Commit old chat messages to scrollback when chat exceeds visible space.
    const commitChatOverflow = () => {
      updateChatMax();
      const chatChildren = (chat as unknown as { children: Component[] }).children;
      while (chatChildren.length > 0) {
        const chatH = chat.render(80).length;
        const maxChat = (chat as unknown as { _maxLines: number })._maxLines;
        if (chatH <= maxChat) break;
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

      // Start spinner + duration timer (monotonic ms from core.time)
      submitAt = nowMonotonic();
      footer.setDuration(0);
      spinner = new SpinnerComponent("thinking…", () => {
        // Tick the footer duration while we wait for the turn to complete.
        if (submitAt !== null) {
          footer.setDuration(Math.max(0, Math.round((nowMonotonic() - submitAt) / 1000)));
        }
        ui.requestRender();
      });
      statusSlot.addChild(spinner);
      spinner.start();
      ui.requestRender();

      // Run the agent
      void opts.onPrompt(text, (event) => {
        const e = event as {
          kind?: string;
          turnEvent?: {
            state?: string;
            chunk?: { kind?: string; text?: string; call?: { name?: string; arguments?: unknown } };
            calls?: Array<{ id?: string; name?: string; args?: unknown; arguments?: unknown }>;
            result?: Array<{ callId: string; ok: boolean; output?: unknown; error?: string }> | { results: Array<{ callId: string; ok: boolean; output?: unknown; error?: string }>; failedCallIds: string[] };
            usage?: { input?: number; output?: number };
          };
        };
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
          } else if (te.state === "ToolCalls" && te.calls && te.calls.length > 0) {
            // Render each tool call as a ToolCardComponent keyed by callId so
            // the matching ToolExec event can flip its status to ✓/✗.
            for (const call of te.calls) {
              const name = call.name ?? "?";
              const args = (call.args ?? call.arguments) as Record<string, unknown> | undefined;
              const detail =
                name === "bash" && args?.command
                  ? `$ ${args.command}`
                  : args
                  ? JSON.stringify(args).slice(0, 80)
                  : "";
              const card = new ToolCardComponent(name, detail, "running");
              if (call.id) toolCards.set(call.id, card);
              chat.addChild(card);
            }
            commitChatOverflow();
            ui.requestRender();
          } else if (te.state === "ToolExec" && te.result) {
            // Tool-result event: flip each matching tool card to success/error.
            // Result is either ToolResult[] or a DegradedResult wrapper.
            const results = Array.isArray(te.result)
              ? te.result
              : te.result.results;
            let anyUpdated = false;
            for (const r of results) {
              const card = toolCards.get(r.callId);
              if (!card) continue;
              card.setStatus(r.ok ? "success" : "error");
              anyUpdated = true;
            }
            if (anyUpdated) ui.forceFullRedraw();
          } else if (te.state === "Completed") {
            tokensIn += te.usage?.input ?? 0;
            tokensOut += te.usage?.output ?? 0;
            // Fallback: if a per-tool ToolExec event never arrived, flip any
            // still-running cards to 'success' on turn completion (best-effort).
            for (const card of toolCards.values()) {
              if (card.status === "running") card.setStatus("success");
            }
            footer.setStats(tokensIn, tokensOut, cost);
            // Freeze the duration reading, then clear the spinner on the next tick.
            if (submitAt !== null) {
              const elapsedSec = Math.max(0, Math.round((nowMonotonic() - submitAt) / 1000));
              footer.setDuration(elapsedSec);
            }
            ui.forceFullRedraw();
          }
        }
      }).then(() => {
        // Stop spinner
        if (spinner) { spinner.stop(); statusSlot.removeChild(spinner); spinner = null; }
        // Snapshot the duration and clear submitAt so subsequent renders are stable.
        if (submitAt !== null) {
          const elapsedSec = Math.max(0, Math.round((nowMonotonic() - submitAt) / 1000));
          footer.setDuration(elapsedSec);
          submitAt = null;
        }
        busy = false;
        ui.forceFullRedraw();
      }).catch((err) => {
        chat.addChild(new MessageComponent({ role: "error", text: String(err) }));
        if (spinner) { spinner.stop(); statusSlot.removeChild(spinner); spinner = null; }
        if (submitAt !== null) {
          const elapsedSec = Math.max(0, Math.round((nowMonotonic() - submitAt) / 1000));
          footer.setDuration(elapsedSec);
          submitAt = null;
        }
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
