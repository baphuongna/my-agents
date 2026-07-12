/**
 * pi-tui based interactive TUI — uses @earendil-works/pi-tui directly.
 *
 * This gives us pi's actual rendering engine:
 *   - ProcessTerminal: raw mode, bracketed paste, cursor hide, Kitty keyboard
 *   - TUI: differential frame-buffer renderer (synchronized output, no flicker)
 *   - Editor: multi-line, arrow keys, scroll indicators, emacs keybindings
 *   - Markdown: full parser + syntax highlighting + tables + blockquote gutters
 *   - Box: background-filled containers with padding
 *   - Loader: braille spinner with configurable frames/colors
 */

import {
  ProcessTerminal,
  TUI,
  Container,
  Text,
  Spacer,
  Box,
  Editor,
  type EditorTheme,
  Markdown,
  type MarkdownTheme,
  Loader,
  Key,
  parseKey,
  type Component,
} from "@earendil-works/pi-tui";

// ─── Theme (ANSI color functions matching pi dark theme) ──────────────
const fg = (code: string, text: string) => `\x1b[${code}m${text}\x1b[39m`;
const bg = (code: string, text: string) => `\x1b[${code}m${text}\x1b[49m`;
const style = (code: string, text: string) => `\x1b[${code}m${text}\x1b[0m`;

const COLORS = {
  accent: (t: string) => fg("38;5;110", t),    // blue-cyan
  green: (t: string) => fg("38;5;108", t),     // success
  yellow: (t: string) => fg("38;5;179", t),    // headings
  gray: (t: string) => fg("38;5;245", t),      // muted
  darkgray: (t: string) => fg("38;5;238", t),  // thinking
  red: (t: string) => fg("38;5;168", t),       // error
  cyan: (t: string) => fg("38;5;73", t),       // code
  border: (t: string) => fg("38;5;239", t),    // borders
  purple: (t: string) => fg("38;5;140", t),    // tools
  userBg: (t: string) => bg("48;5;236", t),    // user message background
  bold: (t: string) => style("1", t),
  italic: (t: string) => style("3", t),
  underline: (t: string) => style("4", t),
  dim: (t: string) => style("2", t),
};

const mdTheme: MarkdownTheme = {
  heading: (t) => COLORS.yellow(COLORS.bold(t)),
  link: (t) => COLORS.accent(COLORS.underline(t)),
  linkUrl: (t) => COLORS.gray(t),
  code: (t) => COLORS.cyan(t),
  codeBlock: (t) => COLORS.green(t),
  codeBlockBorder: (t) => COLORS.gray(t),
  quote: (t) => COLORS.gray(COLORS.italic(t)),
  quoteBorder: (t) => COLORS.border(t),
  hr: (t) => COLORS.border(t),
  listBullet: (t) => COLORS.accent(t),
  bold: (t) => COLORS.bold(t),
  italic: (t) => COLORS.italic(t),
  strikethrough: (t) => style("9", t),
  underline: (t) => COLORS.underline(t),
};

const editorTheme: EditorTheme = {
  borderColor: (t: string) => COLORS.border(t),
  selectList: {
    selectedPrefix: (t: string) => COLORS.accent(t),
    selectedText: (t: string) => COLORS.bold(t),
    description: (t: string) => COLORS.gray(t),
    scrollInfo: (t: string) => COLORS.gray(t),
    noMatch: (t: string) => COLORS.gray(t),
  },
};

// ─── Interactive TUI ──────────────────────────────────────────────────
export interface InteractiveTuiOptions {
  onPrompt: (text: string, onEvent: (event: unknown) => void) => Promise<void>;
  getModel?: () => string;
  getCwd?: () => string;
  getBranch?: () => string;
}

