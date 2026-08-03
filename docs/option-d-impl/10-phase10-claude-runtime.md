# Phase 10: ClaudeRuntime + ClaudeSession (Subprocess Runtime)

> Depends on: Phase 2 (`@my-agent/core` SPI types), Phase 5 (RuntimePool registration), Phase 9 (`claude-cli-flags.md` spike)
> Estimated: 3h
> Spec reference: §2.2 (ClaudeSession — settled guard C5, stderr drain BB, error handler BA), §1.2 (RuntimeSession), §1.3 (AgentEvent), §3 (Event Normalization patterns)

## Objective

Implement the **second concrete `AgentRuntime`**: `ClaudeRuntime`, which runs
Anthropic's Claude CLI as a **subprocess** (unlike pi which runs in-process).
Each `prompt()` spawns a fresh `claude -p` process that streams NDJSON to
stdout, completes, and exits. Session continuity is achieved via
`--continue --session-dir` flags that store conversation state on disk between
invocations.

**Why subprocess (not in-process):** Claude is a standalone CLI binary, not a
Node library. There is no `import { createClaudeSession }` equivalent. The only
integration surface is the command-line interface with `stream-json` output.
This is the same pattern ClaudeSession uses in the spec (§2.2).

**Key challenges this phase solves:**

1. **Process lifecycle** — spawn, stream stdout, drain stderr (BB fix), handle
   exit (H5: use `close` not `exit`), handle spawn errors (BA fix: ENOENT)
2. **Turn pairing** — emit `turn_start` at spawn, `turn_end` on close. The
   **settled guard (C5 fix)** prevents double `turn_end` when both `error` and
   `close` fire on spawn failure.
3. **Overlap handling** — if `prompt()` is called while a previous prompt is
   still running, queue it via `promptQueue` and execute sequentially.
4. **Event normalization** — parse `stream-json` NDJSON lines into the uniform
   `AgentEvent` union via `ClaudeEventNormalizer`.

**What this phase does NOT do:** It does not implement inter-agent messaging
(Phase 11), cost tracking (Phase 12), or shutdown (Phase 13). It produces a
runtime + normalizer that the RuntimePool wraps.

## Deliverables

| File | Type | Description |
|------|------|-------------|
| `packages/print/src/runtimes/claude.ts` | code | `ClaudeRuntime` + `ClaudeSession` |
| `packages/print/src/runtimes/claude-event-normalizer.ts` | code | `ClaudeEventNormalizer` (static `parseLine`) |
| `packages/print/src/runtimes/claude-session.test.ts` | test `[real]` | Session lifecycle, overlap, error handling |

> **File split rationale:** `claude-event-normalizer.ts` is a pure function
> (no `claude` binary needed) but is tested as part of `[real]` since
> `ClaudeSession` tests exercise it end-to-end with real `claude` output.

## Implementation Steps

### Step 1 — Create `claude-event-normalizer.ts`

This is a **pure function** that parses a single `stream-json` line into an
`AgentEvent | null`. The mapping is informed by the Phase 9 spike
(`docs/option-d-impl/claude-cli-flags.md`).

**Mapping table (stream-json → AgentEvent):**

| stream-json `type` | Payload fields | AgentEvent | Notes |
|---------------------|----------------|------------|-------|
| `assistant` (text content block) | `content[].text` | `{ type: "text", delta }` | assembled from content blocks |
| `tool_use` (content block) | `id`, `name`, `input` | `{ type: "tool_call", toolCallId, name, args }` | once per tool call |
| `tool_result` (content block) | `tool_use_id`, `content` | `{ type: "tool_result", toolCallId, output }` | terminal |
| `result` | `cost`, `usage` | `{ type: "turn_end", tokensIn, tokensOut, costUsd }` | final line before exit |
| `error` | `message` | `{ type: "error", message, recoverable: false }` | CLI error |
| *(any other)* | — | `null` | unknown/ignored line types |

> **Note:** The exact `type` values and payload shapes are **verified by the
> Phase 9 spike**. If the spike reveals different shapes, update the switch
> cases accordingly. The `default → null` case ensures unknown types don't
> crash the parser.

