/**
 * Terminal — xterm.js-backed terminal component (distilled from hermes-agent
 * HermesConsoleModal.tsx, simplified to a presentational component with
 * optional WebSocket protocol).
 *
 * Supports two modes:
 *   - "idle" (no wsUrl): shows a friendly placeholder; user can drop a
 *     wsUrl in to switch to live.
 *   - "live" (wsUrl provided): opens WebSocket, renders ConsoleFrame
 *     discriminated-union protocol (ready/output/error/complete/pong/clear).
 *
 * Out of scope for this distill (deferred to follow-up):
 *   - Persistent PTY child + channel id (hermes ChatPage persistent mount)
 *   - Gateway `/api/console` endpoint
 *   - Profile-keyed console scope
 *   - WebGL renderer + clipboard integration
 */
import { useEffect, useRef } from "react";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

/** ConsoleFrame — wire envelope from the hermes console protocol. */
export type ConsoleFrame =
  | { type: "ready"; profile?: string; prompt?: string }
  | { type: "output"; data?: string; stream?: string }
  | { type: "error"; message?: string }
  | { type: "confirm_required"; command?: string; message?: string; prompt?: string }
  | { type: "complete"; status?: string; prompt?: string }
  | { type: "pong" }
  | { type: "clear" };

interface TerminalProps {
  /** Optional WebSocket URL. If omitted, terminal shows idle placeholder. */
  wsUrl?: string;
  /** Extra class names for the host element. */
  className?: string;
}

function buildTheme() {
  // mya dark theme (matches Terminal.tsx stub aesthetic).
  return {
    background: "#000000",
    foreground: "#f0e6d2",
    cursor: "#f0e6d2",
    cursorAccent: "#000000",
    selectionBackground: "rgba(240, 230, 210, 0.25)",
    black: "#000000",
    red: "#ff5f67",
    green: "#5fffb0",
    yellow: "#ffd166",
    blue: "#7aa2ff",
    magenta: "#d597ff",
    cyan: "#58e6ff",
    white: "#f0e6d2",
    brightBlack: "#666666",
    brightRed: "#ff8b90",
    brightGreen: "#8dffc8",
    brightYellow: "#ffe08a",
    brightBlue: "#9dbaff",
    brightMagenta: "#e4b7ff",
    brightCyan: "#8ef0ff",
    brightWhite: "#ffffff",
  };
}

function normalize(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

function handleFrame(
  term: XtermTerminal,
  frame: ConsoleFrame,
): void {
  switch (frame.type) {
    case "ready":
      term.clear();
      term.write(frame.prompt ?? "mya> ");
      return;
    case "output":
      if (frame.data) term.write(normalize(frame.data));
      return;
    case "error":
      term.write(
        `\r\n\x1b[31m${frame.message ?? "Command failed."}\x1b[0m\r\n`,
      );
      return;
    case "confirm_required":
      if (frame.message) {
        term.write(`\r\n\x1b[33m${frame.message}\x1b[0m\r\n`);
      }
      term.write(frame.prompt ?? "Confirm? [y/N] ");
      return;
    case "complete":
      if (frame.status === "exit") {
        term.write("\r\n\x1b[33m[exit]\x1b[0m\r\n");
        return;
      }
      if (frame.status === "timeout") {
        term.write("\r\n\x1b[31mCommand timed out.\x1b[0m\r\n");
      }
      if (frame.status === "cancelled") {
        term.write("\r\n\x1b[33mCancelled.\x1b[0m\r\n");
      }
      term.write(frame.prompt ?? "mya> ");
      return;
    case "pong":
      return;
    case "clear":
      term.clear();
      return;
    default: {
      const _exhaustive: never = frame;
      void _exhaustive;
    }
  }
}

export function Terminal({ wsUrl, className }: TerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XtermTerminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XtermTerminal({
      allowProposedApi: true, // required for Unicode11Addon in xterm 5.x
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', 'Fira Code', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      macOptionIsMeta: true,
      scrollback: 3000,
      theme: buildTheme(),
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    term.write("\x1b[2mTerminal ready.\x1b[0m\r\n");
    if (!wsUrl) {
      term.write(
        "\x1b[2mPass a `wsUrl` prop to connect to a backend console.\x1b[0m\r\n",
      );
      term.write("\x1b[36mmya> \x1b[0m");
    } else {
      term.write(`\x1b[2mConnecting to ${wsUrl}…\x1b[0m\r\n`);
    }

    let ws: WebSocket | null = null;
    let inputPrompt = "mya> ";
    let lineBuf = "";
    let cancelled = false;
    // True while a command is running (sent, waiting for complete/error).
    // Mirrors hermes activeCommandRef — blocks input so outputs don't interleave.
    let commandActive = false;

    if (wsUrl) {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => term.write("\x1b[32mConnected.\x1b[0m\r\n");
        ws.onmessage = (ev) => {
          try {
            const frame = JSON.parse(String(ev.data)) as ConsoleFrame;
            handleFrame(term, frame);
            if (frame.type === "ready") {
              inputPrompt = frame.prompt ?? "mya> ";
              lineBuf = "";
              commandActive = false;
            }
            if (frame.type === "complete" || frame.type === "error") {
              commandActive = false;
            }
          } catch {
            term.write("\r\n\x1b[31mMalformed frame.\x1b[0m\r\n");
          }
        };
        ws.onerror = () =>
          term.write("\r\n\x1b[31mWebSocket error.\x1b[0m\r\n");
        ws.onclose = (ev) => {
          if (cancelled) return;
          term.write(
            `\r\n\x1b[33mDisconnected (${ev.code}).\x1b[0m\r\n`,
          );
        };
      } catch (err) {
        term.write(`\r\n\x1b[31mConnection failed: ${err}\x1b[0m\r\n`);
      }
    }

    const dataDisp = term.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        term.write("\x07");
        return;
      }
      // Block input while a command is running (mirrors hermes activeCommandRef).
      if (commandActive) {
        term.write("\x07"); // bell
        return;
      }
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          term.write("\r\n");
          const line = lineBuf;
          lineBuf = "";
          try {
            ws.send(JSON.stringify({ type: "input", line }));
            commandActive = true;
          } catch {
            /* socket may have closed mid-send */
          }
          continue;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (lineBuf.length > 0) {
            lineBuf = lineBuf.slice(0, -1);
            term.write("\b \b");
          }
          continue;
        }
        if (ch >= " ") {
          lineBuf += ch;
          term.write(ch);
        }
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* host may be 0×0 during unmount */
      }
    });
    ro.observe(host);
    try {
      fit.fit();
    } catch {
      /* host may not be laid out yet */
    }

    return () => {
      cancelled = true;
      dataDisp.dispose();
      ro.disconnect();
      ws?.close();
      ws = null;
      term.dispose();
      termRef.current = null;
    };
  }, [wsUrl]);

  return (
    <div
      ref={hostRef}
      data-testid="terminal-host"
      className={
        className ??
        "h-full min-h-[280px] w-full overflow-hidden bg-black p-2 [&_.xterm]:h-full"
      }
    />
  );
}

/** Re-export the low-level frame type for callers wiring WS handlers. */
export type { ConsoleFrame as TerminalFrame };
