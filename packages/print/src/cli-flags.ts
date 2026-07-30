/**
 * Value-consuming CLI flags + positional-arg extraction.
 *
 * Extracted to a lightweight module (no heavy deps) so both `main.ts` and
 * `main-flags.test.ts` import the SAME source — eliminating copy-drift
 * (a stale test copy that passes even when the real set is wrong).
 */
// Flags that consume the next argument as their value (mirrors pi's cli/args.ts).
// --role/--task: role-subagent startup flags (see docs/mya-subagent-design.md).
// --provider is critical: without it, `mya --provider minimax --task '...'` leaks
// `minimax` into positional, producing a truthy prompt that triggers print-mode
// dispatch — bypassing InteractiveMode and the mya-bridge extension entirely.
export const FLAGS_WITH_VALUE = new Set([
  // mya-specific
  "--port", "--bg-id", "--gateway-session", "--gateway-url", "--role", "--task",
  // pi value-flags (keep in sync with packages/coding-agent/src/cli/args.ts)
  "--model", "--session", "--session-id", "--fork", "--session-dir",
  "--provider", "--api-key", "--models", "--thinking", "--mode",
  "--system-prompt", "--append-system-prompt", "--name", "-n",
  "--tools", "-t", "--exclude-tools", "-xt",
  "--export", "--extension", "-e", "--skill", "--prompt-template", "--theme",
]);

/** Filter positional args (user messages) from argv — excludes flag values.
 *  `model` is special-cased because `--model X` is already excluded by the
 *  FLAGS_WITH_VALUE check, but `--model=X` (eq form) would leave X in argv. */
export function extractPositional(args: string[], model?: string): string[] {
  return args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    if (i > 0 && FLAGS_WITH_VALUE.has(args[i - 1]!)) return false;
    if (model !== undefined && a === model) return false;
    return true;
  });
}