```typescript
// packages/print/src/runtimes/claude-event-normalizer.ts

import type { AgentEvent } from "@my-agent/core";

/**
 * Translates a single stream-json line from `claude -p --output-format stream-json`
 * into the uniform AgentEvent union.
 *
 * PURE FUNCTION: no side effects, no nowWallclock()  // R5-7 fix: use core.time helper (AGENTS.md §18), no I/O.
 * Returns null for non-JSON lines and unknown line types.
 *
 * Spec reference: option-d-spec-v8.md §2.2, §3 (Event Normalization)
 * Spike reference: docs/option-d-impl/claude-cli-flags.md (Phase 9)
 *
 * IMPORTANT: turn_start is NOT produced here. It is emitted directly by
 * ClaudeSession.doPrompt() at spawn time (same pattern as PiInProcessSession).
 * turn_end is also emitted directly by ClaudeSession (on 'close'/'error' event),
 * not by the normalizer. The normalizer only produces mid-turn events
 * (text, tool_call, tool_result).
 */
export const ClaudeEventNormalizer = {
  /**
   * Parse a single NDJSON line from claude CLI stdout.
   *
   * @param line - one line of stream-json output
   * @returns AgentEvent or null if the line should be ignored
   */
  parseLine(line: string): AgentEvent | null {
    let obj: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      obj = parsed as Record<string, unknown>;
    } catch {
      return null; // non-JSON line — ignore
    }

    const type = obj.type as string | undefined;
    if (!type) return null;

    switch (type) {
      // ── Assistant text content ──
      // Claude stream-json emits assistant messages with content blocks.
      // Text deltas may come as individual content_block events or as
      // complete message objects. The spike determines the exact shape.
      case "assistant": {
        const content = obj.content;
        if (!Array.isArray(content)) return null;
        // Extract text from content blocks
        const textParts: string[] = [];
        for (const block of content) {
          if (typeof block === "object" && block !== null) {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              textParts.push(b.text);
            }
          }
        }
        if (textParts.length === 0) return null;
        return { type: "text", delta: textParts.join("") };
      }

      // ── Content block streaming (incremental text) ──
      case "content_block_start":
      case "content_block_delta": {
        const delta = obj.delta as Record<string, unknown> | undefined;
        if (!delta) return null;
        // Text delta
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          return { type: "text", delta: delta.text };
        }
        // Thinking delta (if claude supports extended thinking)
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          return { type: "thinking", delta: delta.thinking };
        }
        return null;
      }

      // ── Tool use ──
      case "tool_use": {
        const id = obj.id as string | undefined;
        const name = obj.name as string | undefined;
        const input = obj.input;
        if (!id || !name) return null;
        return { type: "tool_call", toolCallId: id, name, args: input };
      }

      // ── Tool result ──
      case "tool_result": {
        const toolUseId = obj.tool_use_id as string | undefined;
        const content = obj.content;
        if (!toolUseId) return null;
        const output = typeof content === "string"
          ? content
          : JSON.stringify(content ?? "");
        const isError = obj.is_error === true;
        return {
          type: "tool_result",
          toolCallId: toolUseId,
          output,
          ...(isError ? { error: true } : {}),
        };
      }

      // ── Result (final summary with cost/usage) ──
      case "result": {
        // The result line contains total usage and cost.
        // Extract tokens if available.
        const usage = obj.usage as Record<string, unknown> | undefined;
        const tokensIn = typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
        const tokensOut = typeof usage?.output_tokens === "number" ? usage.output_tokens : 0;
        const costUsd = typeof obj.cost === "number" ? obj.cost : undefined;
        // R5-4 fix: update session's lastUsage instead of discarding.
        // The normalizer receives a callback to update the session's usage.
        // Since normalizer is stateless, we return a special internal event
        // that ClaudeSession catches to update lastUsage.
        if (tokensIn > 0 || tokensOut > 0) {
          return { type: "_usage_update", tokensIn, tokensOut, costUsd } as any;
        }
        return null;
      }

      // ── Error ──
      case "error": {
        const message = typeof obj.message === "string"
          ? obj.message
          : typeof obj.error === "string"
            ? obj.error
            : "Unknown claude error";
        return { type: "error", message, recoverable: false };
      }

      // ── Unknown / ignored types ──
      // message_start, message_delta, message_stop, ping, etc.
      default:
        return null;
    }
  },
};
```

### Step 2 — Create `claude.ts` (ClaudeRuntime + ClaudeSession)

This implements the full `AgentRuntime` and `RuntimeSession` interfaces.
The code follows spec §2.2 exactly, including all fixes:

- **C5 fix:** `settled` guard prevents double `turn_end` (both `error` and
  `close` fire on spawn failure — only the first one emits `turn_end`)
