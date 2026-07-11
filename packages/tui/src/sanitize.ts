/**
 * Phase 25 review fix F1+F2: sanitize assistant/tool text before rendering.
 *
 * Terminal escape sequences (ESC, OSC, CSI) embedded in assistant or
 * tool-call output can clear the screen, move the cursor, fake prompts,
 * or rewrite the window title. This module strips them defensively at
 * every ingress point (pushLine + approval args).
 *
 * The default behavior: drop ALL ANSI escape sequences. We do NOT pass
 * them through because Ink already handles its own coloring; user-content
 * ANSI would only be a vector for prompt-injection attacks.
 */
import stripAnsi from "strip-ansi";

/** Strip ANSI + OSC + DCS + CSI from a string before it reaches Ink. */
export function sanitize(input: string): string {
  if (!input) return input;
  // strip-ansi handles CSI/SGR/OSC/DCS for us; second pass trims leftover
  // lone ESC bytes that escape the regex (belt).
  const a = stripAnsi(input);
  // Belt: also drop any bare \x1b / \u001b not consumed.
  return a.replace(/[\x1b\u001b]/g, "");
}

/** Truncate a string to N chars, ellipsizing with "…". */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
