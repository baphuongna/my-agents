// [unit] Verify FLAGS_WITH_VALUE includes all pi value-consuming flags.
// Regression: --provider was missing, causing `mya --provider minimax --task '...'`
// to leak `minimax` into positional[], producing a truthy prompt that triggered
// print-mode dispatch — bypassing InteractiveMode and the mya-bridge extension.
//
// Imports the ACTUAL FLAGS_WITH_VALUE + extractPositional from cli-flags.ts (the
// single source of truth) — NOT a local copy. This catches drift: if someone
// removes a flag from the real set, this test fails.
import { describe, it, expect } from "vitest";
import { FLAGS_WITH_VALUE, extractPositional } from "./cli-flags.js";

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

  // Direct set checks — catches drift if a flag is removed from FLAGS_WITH_VALUE.
  describe("FLAGS_WITH_VALUE set contents (source-of-truth)", () => {
    it("includes --provider (the regression flag)", () => {
      expect(FLAGS_WITH_VALUE.has("--provider")).toBe(true);
    });
    it("includes all mya-specific flags", () => {
      for (const f of ["--gateway-session", "--gateway-url", "--role", "--task", "--port", "--bg-id"]) {
        expect(FLAGS_WITH_VALUE.has(f), f).toBe(true);
      }
    });
  });

  // Edge cases (reviewer LOW-3): flag as last arg / flag with no value.
  describe("edge cases — flag with absent value", () => {
    it("--provider as last arg produces empty positional", () => {
      expect(extractPositional(["--provider"])).toEqual([]);
    });
    it("--provider with no value followed by another flag", () => {
      expect(extractPositional(["--provider", "--role", "t", "hello"])).toEqual(["hello"]);
    });
  });
});
