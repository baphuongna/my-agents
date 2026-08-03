# Phase 9: Spike — Verify Claude CLI Flags Before Building ClaudeRuntime

> Depends on: (none — can run in parallel with Phases 6–8 after Phase 5)
> Estimated: 1h
> Spec reference: §2.2 (ClaudeSession — spawns `claude -p --output-format stream-json ...`), §7 (Risk: "Claude CLI flags unverified")
> Master plan: §3 (Phase 9 exports `claude-cli-flags.md` consumed by Phase 10)

## Objective

Before implementing `ClaudeSession` (Phase 10), verify that the Claude CLI
flags the spec assumes **actually work** as documented. The spec's
`ClaudeSession.doPrompt()` (§2.2) spawns the `claude` binary with a specific
set of flags:

```
claude -p --output-format stream-json --model <model> --continue --session-dir <dir> "<text>"
```

If any of these flags are wrong, deprecated, or behave differently than
expected, Phase 10 will build a session wrapper that produces garbled output
or crashes on spawn. This spike de-risks Phase 10 the same way Phase 3
de-risks Phase 4.

**This phase produces a document, not code.** The output is
`docs/option-d-impl/claude-cli-flags.md` — a verified reference of every flag
ClaudeSession uses, with example output captured from a real `claude` binary.

**How this de-risks Phase 10:** Phase 10's `ClaudeEventNormalizer.parseLine()`
must parse `stream-json` output lines. Without the spike, we'd discover
unexpected JSON shapes, missing fields, or different line formats only at
runtime. The spike makes Phase 10's parser a mechanical task: "read the
documented shapes, write the switch cases."

## Deliverables

- `docs/option-d-impl/claude-cli-flags.md` — verified flag reference (THE deliverable)
- `scripts/claude-cli-spike.mjs` — throwaway harness script (kept for reference)

## Implementation Steps

### Step 1 — Create the spike harness script

This script runs the `claude` binary with various flag combinations and
captures the raw output. It is **not** a test — it is a one-off diagnostic.

```javascript
// scripts/claude-cli-spike.mjs
// Run: node scripts/claude-cli-spike.mjs
//
// Prerequisites:
//   - claude CLI installed and on PATH (check: which claude)
//   - claude authenticated (check: claude --version works)
//
// This script is DIAGNOSTIC ONLY — NOT FOR CI. Run manually.
// It tests each flag combination and logs results to stdout + files.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const agentDir = join(homedir(), ".mya", "agent");
const sessionDir = join(agentDir, "sessions", "claude", "spike");
mkdirSync(sessionDir, { recursive: true });

const outDir = "/tmp/claude-spike";
mkdirSync(outDir, { recursive: true });

// ── Check if claude is available ──
function claudeAvailable() {
  try {
    const { status } = spawnSync("claude", ["--version"], { encoding: "utf-8" });
    return status === 0;
  } catch {
    return false;
  }
}

import { spawnSync } from "node:child_process";

if (!claudeAvailable()) {
  console.error("[spike] claude CLI not found on PATH. Skipping.");
  console.error("[spike] Install: npm install -g @anthropic-ai/claude-code");
  process.exit(0);
}

// ── Capture raw output from a flag combination ──
function runClaude(label, args, env = {}) {
  const outFile = join(outDir, `${label}.jsonl`);
  const logFile = join(outDir, `${label}.log`);
  console.error(`\n[spike] === ${label} ===`);
  console.error(`[spike] args: claude ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = [];
    const stderrChunks = [];

    // BB fix preview: drain stderr
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk);
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      lines.push(line);
    });

    let exitCode = null;
    child.on("exit", (code) => { exitCode = code; });

    child.on("close", () => {
      const stdout = lines.join("\n");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      writeFileSync(outFile, stdout);
      writeFileSync(logFile, `exit=${exitCode}\nstderr=${stderr}\n`);

      const jsonLineCount = lines.filter((l) => {
        try { JSON.parse(l); return true; } catch { return false; }
      }).length;

      console.error(`[spike] exit=${exitCode}, lines=${lines.length}, jsonLines=${jsonLineCount}, stderrLen=${stderr.length}`);
      resolve({ label, args, exitCode, lines, stderr, jsonLineCount });
    });

    child.on("error", (err) => {
      console.error(`[spike] spawn error: ${err.message}`);
      writeFileSync(logFile, `error=${err.message}\n`);
      resolve({ label, args, exitCode: null, lines: [], stderr: err.message, jsonLineCount: 0, spawnError: err.message });
    });
  });
}