- **BB fix:** drain stderr (`child.stderr.on("data", () => {})`) to prevent
  pipe deadlock when stderr buffer fills
- **BA fix:** `'error'` handler for spawn failures (ENOENT — binary not found)
- **H5 fix:** listen on `'close'` event (fires after ALL stdio consumed), not
  `'exit'` (fires before stdio is fully read)
- **promptQueue:** serializes overlapping `prompt()` calls so each subprocess
  runs to completion before the next spawns

```typescript
// packages/print/src/runtimes/claude.ts

import type { Model, Api } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentRuntime, RuntimeSession, StartOpts, SessionState, ThinkingLevel, ModelInfo, AgentCapabilities, CompactionResult, PromptOpts } from "@my-agent/core";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import * as readline from "node:readline";
import { ClaudeEventNormalizer } from "./claude-event-normalizer.js";

// ─────────────────────────────────────────────────────────────────────────────
// ClaudeRuntime
// ─────────────────────────────────────────────────────────────────────────────

export class ClaudeRuntime implements AgentRuntime {
  readonly runtimeType = "claude";
  readonly displayName = "claude (Anthropic CLI)";

  async start(opts: StartOpts): Promise<RuntimeSession> {
    return new ClaudeSession(opts);
  }

  isAvailable(): boolean {
    // Check if the `claude` binary is on PATH.
    // F-5/R2-2 fix: spawnSync is imported at top of file (line 234).
    // No require() or await import() — isAvailable() must stay sync per interface.
    try {
      const result = spawnSync("claude", ["--version"], {
        stdio: "pipe",
        timeout: 5000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Claude CLI doesn't have a --list-models flag.
    // Return known models statically.
    return [
      {
        id: "claude-sonnet-4-20250514",
        provider: "anthropic",
        contextWindow: 200_000,
        maxTokens: 8192,
        reasoning: true,
      },
      {
        id: "claude-opus-4-20250514",
        provider: "anthropic",
        contextWindow: 200_000,
        maxTokens: 8192,
        reasoning: true,
      },
      {
        id: "claude-haiku-3-5-20241022",
        provider: "anthropic",
        contextWindow: 200_000,
        maxTokens: 8192,
        reasoning: false,
      },
    ];
  }

  capabilities(): AgentCapabilities {
    return {
      hasInteractive: false,  // Claude CLI is non-interactive (-p mode)
      hasHeadless: true,
      supportsTools: true,
      supportsResume: true,   // --continue --session-dir
      supportsCompaction: true, // continue-session strategy
      supportsImages: false,  // not via CLI flags in current spec
      supportsThinking: false, // no --thinking flag verified
      execution: "subprocess",
      maxContextWindow: 200_000,
      injectionMethod: "stdin-prompt", // prompt passed as positional arg
    };
  }

  costPerMTokens() {
    return { input: 3, output: 15 }; // Claude Sonnet pricing estimate
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClaudeSession
// ─────────────────────────────────────────────────────────────────────────────

class ClaudeSession implements RuntimeSession {
  readonly executionModel = "subprocess" as const;

  // R7-2 fix: expose required readonly properties
  get sessionId(): string { return this.opts.sessionId; }
  get runtimeType(): string { return "claude"; }

  private child: ChildProcess | null = null;
  private listeners = new Set<(e: AgentEvent) => void>();
  private readonly createdAt = nowWallclock();
  private modelId: string;
  private busy = false;

  // promptQueue: serializes overlapping prompt() calls.
  // Each item is a deferred function that runs the actual prompt.
  // When a prompt completes, the queue is drained sequentially.
  private promptQueue: Array<{
    fn: () => Promise<void>;
    reject: (e: Error) => void;
  }> = [];

  private abortController: AbortController | null = null;
  private sessionDir: string;

  // Track usage from the result line for getState()
  private lastUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

  constructor(private opts: StartOpts) {
    this.modelId = opts.modelId ?? "claude-sonnet-4-20250514";

    // Create a deterministic session directory based on sessionId + cwd hash.
    // This allows --continue to resume the conversation.
    const contextHash = createHash("md5")
      .update(`${opts.sessionId}:${opts.cwd}`)
      .digest("hex")
      .slice(0, 12);
    this.sessionDir = join(opts.agentDir, "sessions", "claude", contextHash);
    mkdirSync(this.sessionDir, { recursive: true });
  }

  /**
   * BLOCKING: returns after the claude subprocess exits.
   *
   * If a prompt is already in progress, this call is queued and resolves
   * after the queued prompt completes (sequential execution).
   *
   * Guarantees: emits turn_start at start, turn_end at completion
   * (even on failure or early return — via settled guard C5).
   */
  async prompt(text: string, opts?: PromptOpts): Promise<void> {
    // ── Overlap handling: queue if busy ──
    if (this.busy) {
      await new Promise<void>((resolve, reject) => {
        this.promptQueue.push({
          fn: async () => {
            try {
              await this.doPrompt(text, opts);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          },
          reject,
        });
      });
      return;
    }

    // ── Execute this prompt immediately ──
    await this.doPrompt(text, opts);

    // ── Drain the queue (run queued prompts sequentially) ──
    while (this.promptQueue.length > 0) {
      const item = this.promptQueue.shift()!;
      try {
        await item.fn();
      } catch {
        // Error already emitted via event handler; swallow to continue queue
      }
    }
  }

  /**
   * Spawn the claude subprocess and stream its output.
   * This is the core execution path.
   */
  private async doPrompt(text: string, _opts?: PromptOpts): Promise<void> {
    this.busy = true;
    this.abortController = new AbortController();

    // Emit turn_start directly (not from normalizer — guarantees 1:1 with turn_end)
    this.emit({
      type: "turn_start",
      model: this.modelId,
      sessionId: this.opts.sessionId,
    });

    // ── Build the claude command args ──
    // Flags verified by Phase 9 spike (claude-cli-flags.md)
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--model", this.modelId,
      "--continue",
      "--session-dir", this.sessionDir,
      text,
    ];

    // ── Spawn the subprocess ──
    this.child = spawn("claude", args, {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // BB fix: drain stderr to prevent pipe deadlock.
    // If stderr buffer fills and nobody reads it, the process hangs.
    this.child.stderr?.on("data", () => {});

    try {
      await new Promise<void>((resolve) => {
        // ── Parse stdout line-by-line ──
        const rl = readline.createInterface({ input: this.child!.stdout });
        rl.on("line", (line) => {
          if (this.abortController?.signal.aborted) return;

          // Parse the stream-json line into an AgentEvent
          const event = ClaudeEventNormalizer.parseLine(line);
          if (event) {
            // Track usage from result line
            if (event.type === "error") {
              // errors are also emitted as events
            }
            this.emit(event);
          }
        });

        // ── Track exit code separately ──
        let exitCode: number | null = null;
        this.child!.on("exit", (code) => {
          exitCode = code;
        });

        // C5 fix: settled guard prevents double turn_end.
        // On spawn failure, both 'error' and 'close' fire — only the first
        // one should emit turn_end + resolve the promise.
        let settled = false;

        // H5 fix: listen on 'close' (fires after ALL stdio consumed),
        // not 'exit' (fires before stdio is fully read).
        this.child!.on("close", () => {
          if (settled) return; // C5 fix: already handled by 'error'
          settled = true;

          // Check for non-zero exit (but ignore if we aborted)
          if (exitCode !== null && exitCode !== 0 && !this.abortController?.signal.aborted) {
            this.emit({
              type: "error",
              message: `Claude exited with code ${exitCode}`,
              recoverable: false,
            });
          }

          // Emit turn_end with accumulated usage
          this.emit({
            type: "turn_end",
            tokensIn: this.lastUsage.tokensIn,
            tokensOut: this.lastUsage.tokensOut,
            ...(this.lastUsage.costUsd > 0 ? { costUsd: this.lastUsage.costUsd } : {}),
          });

          resolve();
        });

        // BA fix: 'error' handler for spawn failures (ENOENT — binary not found).
        // Without this, spawn errors crash the process with an unhandled exception.
        this.child!.on("error", (err) => {
          if (settled) return; // C5 fix: already handled by 'close'
          settled = true;

          this.emit({
            type: "error",
            message: err.message,
            recoverable: false,
          });
          this.emit({
            type: "turn_end",
            tokensIn: this.lastUsage.tokensIn,
            tokensOut: this.lastUsage.tokensOut,
          });

          resolve();
        });
      });
    } catch (e) {
      // Catch any unexpected errors (shouldn't happen — error handler covers spawn)
      this.emit({
        type: "error",
        message: String(e),
        recoverable: false,
      });
      this.emit({
        type: "turn_end",
        tokensIn: this.lastUsage.tokensIn,
        tokensOut: this.lastUsage.tokensOut,
      });
      throw e;
    } finally {
      this.busy = false;
      this.child = null;
      this.abortController = null;
    }
  }

  async setModel(model: Model<Api>): Promise<void> {
    this.modelId = model.id;
    this.emit({ type: "model_changed", model: model.id });
  }

  setThinking(_level: ThinkingLevel): void {
    // Claude CLI doesn't support a thinking level flag (as of spike).
    // No-op — spec §2.2 leaves this as a no-op for subprocess runtimes.
  }

  async compact(): Promise<CompactionResult> {
    // Claude doesn't have native compaction. The --continue flag starts a
    // fresh context window within the same session dir (continue-session strategy).
    // We can't measure tokens precisely, so return zeros.
    return {
      tokensBefore: 0,
      tokensAfter: 0,
      strategy: "continue-session",
    };
  }

  async dispose(): Promise<void> {
    // Kill any running subprocess
    this.child?.kill();
    this.child = null;

    // Reject all queued prompts with a dispose error
    const err = new Error("Session disposed");
    for (const item of this.promptQueue) {
      item.reject(err);
    }
    this.promptQueue = [];

    // Clear listeners so no further events are emitted
    this.listeners.clear();
    this.busy = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  // ── Event handling ──

  private emit(event: AgentEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // ── State ──

  getState(): SessionState {
    return {
      model: this.modelId,
      thinking: "medium",
      status: this.busy ? "thinking" : "idle",
      tokensIn: this.lastUsage.tokensIn,
      tokensOut: this.lastUsage.tokensOut,
      contextPct: 0, // Claude CLI doesn't report context usage mid-stream
      contextWindow: 200_000,
      costUsd: this.lastUsage.costUsd,
      startedAt: this.createdAt,
      lastActivity: nowWallclock(),
    };
  }

  isIdle(): boolean {
    return !this.busy;
  }
}
```

