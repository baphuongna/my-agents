/**
 * F3R-1 regression guard: a double-quote in the task prompt must NOT appear raw
 * in the macOS osascript do-script string (it's AppleScript-escaped to \").
 * NEW-1 (shell-escaping) had accidentally removed the F3 AppleScript `"`-escaping,
 * reintroducing an injection vector. This test guards against that regression.
 */
import { describe, it, expect } from "vitest";
import { buildStandaloneCommand } from "./standalone.js";

describe("[unit] buildStandaloneCommand — F3R-1 AppleScript injection guard", () => {
  it("escapes a double-quote in argv so it can't break the do-script string", () => {
    const result = buildStandaloneCommand("darwin", { command: ["--task", 'a"b'] });
    const script = result.args[1] as string;
    // The raw a"b must NOT appear (the " is escaped), preventing breakout from
    // the do script "..." AppleScript string.
    expect(script).not.toContain('a"b');
  });

  it("escapes a backslash in argv (AppleScript backslash-doubling)", () => {
    const result = buildStandaloneCommand("darwin", { command: ["--task", "a\\b"] });
    const script = result.args[1] as string;
    // A single backslash in the input must be doubled (\\) in the AppleScript
    // string so it isn't interpreted as an AppleScript escape.
    expect(script).not.toContain("a\\b"); // the raw single-backslash form is gone
  });
});