import readline from "node:readline";

// ── Test matrix ──
const results = [];

// Test 1: Basic -p flag (does it work at all?)
results.push(await runClaude("basic-p", [
  "-p", "Say hello in one word.",
]));

// Test 2: --output-format stream-json
results.push(await runClaude("stream-json", [
  "-p", "--output-format", "stream-json", "Say hello in one word.",
]));

// Test 3: --model flag
results.push(await runClaude("model-flag", [
  "-p", "--output-format", "stream-json",
  "--model", "claude-sonnet-4-20250514",
  "Say hello in one word.",
]));

// Test 4: --session-dir flag (does it create the dir? does it persist?)
results.push(await runClaude("session-dir", [
  "-p", "--output-format", "stream-json",
  "--model", "claude-sonnet-4-20250514",
  "--session-dir", sessionDir,
  "Remember the number 42.",
]));

// Test 5: --continue flag (does it resume from the session-dir?)
results.push(await runClaude("continue", [
  "-p", "--output-format", "stream-json",
  "--model", "claude-sonnet-4-20250514",
  "--continue", "--session-dir", sessionDir,
  "What number did I tell you to remember?",
]));

// Test 6: Full combination (what ClaudeSession uses)
results.push(await runClaude("full-combo", [
  "-p", "--output-format", "stream-json",
  "--model", "claude-sonnet-4-20250514",
  "--continue", "--session-dir", sessionDir,
  "What number did I tell you to remember?",
]));

// Test 7: No --continue (fresh session each time)
results.push(await runClaude("no-continue", [
  "-p", "--output-format", "stream-json",
  "--model", "claude-sonnet-4-20250514",
  "--session-dir", sessionDir,
  "What number did I tell you to remember?",
]));

// Test 8: Unknown model (error handling)
results.push(await runClaude("bad-model", [
  "-p", "--output-format", "stream-json",
  "--model", "nonexistent-model-xyz",
  "Say hello.",
]));

// ── Summary ──
console.error("\n[spike] === SUMMARY ===");
for (const r of results) {
  const status = r.exitCode === 0 ? "✅" : "❌";
  console.error(`  ${status} ${r.label}: exit=${r.exitCode} jsonLines=${r.jsonLineCount}`);
}

// ── Analyze stream-json shapes ──
console.error("\n[spike] === STREAM-JSON LINE TYPES ===");
for (const r of results.filter((r) => r.jsonLineCount > 0)) {
  console.error(`\n  --- ${r.label} ---`);
  const types = new Map();
  for (const line of r.lines) {
    try {
      const obj = JSON.parse(line);
      const type = obj.type ?? obj.kind ?? "unknown";
      if (!types.has(type)) {
        types.set(type, obj); // store first example
      }
    } catch {}
  }
  for (const [type, example] of types) {
    console.error(`    ${type}: ${JSON.stringify(example).slice(0, 200)}`);
  }
}

console.error("\n[spike] Done. Output files in /tmp/claude-spike/");
process.exit(0);
```

### Step 2 — Run the spike

```bash
# Run the spike (requires claude CLI installed)
node scripts/claude-cli-spike.mjs