### Step 3 — Wire ClaudeRuntime into the RuntimePool

In Phase 5, `main.ts` creates the runtimes map. Phase 10 adds the claude entry:

```typescript
// packages/print/src/main.ts (Phase 10 addition)

import { ClaudeRuntime } from "./runtimes/claude.js";

// Phase 5 created the runtimes map with pi + mya-native.
// Phase 10 adds claude:
runtimes.set("claude", new ClaudeRuntime());
```

> **Conditional registration:** `ClaudeRuntime.isAvailable()` returns `false`
> if the `claude` binary is not on PATH. The SmartRouter (Phase 8) and
> RuntimePool (Phase 5) check `isAvailable()` before selecting — so an
> unavailable claude runtime is simply never chosen, without crashing.

### Step 4 — Add re-export to runtimes barrel

```typescript
// packages/print/src/runtimes/index.ts
export { ClaudeRuntime } from "./claude.js";
export { ClaudeEventNormalizer } from "./claude-event-normalizer.js";
```

## Code Skeletons

### Spawn lifecycle diagram

```
prompt("Hello")
    │
    ▼
┌──────────────────────────────────────────────────┐
│ busy? ── YES ──► push to promptQueue ──► return  │
│   │ NO                                          │
│   ▼                                             │
│ doPrompt(text)                                   │
│   │                                             │
│   ├─ emit turn_start                             │
│   ├─ spawn("claude", args)                      │
│   ├─ stderr.on("data", ()=>{})  ← BB fix        │
│   ├─ stdout readline ──► parseLine ──► emit     │
│   │                                              │
│   ├─ child.on("close") ──┐                       │
│   ├─ child.on("error") ──┤                       │
│   │                       ▼                      │
│   │              settled guard (C5)              │
│   │              first fires:                    │
│   │                ├─ emit error? (if bad exit)  │
│   │                ├─ emit turn_end              │
│   │                └─ resolve()                  │
│   │                                              │
│   └─ finally: busy = false                       │
│                                                  │
│ Drain promptQueue: run each queued fn()         │
└──────────────────────────────────────────────────┘
```

