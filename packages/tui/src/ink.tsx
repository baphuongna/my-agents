/**
 * @my-agent/tui/ink — the full Ink/React TUI (§25.1).
 *
 * The TuiRepl (transport) is a line-based REPL over the RuntimeEvent bus. This
 * module is the React/Ink component layer that sits on top: a live turn stream,
 * a status pill, and an approval prompt — all driven by the typed RuntimeEvent
 * bus (invariant #11). Themes/keybindings/slash-commands layer on top of this.
 *
 * Source: §25.1 TUI/CLI (Ink/React, themes, namespaced keybindings); pi/oh-my-pi.
 */
import React, { useState, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";


export interface InkTurnLine {
  seq: number;
  text: string;
  kind?: string;
}

export interface InkDashboardProps {
  lines: InkTurnLine[];
  status: "live" | "connecting" | "error";
  /** A pending approval request (null if none). */
  approval: { call: string; reason: string } | null;
  onApproval?: (decision: "Allow" | "Deny") => void;
  /** Ctrl-C handler (abort turn / exit). */
  onAbort?: () => void;
}

/** A 51-token-ish theme (§25.1 token-driven theming — minimal default). */
export const defaultTheme = {
  text: "white",
  meta: "gray",
  accent: "cyan",
  warn: "yellow",
  error: "red",
  ok: "green",
} as const;

/** The dashboard component. */
export function Dashboard({ lines, status, approval, onApproval, onAbort }: InkDashboardProps): React.ReactElement {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (onAbort) onAbort();
      else exit();
    }
    if (approval && onApproval) {
      if (input === "y") onApproval("Allow");
      else if (input === "n") onApproval("Deny");
    }
  });

  const statusColor =
    status === "live" ? defaultTheme.ok : status === "error" ? defaultTheme.error : defaultTheme.warn;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={defaultTheme.accent}> agent </Text>
        <Text color={statusColor}> [{status}] </Text>
        <Text color={defaultTheme.meta}> {lines.length} events</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((l) => (
          <Text key={l.seq} color={l.kind === "error" ? defaultTheme.error : defaultTheme.text}>
            {l.text}
          </Text>
        ))}
      </Box>
      {approval && (
        <Box marginTop={1} borderStyle="round" borderColor={defaultTheme.warn} flexDirection="column">
          <Text color={defaultTheme.warn}>approval: {approval.call}</Text>
          <Text color={defaultTheme.meta}>{approval.reason}</Text>
          <Text>[y] allow  [n] deny</Text>
        </Box>
      )}
      <Text color={defaultTheme.meta} dimColor>
        {" "}
        ctrl-c abort · {approval ? "y/n approve" : ""}
      </Text>
    </Box>
  );
}

/** Convenience: render the dashboard to a string (for testing / snapshot).
 * Async because ink-testing-library is loaded via dynamic import (ESM/CJS
 * interop — sync require() hits a top-level-await graph). */
export async function renderDashboardOnce(props: InkDashboardProps): Promise<string> {
  try {
    const testing = (await import("ink-testing-library")) as {
      render: (node: React.ReactElement) => { lastFrame: () => string };
    };
    const { lastFrame } = testing.render(<Dashboard {...props} />);
    return lastFrame();
  } catch {
    const { unmount } = render(<Dashboard {...props} />);
    unmount();
    return "[ink dashboard rendered]";
  }
}

/** A hook-free helper to push a RuntimeEvent into InkTurnLine[] (the component's
 * stream state). Returns a new array (immutable). */
export function eventToLine(seq: number, event: unknown): InkTurnLine | null {
  const e = event as { kind?: string; e?: { state?: string; chunk?: { kind?: string; text?: string } }; call?: { name?: string }; reason?: string };
  if (e?.kind === "turn" && e.e?.state === "Streaming" && e.e.chunk?.kind === "text") {
    return { seq, text: e.e.chunk.text ?? "", kind: "text" };
  }
  if (e?.kind === "turn" && e.e?.state === "Completed") {
    return { seq, text: "[completed]", kind: "ok" };
  }
  if (e?.kind === "log") {
    return null; // suppress unless warn
  }
  return null;
}

/** React hook form for an interactive session (push events, drive state). */
export function useDashboardState() {
  const [lines, setLines] = useState<InkTurnLine[]>([]);
  const [status, setStatus] = useState<"live" | "connecting" | "error">("connecting");
  const push = useCallback((seq: number, event: unknown) => {
    const line = eventToLine(seq, event);
    if (line) setLines((prev) => [...prev, line]);
  }, []);
  return { lines, status, setStatus, push };
}