# If claude is not installed:
npm install -g @anthropic-ai/claude-code
node scripts/claude-cli-spike.mjs
```

### Step 3 — Analyze the captured output

For each flag combination, extract:

1. **Flag combination** — the exact args passed
2. **Exit code** — 0 = success, non-zero = failure
3. **Output format** — did `--output-format stream-json` produce NDJSON?
4. **JSON line types** — what `type` values appear in the stream?
5. **Session persistence** — did `--continue --session-dir` resume context?
6. **Error behavior** — what happens with unknown model? Missing dir?

```bash
# List unique JSON line types across all runs
cat /tmp/claude-spike/*.jsonl | \
  jq -r '.type // .kind // "unknown"' 2>/dev/null | \
  sort | uniq -c | sort -rn

# Show first example of each type
cat /tmp/claude-spike/stream-json.jsonl | \
  jq -s 'group_by(.type) | map({type: .[0].type, sample: .[0]}) | sort_by(.type)'
```

### Step 4 — Write `claude-cli-flags.md`

Create the verified flag reference. Structure:

```markdown
# Claude CLI Flags — Verified Reference (Spike Results)

> Generated: [date]
> claude version: [from `claude --version`]
```

For each flag, document:

#### Flag: `-p` / `--print`

| Aspect | Value |
|--------|-------|
| Purpose | Non-interactive mode — accepts prompt as positional arg, prints response, exits |
| Verified | ✅ / ❌ |
| Example | `claude -p "Say hello"` |
| Output | stdout text (or stream-json with `--output-format`) |
| Exit code | 0 on success |

#### Flag: `--output-format stream-json`

| Aspect | Value |
|--------|-------|
| Purpose | Emit NDJSON (one JSON object per line) instead of plain text |
| Verified | ✅ / ❌ |
| Line types observed | `[list from spike]` |
| Example line | `{"type":"...","..."}` |

(Continue for each flag: `--model`, `--continue`, `--session-dir`)

### Step 5 — Verify spec assumptions

Cross-reference each spec assumption against the spike data:

| Spec Assumption (§2.2) | Spike Finding | Status |
|---|---|---|
| `claude -p "text"` works (prompt as last positional arg) | [verified?] | ✅/❌ |
| `--output-format stream-json` produces NDJSON on stdout | [verified?] | ✅/❌ |
| `--model claude-sonnet-4-20250514` is a valid model name | [verified?] | ✅/❌ |
| `--continue` resumes from the session in `--session-dir` | [verified?] | ✅/❌ |
| `--session-dir` creates the directory if it doesn't exist | [verified?] | ✅/❌ |
| stderr is separate from stdout (pipe drain needed) | [verified?] | ✅/❌ |
| Non-zero exit code on error (bad model, etc.) | [verified?] | ✅/❌ |
| `--continue` without prior session creates a new one (no error) | [verified?] | ✅/❌ |
| stream-json lines have `type` field (for normalizer switch) | [verified?] | ✅/❌ |
| stream-json includes assistant text deltas | [verified?] | ✅/❌ |
| stream-json includes tool call/result events | [verified?] | ✅/❌ |
| stream-json includes token usage info | [verified?] | ✅/❌ |

> **Critical:** If any assumption is ❌, document the actual behavior and note
> the required change to Phase 10's `ClaudeSession` or `ClaudeEventNormalizer`.

### Step 6 — Document stream-json line shapes

For Phase 10's `ClaudeEventNormalizer.parseLine()`, document every JSON line
type the spike observed:

#### Stream-JSON type: `[type_name]`

```json
{
  "type": "...",
  "field1": "...",
  "field2": 123
}
```

**Maps to AgentEvent:** `{ type: "text", delta: "..." }` (or whatever applies)
**Phase 10 normalizer case:**

```typescript
case "[type_name]": {
  return { type: "text", delta: obj.field1 ?? "" };
}
```

## Code Skeletons

### ClaudeEventNormalizer (Phase 10 preview — informed by spike)

This is what Phase 10 will build. The spike determines the exact parse cases:

```typescript
// packages/print/src/runtimes/claude-event-normalizer.ts (Phase 10 — NOT in this phase)

import type { AgentEvent } from "@my-agent/core";

export const ClaudeEventNormalizer = {
  /**
   * Parse a single stream-json line from claude CLI stdout.
   * Returns null if the line should be ignored.
   *
   * MAPPING TABLE (verified by Phase 9 spike):
   *   stream-json type     → AgentEvent type
   *   ─────────────────────────────────────────────
   *   [type from spike]    → { type: "text", delta }
   *   [type from spike]    → { type: "tool_call", ... }
   *   [type from spike]    → { type: "tool_result", ... }
   *   [type from spike]    → { type: "turn_end", ... }
   *   (unknown)            → null
   */
  parseLine(line: string): AgentEvent | null {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      return null; // non-JSON line — ignore
    }

    const type = obj.type as string | undefined;
    switch (type) {
      // ... exact cases determined by spike results ...
      default:
        return null; // unknown line type — safe to ignore
    }
  },
};
```

### ClaudeSession spawn args (Phase 10 preview)

```typescript
// What ClaudeSession.doPrompt() will use (Phase 10):
const args = [
  "-p",
  "--output-format", "stream-json",
  "--model", this.modelId,           // verified by spike
  "--continue",                       // verified by spike
  "--session-dir", this.sessionDir,  // verified by spike
  text,                               // positional prompt arg
];
```

## Test Plan

- **File:** (none — spike is a diagnostic, not a test)
- **Verification:** The output document `claude-cli-flags.md` must exist and contain:
  - [ ] At least 5 verified flag combinations
  - [ ] Exit codes for each combination
  - [ ] stream-json line types with example payloads
  - [ ] Session persistence verification (`--continue` resumes context)
  - [ ] Error behavior documentation (bad model, missing dir)
  - [ ] Spec assumption verification table (all rows filled with ✅ or ❌)

> If the spike script cannot run (claude not installed), document the
> blocker in `claude-cli-flags.md` with:
> - What was attempted
> - What failed
> - What the fallback plan is (read claude CLI docs / source as secondary evidence)

## Acceptance Criteria

- [ ] `scripts/claude-cli-spike.mjs` created and runs (or exits gracefully if `claude` not found)
- [ ] `docs/option-d-impl/claude-cli-flags.md` exists
- [ ] Flag reference covers: `-p`, `--output-format stream-json`, `--model`, `--continue`, `--session-dir`
- [ ] Each flag has: purpose, verified status, example, exit code
- [ ] stream-json line types documented with example payloads (at least 3 types)
- [ ] Session persistence verified (`--continue` + `--session-dir` resume works)
- [ ] Error behavior documented (non-zero exit, stderr content)
- [ ] Spec assumption table is filled (✅/❌ for each row)
- [ ] Any ❌ rows have a documented "required Phase 10 change"
- [ ] Spike script has `skipIf(!claude)` guard (exits cleanly, not a crash)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `claude` CLI not installed in dev environment | Script checks availability first and exits cleanly with install instructions. Document as "spike deferred — will run when claude available" |
| `claude` CLI requires authentication (API key) | Document auth requirement. Use `ANTHROPIC_API_KEY` env var or `claude login`. Note in document if auth was unavailable |
| Claude CLI version differs from production | Record the version in the document. Phase 10 should handle version differences gracefully (unknown line types → `null`) |
| `--session-dir` behaves differently across OS | Test on the target OS (Linux). Note platform-specific behavior if found |
| stream-json format changes between claude versions | The normalizer's `default → null` case handles unknown types gracefully. Spike documents the version tested |
| Spike script accidentally commits large output files | Script writes to `/tmp/claude-spike/` (not the repo). Only the `.md` document is committed |
| `claude` CLI rate-limits spike runs | Use simple prompts ("Say hello"). 8 test combinations is well within rate limits |
| `--continue` creates unexpected side effects (modifies session state) | Use a dedicated spike session-dir under `~/.mya/agent/sessions/claude/spike/`. Clean up after |
| Binary name is different (e.g., `claude-code` vs `claude`) | Check `which claude` first. Document the actual binary name in the reference |

## Rollback

1. Delete `scripts/claude-cli-spike.mjs`
2. Delete `docs/option-d-impl/claude-cli-flags.md`
3. Clean up spike session dir: `rm -rf ~/.mya/agent/sessions/claude/spike/`
4. Clean up output files: `rm -rf /tmp/claude-spike/`

No code changes were made to any package. The spike is purely informational.
Rollback has zero impact on existing functionality.