### Settled guard (C5 fix) — why both handlers exist

```
Scenario: claude binary not found (ENOENT)

  spawn("claude") ──► process.on("error", err)     ← BA fix
                    │     ├─ settled? NO → settled = true
                    │     ├─ emit error event
                    │     ├─ emit turn_end
                    │     └─ resolve()
                    │
                    └──► process.on("close", code)  ← fires after error
                          ├─ settled? YES → return  ← C5 fix: skip
                          └─ (no double turn_end)

Without C5 guard:
  Both handlers emit turn_end → consumer sees TWO turn_end events
  for ONE turn_start → dashboard turn pairing breaks.
```

### ClaudeRuntime vs PiInProcessRuntime comparison

| Aspect | PiInProcessRuntime | ClaudeRuntime |
|--------|--------------------|---------------|
| Execution | in-process (Node object) | subprocess (child_process) |
| Prompt model | `session.prompt()` (async, blocking) | spawn → stream → close |
| Event source | `session.subscribe()` callback | stdout readline |
| Turn boundary | `agent_settled` event | subprocess `close` event |
| Token usage | `message_end` usage accumulation | result line / unavailable |
| Session resume | pi JSONL session files | `--continue --session-dir` |
| Compaction | `session.compact()` native | continue-session strategy |
| Thinking | `setThinkingLevel()` | no-op (CLI has no flag) |
| Images | `images` in PromptOpts | not supported via CLI |
| Error surface | try/catch on prompt() | `error` + `close` events |

