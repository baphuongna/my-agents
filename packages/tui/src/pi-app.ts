/**
 * Pi-quality TUI using @earendil-works/pi-tui + exact pi theme colors.
 *
 * Component construction follows pi-coding-agent's interactive mode:
 *   - UserMessage: Box(paddingX=1, paddingY=1, bg=userMsgBg) containing Markdown
 *   - AssistantMessage: Container with Spacer(1) + Markdown(paddingX=1)
 *   - Footer: 2-line with cwd/branch + model/tokens/context%
 *   - Status: Loader with braille spinner + cancel support
 *   - Editor: pi-tui Editor (multi-line, arrow keys, scroll indicators)
 */

import {
  ProcessTerminal,
  TUI,
  Container,
  Text,
  Spacer,
  Box,
  Editor,
  Markdown,
  Loader,
  type Component,
} from "@earendil-works/pi-tui";
import {
  fg, bg, bold, italic, dim,
  piMarkdownTheme, piEditorTheme,
} from "./pi-theme-ansi.js";

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

  // ── Header (pi-style: version + keybinding hints) ──
  const header = new Container();
  header.addChild(new Text(
    `${fg("accent", bold("mya"))} ${dim("v0.1.0")}`,
  ));
  header.addChild(new Text(
    `${dim("Esc interrupt · Ctrl-C clear/exit · / commands · ! bash · Tab more")}`,
  ));
  header.addChild(new Text(
    `${dim("Type a message below. mya can explain its own features.")}`,
  ));
  tui.addChild(header);
  tui.addChild(new Spacer(1));

  // ── Chat container ──
  const chat = new Container();
  tui.addChild(chat);

  // ── Status (spinner) ──
  const statusContainer = new Container();
  tui.addChild(statusContainer);

  // ── Editor ──
  const editor = new Editor(tui, piEditorTheme, { paddingX: 1 });
  editor.onSubmit = (text: string) => {
    if (!busy) handlePrompt(text);
  };
  tui.addChild(editor);
  tui.setFocus(editor);

  // ── Footer ──
  const footerContainer = new Container();
  const footerLine1 = new Text(formatFooterLine1(opts.getCwd?.() ?? process.cwd(), opts.getBranch?.() ?? ""));
  const footerLine2 = new Text(formatFooterLine2(opts.getModel?.() ?? "MiniMax-M3", 0, 0, 0, 0));
  footerContainer.addChild(footerLine1);
  footerContainer.addChild(footerLine2);
  tui.addChild(footerContainer);

  // ── State ──
  let busy = false;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let submitAt: number | null = null;
  let spinner: Loader | null = null;
  let durationTimer: ReturnType<typeof setInterval> | null = null;
  let rawAssistantText = "";

  function updateFooter(): void {
    const dur = submitAt !== null ? Math.max(0, Math.round((Date.now() - submitAt) / 1000)) : 0;
    footerLine1.setText(formatFooterLine1(opts.getCwd?.() ?? process.cwd(), opts.getBranch?.() ?? ""));
    footerLine2.setText(formatFooterLine2(opts.getModel?.() ?? "MiniMax-M3", tokensIn, tokensOut, cost, dur));
    tui.requestRender();
  }

  function handlePrompt(text: string): void {
    busy = true;
    rawAssistantText = "";

    // Clear welcome if present (first message)
    if (chat["children"].length > 0 && chat["children"].length <= 2) {
      chat.clear();
    }

    // ── User message: Box with userMsgBg background (pi pattern) ──
    const userBox = new Box(1, 1, (t) => bg("userMsgBg", t));
    userBox.addChild(new Markdown(text, 0, 0, piMarkdownTheme, {
      color: (t) => fg("text", t),
      bold: true,
    }));
    chat.addChild(userBox);
    chat.addChild(new Spacer(1));

    // ── Start spinner ──
    submitAt = Date.now();
    spinner = new Loader(
      tui,
      (s) => fg("accent", s),
      (s) => dim(s),
      "Working...",
    );
    statusContainer.addChild(spinner);
    spinner.start();

    durationTimer = setInterval(updateFooter, 1000);
    updateFooter();
    tui.requestRender();

    // ── Run agent ──
    void opts.onPrompt(text, (event) => {
      const e = event as {
        kind?: string;
        turnEvent?: {
          state?: string;
          chunk?: { kind?: string; text?: string };
          calls?: Array<{ id?: string; name?: string; args?: unknown; arguments?: unknown }>;
          result?: Array<{ callId: string; ok: boolean }> | { results: Array<{ callId: string; ok: boolean }> };
          usage?: { input?: number; output?: number };
        };
      };
      if (!e || e.kind !== "turn") return;
      const te = e.turnEvent;
      if (!te) return;

      if (te.state === "Streaming" && te.chunk?.kind === "text") {
        rawAssistantText += te.chunk.text ?? "";
        const display = stripThinking(rawAssistantText);
        // Find or create the assistant Markdown component
        const children = chat["children"] as Component[];
        const last = children[children.length - 1];
        if (last instanceof Markdown) {
          last.setText(display);
        } else if (display.trim()) {
          chat.addChild(new Spacer(1));
          const md = new Markdown(display, 1, 0, piMarkdownTheme);
          chat.addChild(md);
        }
        tui.requestRender();

      } else if (te.state === "ToolCalls" && te.calls) {
        for (const call of te.calls) {
          const name = call.name ?? "?";
          const args = (call.args ?? call.arguments) as Record<string, unknown> | undefined;
          const detail = name === "bash" && args?.command
            ? `$ ${args.command}`
            : args ? JSON.stringify(args).slice(0, 80) : "";

          // Tool card: Box with toolPendingBg (pi pattern)
          const toolBox = new Box(1, 1, (t) => bg("toolPendingBg", t));
          toolBox.addChild(new Text(
            `${bold(fg("text", name))}${detail ? " " + dim(detail) : ""}`,
          ));
          chat.addChild(new Spacer(1));
          chat.addChild(toolBox);
        }
        tui.requestRender();

      } else if (te.state === "ToolExec" && te.result) {
        const results = Array.isArray(te.result) ? te.result : te.result.results;
        for (const r of results) {
          // Update tool card status (simplified — pi uses background color change)
          const children = chat["children"] as Component[];
          for (const child of children) {
            if (child instanceof Box) {
              const bgColor = r.ok ? "toolSuccessBg" : "toolErrorBg";
              (child as unknown as { setBgFn: (fn: (t: string) => string) => void }).setBgFn(
                (t) => bg(bgColor, t),
              );
            }
          }
        }
        tui.requestRender();

      } else if (te.state === "Completed") {
        tokensIn += te.usage?.input ?? 0;
        tokensOut += te.usage?.output ?? 0;
        updateFooter();
      }
    }).then(() => {
      busy = false;
      if (spinner) { spinner.stop(); statusContainer.removeChild(spinner); spinner = null; }
      if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
      submitAt = null;
      updateFooter();
      editor.setText("");
      tui.requestRender();
    });
  }

  // ── Input: Ctrl-C/Ctrl-D handling ──
  tui.addInputListener((data: string) => {
    for (const ch of data) {
      const code = ch.charCodeAt(0);
      if (code === 3 && !busy) { tui.stop(); process.exit(0); } // Ctrl-C
      if (code === 4) { tui.stop(); process.exit(0); }           // Ctrl-D
    }
  });

  tui.start();
  tui.requestRender();
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Strip <think>...</think> blocks from streaming text. */
function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  out = out.replace(/<think>[\s\S]*$/g, "");
  return out.trim();
}

/** Footer line 1: cwd (branch) · session (pi pattern). */
function formatFooterLine1(cwd: string, branch: string): string {
  const home = process.env.HOME ?? "";
  const shortCwd = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const branchPart = branch ? ` (${fg("green", branch)})` : "";
  return dim(shortCwd + branchPart);
}

/** Footer line 2: context bar + model + tokens + cost (pi pattern). */
function formatFooterLine2(model: string, tokensIn: number, tokensOut: number, cost: number, duration: number): string {
  const left = [
    `↑${formatTokens(tokensIn)}`,
    `↓${formatTokens(tokensOut)}`,
    `$${cost.toFixed(3)}`,
  ].join(" ");

  const dur = duration > 0 ? ` · ${duration}s` : "";
  const right = `${fg("accent", model)}${dur}`;

  return `${dim(left)}   ${right}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.floor(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}
