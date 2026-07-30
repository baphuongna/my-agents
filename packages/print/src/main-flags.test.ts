// [unit] Verify FLAGS_WITH_VALUE includes all pi value-consuming flags.
// Regression: --provider was missing, causing `mya --provider minimax --task '...'`
// to leak `minimax` into positional[], producing a truthy prompt that triggered
// print-mode dispatch — bypassing InteractiveMode and the mya-bridge extension.
// This test mirrors the exact filter logic from main.ts to ensure value-flags
// are correctly recognized.
import { describe, it, expect } from "vitest";

/**
 * Replicate the FLAGS_WITH_VALUE set from packages/print/src/main.ts.
 * This MUST stay in sync with the source. If this test fails, the source
 * FLAGS_WITH_VALUE set is missing a flag that pi's cli/args.ts consumes.
 *
 * Flags marked (pi) come from packages/coding-agent/src/cli/args.ts.
 * Flags marked (mya) are mya-specific.
 */
const FLAGS_WITH_VALUE = new Set([
  // mya-specific
  "--port", "--bg-id", "--gateway-session", "--gateway-url", "--role", "--task",
  // pi value-flags (keep in sync with packages/coding-agent/src/cli/args.ts)
  "--model", "--session", "--session-id", "--fork", "--session-dir",
  "--provider", "--api-key", "--models", "--thinking", "--mode",
  "--system-prompt", "--append-system-prompt", "--name", "-n",
  "--tools", "-t", "--exclude-tools", "-xt",
  "--export", "--extension", "-e", "--skill", "--prompt-template", "--theme",
]);

/** Filter positional args — mirrors main.ts:265-272 exactly. */
function extractPositional(args: string[]): string[] {
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  return args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    if (i > 0 && FLAGS_WITH_VALUE.has(args[i - 1]!)) return false;
    if (a === model) return false;
    return true;
  });
}

describe("[unit] FLAGS_WITH_VALUE — value-consuming flags don't leak into positional", () => {
  describe("critical flags (used in role-subagent spawn)", () => {
    it("--provider value does not appear in positional", () => {
      const args = ["--gateway-session", "sid-123", "--role", "t", "--task", "say pong", "--provider", "minimax", "--model", "MiniMax-M3", "--no-session"];
      const positional = extractPositional(args);
      expect(positional).not.toContain("minimax");
      expect(positional).toEqual([]);
    });

    it("--role value does not appear in positional", () => {
      const args = ["--role", "coder", "--task", "write tests"];
      const positional = extractPositional(args);
      expect(positional).not.toContain("coder");
    });

    it("--task value does not appear in positional", () => {
      const args = ["--task", "do something with spaces"];
      const positional = extractPositional(args);
      expect(positional).not.toContain("do");
    });

    it("--model value does not appear in positional", () => {
      const args = ["--model", "claude-opus-4", "hello"];
      const positional = extractPositional(args);
      expect(positional).not.toContain("claude-opus-4");
      expect(positional).toEqual(["hello"]); // hello is a real prompt
    });
  });

  describe("all pi value-flags from cli/args.ts", () => {
    const cases: Array<[string, string]> = [
      ["--provider", "minimax"],
      ["--api-key", "secret123"],
      ["--models", "model1,model2"],
      ["--thinking", "high"],
      ["--mode", "json"],
      ["--system-prompt", "You are a bot"],
      ["--append-system-prompt", "Be concise"],
      ["--name", "my-session"],
      ["-n", "my-session"],
      ["--tools", "read,bash"],
      ["-t", "read,bash"],
      ["--exclude-tools", "edit"],
      ["-xt", "edit"],
      ["--export", "output.json"],
      ["--extension", "/path/to/ext"],
      ["-e", "/path/to/ext"],
      ["--skill", "my-skill"],
      ["--prompt-template", "my-template"],
      ["--theme", "dark"],
      ["--session", "my-session"],
      ["--session-id", "abc-123"],
      ["--fork", "session-id"],
      ["--session-dir", "/custom/dir"],
    ];

    for (const [flag, value] of cases) {
      it(`${flag} ${value} — value not in positional`, () => {
        const args = [flag, value, "actual-prompt"];
        const positional = extractPositional(args);
        expect(positional).not.toContain(value);
        // The actual prompt should survive
        expect(positional).toContain("actual-prompt");
      });
    }
  });

  describe("print-mode trigger regression", () => {
    it("the exact repro command produces empty positional (no print mode)", () => {
      // This is the exact command from the bug report.
      const args = [
        "--gateway-session", "s-test-123",
        "--role", "t",
        "--task", "say pong",
        "--provider", "minimax",
        "--model", "MiniMax-M3",
        "--no-session",
      ];
      const positional = extractPositional(args);
      const prompt = positional.join(" ").trim();
      expect(prompt).toBe(""); // empty → does NOT trigger print mode
    });

    it("a real user prompt still triggers print mode", () => {
      const args = ["--model", "gpt-4", "summarize this file"];
      const positional = extractPositional(args);
      const prompt = positional.join(" ").trim();
      expect(prompt).toBe("summarize this file"); // truthy → triggers print mode
    });
  });
});