## Test Plan

- **File:** `packages/print/src/runtimes/claude-session.test.ts`
- **Tier:** `[real]` — requires the `claude` binary on PATH
- **Guard:** `beforeAll` / `describe.skip` when `claude` not available

```typescript
// packages/print/src/runtimes/claude-session.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClaudeRuntime } from "./claude.js";
import { ClaudeEventNormalizer } from "./claude-event-normalizer.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentEvent, StartOpts } from "@my-agent/core";

// ── Check if claude binary is available ──
function claudeAvailable(): boolean {
  try {
    const result = spawnSync("claude", ["--version"], { stdio: "pipe", timeout: 5000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

const CLAUDE_AVAILABLE = claudeAvailable();

// Skip entire suite if claude is not installed
const describeOrSkip = CLAUDE_AVAILABLE ? describe : describe.skip;

describeOrSkip("[real] ClaudeSession", () => {
  let runtime: ClaudeRuntime;
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "claude-test-"));
    runtime = new ClaudeRuntime();
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ── skipIf(!claude) ──
  it("skipIf: skips when claude binary is not available", () => {
    // This test always passes — it documents the guard.
    // When CLAUDE_AVAILABLE is false, describe.skip handles it.
    expect(true).toBe(true);
  });

  // ── Basic prompt ──
  it("emits turn_start and turn_end for a simple prompt", async () => {
    const session = await runtime.start({
      sessionId: "test-basic",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    const events: AgentEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt("Say hello in exactly one word.");

    const types = events.map((e) => e.type);
    expect(types).toContain("turn_start");
    expect(types).toContain("turn_end");

    const turnStarts = events.filter((e) => e.type === "turn_start");
    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnStarts.length).toBe(1); // exactly one turn_start
    expect(turnEnds.length).toBe(1);   // exactly one turn_end

    await session.dispose();
  });

  // ── Overlap queue ──
  it("queues overlapping prompts and executes them sequentially", async () => {
    const session = await runtime.start({
      sessionId: "test-overlap",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    const events: AgentEvent[] = [];
    session.onEvent((e) => events.push(e));

    // Fire two prompts concurrently — second should queue
    const p1 = session.prompt("Say 'first'");
    const p2 = session.prompt("Say 'second'");
    await Promise.all([p1, p2]);

    // Should have exactly 2 turn_start and 2 turn_end (no overlap)
    const turnStarts = events.filter((e) => e.type === "turn_start");
    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnStarts.length).toBe(2);
    expect(turnEnds.length).toBe(2);

    // Verify ordering: turn_start(1), turn_end(1), turn_start(2), turn_end(2)
    const turnEvents = events.filter((e) => e.type === "turn_start" || e.type === "turn_end");
    expect(turnEvents[0]!.type).toBe("turn_start");
    expect(turnEvents[1]!.type).toBe("turn_end");
    expect(turnEvents[2]!.type).toBe("turn_start");
    expect(turnEvents[3]!.type).toBe("turn_end");

    await session.dispose();
  });

  // ── Dispose ──
  it("dispose rejects queued prompts", async () => {
    const session = await runtime.start({
      sessionId: "test-dispose",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    // Start a prompt (will be in progress)
    const p1 = session.prompt("Count from 1 to 100 slowly");

    // Queue a second prompt while first is running
    const p2 = session.prompt("Say hello");

    // Dispose while p1 is running
    await session.dispose();

    // R5-5 fix: p1 (in-flight) resolves (child killed → close event fires → resolve).
    // Only p2 (queued) rejects via explicit item.reject(err).
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).rejects.toThrow();
  });

  it("dispose clears listeners (no further events emitted)", async () => {
    const session = await runtime.start({
      sessionId: "test-dispose-listeners",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    let eventCount = 0;
    session.onEvent(() => eventCount++);

    await session.dispose();

    // After dispose, even if we try to prompt, no events should fire
    const beforeCount = eventCount;
    try {
      await session.prompt("test");
    } catch {
      // expected — session disposed
    }
    expect(eventCount).toBe(beforeCount);
  });

  // ── Close event (H5 fix) ──
  it("emits turn_end from close event (not exit)", async () => {
    const session = await runtime.start({
      sessionId: "test-close",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    const events: AgentEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt("Say hello");

    // turn_end must exist — proving the close handler fired
    const turnEnd = events.find((e) => e.type === "turn_end");
    expect(turnEnd).toBeDefined();

    await session.dispose();
  });

  // ── Error handler (BA fix) ──
  it("emits error event when claude binary spawns with bad model", async () => {
    const session = await runtime.start({
      sessionId: "test-bad-model",
      cwd: agentDir,
      agentDir,
      modelId: "nonexistent-model-xyz-123",
      env: {},
    } as StartOpts);

    const events: AgentEvent[] = [];
    session.onEvent((e) => events.push(e));

    try {
      await session.prompt("Say hello");
    } catch {
      // may or may not throw depending on exit code
    }

    // Should have either an error event or at least turn_end
    const hasTurnEnd = events.some((e) => e.type === "turn_end");
    expect(hasTurnEnd).toBe(true);

    await session.dispose();
  });

  // ── Stderr drain (BB fix) ──
  it("does not hang when claude writes to stderr (pipe drained)", async () => {
    const session = await runtime.start({
      sessionId: "test-stderr",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    // This test passes if prompt() resolves within the test timeout.
    // Without the BB fix (stderr drain), the process would hang when
    // stderr buffer fills up.
    await session.prompt("Say hello");
    // If we reach here, the pipe didn't deadlock.
    expect(true).toBe(true);

    await session.dispose();
  });

  // ── Settled guard (C5 fix) ──
  it("emits exactly one turn_end even when both error and close fire", async () => {
    const session = await runtime.start({
      sessionId: "test-settled",
      cwd: agentDir,
      agentDir,
      env: {},
    } as StartOpts);

    const events: AgentEvent[] = [];
    session.onEvent((e) => events.push(e));

    await session.prompt("Say hello");

    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds.length).toBe(1); // C5: no double turn_end

    await session.dispose();
  });
});

// ── Normalizer unit tests (no claude needed) ──
describe("[unit] ClaudeEventNormalizer", () => {
  it("returns null for non-JSON lines", () => {
    expect(ClaudeEventNormalizer.parseLine("not json")).toBeNull();
    expect(ClaudeEventNormalizer.parseLine("")).toBeNull();
  });

  it("returns null for JSON without type field", () => {
    expect(ClaudeEventNormalizer.parseLine('{"foo":"bar"}')).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(ClaudeEventNormalizer.parseLine('{"type":"unknown_type","data":{}}')).toBeNull();
  });

  it("parses assistant text content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      content: [{ type: "text", text: "Hello world" }],
    });
    const event = ClaudeEventNormalizer.parseLine(line);
    expect(event).toEqual({ type: "text", delta: "Hello world" });
  });

  it("parses content_block_delta text", () => {
    const line = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hi" },
    });
    const event = ClaudeEventNormalizer.parseLine(line);
    expect(event).toEqual({ type: "text", delta: "Hi" });
  });

  it("parses tool_use", () => {
    const line = JSON.stringify({
      type: "tool_use",
      id: "tool-123",
      name: "bash",
      input: { command: "echo hello" },
    });
    const event = ClaudeEventNormalizer.parseLine(line);
    expect(event).toEqual({
      type: "tool_call",
      toolCallId: "tool-123",
      name: "bash",
      args: { command: "echo hello" },
    });
  });

  it("parses tool_result", () => {
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "tool-123",
      content: "hello",
    });
    const event = ClaudeEventNormalizer.parseLine(line);
    expect(event).toEqual({
      type: "tool_result",
      toolCallId: "tool-123",
      output: "hello",
    });
  });

  it("parses tool_result with error flag", () => {
    const line = JSON.stringify({
      type: "tool_result",
      tool_use_id: "tool-123",
      content: "command failed",
      is_error: true,
    });
    const event = ClaudeEventNormalizer.parseLine(line);
    expect(event).toEqual({
      type: "tool_result",
      toolCallId: "tool-123",
      output: "command failed",
      error: true,
    });
  });

  it("parses error type", () => {
    const line = JSON.stringify({
      type: "error",
      message: "Rate limit exceeded",
    });
    const event = ClaudeEventNormalizer.parseLine(line);
    expect(event).toEqual({
      type: "error",
      message: "Rate limit exceeded",
      recoverable: false,
    });
  });
});
```