export async function runPiTui(opts: InteractiveTuiOptions): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // ── Header ──
  const header = new Container();
  header.addChild(new Text(
    `${COLORS.accent(COLORS.bold("● mya"))} ${COLORS.gray("· unified agent")}`,
  ));
  header.addChild(new Text(
    `${COLORS.gray("Ctrl-C abort · Ctrl-D exit · / for commands · ↑↓ history")}`,
  ));
  tui.addChild(header);

  // ── Chat (scrollable message history) ──
  const chat = new Container();
  tui.addChild(chat);

  // ── Status (spinner area) ──
  const statusContainer = new Container();
  tui.addChild(statusContainer);

  // ── Editor ──
  const editor = new Editor(tui, editorTheme, { paddingX: 0 });
  editor.onSubmit = (text: string) => {
    if (busy) return;
    handlePrompt(text);
  };
  tui.addChild(editor);
  tui.setFocus(editor);

  // ── Footer ──
  const footer = new Container();
  const footerText = new Text(
    formatFooter(opts.getCwd?.() ?? process.cwd(), opts.getBranch?.() ?? "", opts.getModel?.() ?? "MiniMax-M3", 0, 0, 0, 0),
  );
  footer.addChild(footerText);
  tui.addChild(footer);

  // ── Welcome message ──
  chat.addChild(new Text(COLORS.gray("Welcome. Type a message below and press Enter.")));
  chat.addChild(new Text(COLORS.gray("Use / for slash commands.")));

  // ── State ──
  let busy = false;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let submitAt: number | null = null;
  let spinner: Loader | null = null;
  let durationTimer: ReturnType<typeof setInterval> | null = null;
  const toolCards = new Map<string, Container>();
  let rawAssistantText = ""; // Track raw text for think-stripping

  function updateFooter(): void {
    const dur = submitAt !== null
      ? Math.max(0, Math.round((Date.now() - submitAt) / 1000))
      : 0;
    footerText.setText(
      formatFooter(opts.getCwd?.() ?? process.cwd(), opts.getBranch?.() ?? "", opts.getModel?.() ?? "MiniMax-M3", tokensIn, tokensOut, cost, dur),
    );
    tui.requestRender();
  }

  function addSeparator(): void {
    chat.addChild(new Text(COLORS.border("─".repeat(Math.min(80, terminal.columns)))));
  }

  function handlePrompt(text: string): void {
    busy = true;
    rawAssistantText = ""; // Reset for new turn

    // Remove welcome if present
    if (chat["children"].length <= 3) {
      chat.clear();
    }

    // User message in a Box with background
    const userBox = new Box(1, 0, (t) => COLORS.userBg(t));
    userBox.addChild(new Text(`${COLORS.green(COLORS.bold("▶ you"))} ${text}`));
    chat.addChild(userBox);

    addSeparator();

    // Start spinner
    submitAt = Date.now();
    spinner = new Loader(
      tui,
      (s) => COLORS.accent(s),
      (s) => COLORS.gray(s),
      "thinking…",
    );
    statusContainer.addChild(spinner);
    spinner.start();

    // Duration tick
    durationTimer = setInterval(updateFooter, 1000);
    updateFooter();
    tui.requestRender();

    // Run agent
    void opts.onPrompt(text, (event) => {
      const e = event as {
        kind?: string;
        turnEvent?: {
          state?: string;
          chunk?: { kind?: string; text?: string; call?: { name?: string; arguments?: unknown } };
          calls?: Array<{ id?: string; name?: string; args?: unknown; arguments?: unknown }>;
          result?: Array<{ callId: string; ok: boolean; output?: unknown; error?: string }> | { results: Array<{ callId: string; ok: boolean; output?: unknown; error?: string }> };
          usage?: { input?: number; output?: number };
        };
      };
      if (!e || e.kind !== "turn") return;
      const te = e.turnEvent;
      if (!te) return;

      if (te.state === "Streaming" && te.chunk?.kind === "text") {
        // Accumulate RAW text (including <think> tags), then strip for display.
        rawAssistantText += te.chunk.text ?? "";
        const display = stripThinking(rawAssistantText);
        const lastChild = chat["children"][chat["children"].length - 1];
        if (lastChild instanceof Markdown) {
          lastChild.setText(display);
        } else if (display) {
          const md = new Markdown(display, 1, 0, mdTheme);
          chat.addChild(md);
        }
        tui.requestRender();
      } else if (te.state === "ToolCalls" && te.calls) {
        for (const call of te.calls) {
          const name = call.name ?? "?";
          const args = (call.args ?? call.arguments) as Record<string, unknown> | undefined;
          const detail =
            name === "bash" && args?.command ? `$ ${args.command}`
            : args ? JSON.stringify(args).slice(0, 80) : "";
          // Tool card: Box with border-like Text header + body
          const card = new Container();
          card.addChild(new Text(
            `${COLORS.border("╭─")} ${COLORS.purple(name)} ${COLORS.gray(detail)} ${COLORS.border("──")}`,
          ));
          if (call.id) toolCards.set(call.id, card);
          chat.addChild(card);
        }
        tui.requestRender();
      } else if (te.state === "ToolExec" && te.result) {
        const results = Array.isArray(te.result) ? te.result : te.result.results;
        for (const r of results) {
          const card = toolCards.get(r.callId);
          if (card) {
            const icon = r.ok ? COLORS.green("✓") : COLORS.red("✗");
            const firstChild = card["children"][0];
            if (firstChild instanceof Text) {
              const oldText = (firstChild as unknown as { text: string }).text;
              (firstChild as unknown as { setText: (t: string) => void }).setText(
                oldText.replace("╭─", `╭─ ${icon}`),
              );
            }
          }
        }
        tui.requestRender();
      } else if (te.state === "Completed") {
        tokensIn += te.usage?.input ?? 0;
        tokensOut += te.usage?.output ?? 0;
        updateFooter();
        tui.requestRender();
      }
    }).then(() => {
      busy = false;
      if (spinner) { spinner.stop(); statusContainer.removeChild(spinner); spinner = null; }
      if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
      if (submitAt !== null) {
        const dur = Math.max(0, Math.round((Date.now() - submitAt) / 1000));
        submitAt = null;
        footerText.setText(
          formatFooter(opts.getCwd?.() ?? process.cwd(), opts.getBranch?.() ?? "", opts.getModel?.() ?? "MiniMax-M3", tokensIn, tokensOut, cost, dur),
        );
      }
      editor.setText("");
      tui.requestRender();
    });
  }

  // ── Input handling via TUI (not terminal.start — TUI handles that) ──
  tui.addInputListener((data: string) => {
    for (const ch of data) {
      const code = ch.charCodeAt(0);
      // Ctrl-C (3) = exit if not busy
      if (code === 3) {
        if (!busy) { tui.stop(); process.exit(0); }
      }
      // Ctrl-D (4) = exit
      if (code === 4) {
        tui.stop();
        process.exit(0);
      }
    }
  });

  // Start rendering — TUI internally calls terminal.start() with its own
  // input routing that dispatches to the focused Editor.
  tui.start();
  tui.requestRender();
}

// ─── Footer formatting ────────────────────────────────────────────────────

/** Strip <think>...</think> blocks from text. Returns visible text only. */
function stripThinking(text: string): string {
  // Remove completed think blocks
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Remove unterminated think block (streaming — still open)
  out = out.replace(/<think>[\s\S]*$/g, "");
  return out.trim();
}

function formatFooter(
  cwd: string,
  branch: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  cost: number,
  duration: number,
): string {
  const home = process.env.HOME ?? "";
  const shortCwd = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const left = `${COLORS.gray(shortCwd)}${branch ? " " + COLORS.green(branch) : ""}`;
  const compactIn = formatTokens(tokensIn);
  const compactOut = formatTokens(tokensOut);
  const right = `${COLORS.accent(model)} ${COLORS.gray(`· ↑${compactIn} ↓${compactOut} · $${cost.toFixed(4)}${duration > 0 ? ` · ${duration}s` : ""}`)}`;
  return `${left}  ${right}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.floor(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}