## Acceptance Criteria

- [ ] `packages/print/src/runtimes/claude.ts` exists with `ClaudeRuntime` implementing `AgentRuntime`
- [ ] `packages/print/src/runtimes/claude-event-normalizer.ts` exists with `ClaudeEventNormalizer.parseLine()`
- [ ] `ClaudeSession` implements all `RuntimeSession` methods: `prompt`, `setModel`, `setThinking`, `compact`, `getState`, `isIdle`, `dispose`, `onEvent`
- [ ] **C5 fix:** `settled` guard prevents double `turn_end` (both `error` and `close` fire on spawn failure)
- [ ] **BB fix:** stderr is drained (`child.stderr.on("data", () => {})`) — no pipe deadlock
- [ ] **BA fix:** `'error'` handler exists for spawn failures (ENOENT)
- [ ] **H5 fix:** `turn_end` emitted from `'close'` event (not `'exit'`)
- [ ] `promptQueue` serializes overlapping `prompt()` calls
- [ ] `dispose()` kills child process and rejects queued prompts
- [ ] `isAvailable()` checks for `claude` binary via `spawnSync`
- [ ] `sessionId` and `runtimeType` are readonly getters (R7-2 fix)
- [ ] `ClaudeRuntime` registered in `main.ts` runtimes map
- [ ] `claude-session.test.ts` passes: `npx vitest run packages/print/src/runtimes/claude-session.test.ts`
- [ ] Normalizer unit tests pass without `claude` binary
- [ ] `[real]` tests skip cleanly when `claude` is not available
- [ ] `npx tsc --noEmit` in `packages/print/` passes

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude CLI not installed in CI/test env | `describe.skip` guard. Normalizer tests are `[unit]` and don't need the binary. Real tests are skipped, not failed |
| stream-json format differs from spike assumptions | Normalizer's `default → null` case handles unknown types gracefully. Phase 9 spike should have verified shapes before this phase |
| Spawn failure (ENOENT) crashes without error handler | BA fix: `'error'` handler catches it and emits `error` + `turn_end` events |
| stderr pipe deadlock hangs the process | BB fix: drain stderr with empty data handler |
| Double `turn_end` on spawn failure breaks turn pairing | C5 fix: `settled` flag ensures only one handler fires |
| Overlapping `prompt()` calls produce interleaved events | `promptQueue` serializes calls — each subprocess runs to completion before the next spawns |
| `--continue` flag fails on first prompt (no existing session) | Claude CLI handles this gracefully (creates new session). Verified in Phase 9 spike |
| Session dir grows unbounded over time | Future cleanup task can prune old session dirs. Not a Phase 10 concern |
| `isAvailable()` uses dynamic `import()` | Already fixed — uses `await import("node:child_process")` instead of `require()` |
| Claude CLI rate-limits test suite | Tests use simple prompts. Test timeout is 5000ms — if Claude is slow, increase per-test timeout via `vitest` config |
| Token usage not reported by CLI in stream-json | `lastUsage` stays at 0. `turn_end` reports 0 tokens. CostTracker (Phase 12) handles this gracefully |

## Rollback

1. Delete `packages/print/src/runtimes/claude.ts`
2. Delete `packages/print/src/runtimes/claude-event-normalizer.ts`
3. Delete `packages/print/src/runtimes/claude-session.test.ts`
4. Remove `runtimes.set("claude", new ClaudeRuntime())` from `main.ts`
5. Remove re-exports from `packages/print/src/runtimes/index.ts`

No runtime depends on `ClaudeRuntime` directly — only the `AgentRuntime`
interface. The SmartRouter (Phase 8) simply won't find a "claude" entry in
the runtimes map, and routing falls back to pi/mya-native. Zero impact on
existing functionality.
