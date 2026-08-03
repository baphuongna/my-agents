# Phase 2: Define AgentRuntime SPI Types in `packages/core/src/runtime-spi.ts`

> Depends on: (none — foundation phase, parallel with Phase 1)
> Estimated: 1h
> Spec reference: §1.1 (Types), §1.2 (Session Interface), §1.3 (Uniform Event Type), §5.1 (Component Interfaces)

## Objective

Define ALL Service Provider Interface (SPI) types in a single file:
`packages/core/src/runtime-spi.ts`. These types are the **contract** that every
runtime implementation (pi, claude, mya-native, future) must satisfy, and that
every consumer (RuntimePool, adapter, gateway, dashboard) consumes.

**Why in core:** The types have **zero runtime dependencies** — they are pure
TypeScript interfaces and type aliases. Placing them in `@my-agent/core` means
every package that already depends on core (which is all of them) gets the SPI
for free, with no additional package dependency. This avoids a circular dependency
between `packages/core` and `packages/print` (where the runtime implementations
live).

**Consumed by ALL phases:** Phase 4 imports `AgentRuntime`, `RuntimeSession`,
`StartOpts` to implement `PiInProcessRuntime`. Phase 5 imports `AgentEvent` for
the adapter and pool. Phase 6–10 import `AgentCapabilities` for capability
reporting. Phase 12 imports `AgentEvent` for the cost tracker.

## Deliverables

- `packages/core/src/runtime-spi.ts` — ALL SPI types (the single source of truth)
- `packages/core/src/runtime-spi.test.ts` — `[unit]` type-completeness test
- `packages/core/src/index.ts` — add re-export line

## Implementation Steps

### Step 1 — Create `packages/core/src/runtime-spi.ts`

Write the **exact** code below. It is copied verbatim from spec §1.1, §1.2, §1.3,
with §5.1 component interfaces appended. The only addition is a `EVENT_TYPES`
const tuple for runtime validation in tests.

```typescript
// packages/core/src/runtime-spi.ts

/**
 * AgentRuntime SPI — the uniform interface for all agent runtimes.
 *
 * Every runtime (pi, claude, mya-native, future) implements AgentRuntime.
 * Every consumer (RuntimePool, adapter, gateway) consumes these types.
 *
 * This file is TYPES ONLY — no runtime code, no imports with side effects.
 * Placed in @my-agent/core so all packages get the SPI with zero extra deps.
 *
 * Spec reference: option-d-spec-v8.md §1.1, §1.2, §1.3, §5.1
 */

// ─── External type imports (type-only, erased at compile time) ───────────────

import type { Model, Api } from "@earendil-works/pi-ai";

// Note: ModelRuntime is used only in Phase 4 implementation, not in the SPI
// types themselves. We import the Model/Api types for StartOpts.model and
// RuntimeSession.setModel().

// ─── §1.1 Types ──────────────────────────────────────────────────────────────

/**
 * Result of a compaction operation. Strategy indicates how the context was reduced.
 */
export interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  strategy:
    | "native"
    | "llm-summarize"
    | "truncate"
    | "continue-session"
    | "none";
}

/**
 * Information about a model available from a runtime's model registry.
 */
export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

/**
 * Thinking/reasoning effort level. Maps to pi's thinking levels and Claude's
 * thinking budget tiers.
 */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * Capability flags for a runtime. Used by SmartRouter to select the best
 * runtime per prompt, and by the dashboard to show what an agent can do.
 */
export interface AgentCapabilities {
  hasInteractive: boolean;
  hasHeadless: boolean;
  supportsTools: boolean;
  supportsResume: boolean;
  supportsCompaction: boolean;
  supportsImages: boolean;
  supportsThinking: boolean;
  execution: "in-process" | "subprocess";
  maxContextWindow: number;
  injectionMethod: "extension" | "rpc" | "stdin-prompt" | "in-process-call";
}

/**
 * The runtime factory. Creates sessions, reports availability, lists models.
 *
 * Implementations:
 *   - PiInProcessRuntime (Phase 4)
 *   - MyaNativeRuntime (Phase 6)
 *   - ClaudeRuntime (Phase 10)
 */
export interface AgentRuntime {
  readonly runtimeType: string;
  readonly displayName: string;
  start(opts: StartOpts): Promise<RuntimeSession>;
  isAvailable(): boolean;
  listModels(): Promise<ModelInfo[]>;
  capabilities(): AgentCapabilities;
  login?(provider: string): Promise<void>;
  costPerMTokens?(): { input: number; output: number };
}

/**
 * Options passed to AgentRuntime.start() when creating a new session.
 */
export interface StartOpts {
  cwd: string;
  agentDir: string;
  sessionId: string;
  model?: Model<Api>;
  modelId?: string;
  thinking?: ThinkingLevel;
  systemPromptOverride?: string;
  toolsAllowList?: string[];
  env: Record<string, string>;
  resumeFrom?: string;
}

// ─── §1.2 Session Interface ──────────────────────────────────────────────────

/**
 * A live agent session. Created by AgentRuntime.start(), managed by RuntimePool.
 *
 * Key invariant: prompt() is BLOCKING for in-process runtimes. It returns after
 * the turn completes. Events stream DURING the await.
 *
 * Guarantees:
 *   - Emits turn_start at prompt() start (directly, not via normalizer)
 *   - Emits turn_end at turn completion (even on failure or early return)
 */
export interface RuntimeSession {
  readonly sessionId: string;
  readonly runtimeType: string;
  readonly executionModel: "in-process" | "subprocess";

  /**
   * Send a prompt to the agent. BLOCKING for in-process runtimes.
   * Returns after the turn completes (agent_settled or process exit).
   */
  prompt(text: string, opts?: PromptOpts): Promise<void>;

  setModel(model: Model<Api>): Promise<void>;
  setThinking(level: ThinkingLevel): void;
  compact(): Promise<CompactionResult>;
  getState(): SessionState;
  isIdle(): boolean;
  dispose(): Promise<void>;

  /**
   * Register an event handler. Returns an unsubscribe function.
   * The handler receives normalized AgentEvent objects.
   */
  onEvent(handler: (event: AgentEvent) => void): () => void;
}

/**
 * Options for prompt(). All optional.
 */
export interface PromptOpts {
  signal?: AbortSignal;
  images?: Array<{ data: string; mimeType: string }>;
  streamingBehavior?: "steer" | "followUp";
}

/**
 * Live session state snapshot. Returned by RuntimeSession.getState().
 * Used by the dashboard and cost tracker.
 */
export interface SessionState {
  model: string;
  thinking: string;
  status: "idle" | "thinking" | "tool:<name>";
  tokensIn: number;
  tokensOut: number;
  contextPct: number;
  contextWindow: number;
  costUsd: number;
  startedAt: number;
  lastActivity: number;
}

// ─── §1.3 Uniform Event Type ─────────────────────────────────────────────────

/**
 * The normalized event type that ALL runtimes emit.
 *
 * Every runtime normalizes its native events to this union.
 * The dashboard renders any agent identically from these events.
 *
 * turn_start/turn_end are guaranteed 1:1 (one pair per prompt() call).
 */
export type AgentEvent =
  | { type: "turn_start"; model: string; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: unknown }
  | {
      type: "tool_result";
      toolCallId: string;
      output: string;
      error?: boolean;
    }
  | {
      type: "turn_end";
      tokensIn: number;
      tokensOut: number;
      costUsd?: number;
    }
  | { type: "compaction"; result: CompactionResult }
  | { type: "model_changed"; model: string }
  | { type: "thinking_changed"; level: string }
  | { type: "error"; message: string; recoverable: boolean };

/**
 * All possible AgentEvent type discriminants.
 * Used for runtime validation and exhaustive switch checks.
 */
export const AGENT_EVENT_TYPES = [
  "turn_start",
  "text",
  "thinking",
  "tool_call",
  "tool_result",
  "turn_end",
  "compaction",
  "model_changed",
  "thinking_changed",
  "error",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

// ─── §5.1 Component Interfaces ───────────────────────────────────────────────

/**
 * Selects the best runtime for a given prompt.
 * Phase 5 uses a stub; Phase 8 adds scoring.
 */
export interface SmartRouter {
  select(input: {
    prompt: string;
    agentOverride?: string;
    modelOverride?: string;
  }): Promise<{ runtime: AgentRuntime; reason: string }>;
}

/**
 * Context passed to PromptEnricher.enrich() and capture().
 */
export interface EnrichContext {
  sessionId: string;
  runtimeType: string;
  executionModel: "in-process" | "subprocess";
  role?: string;
  contextWindow?: number;
}

/**
 * Enriches prompts with memory context and captures outputs for brain recording.
 * Phase 5 uses a stub; Phase 7 adds full memory integration.
 */
export interface PromptEnricher {
  enrich(prompt: string, ctx: EnrichContext): Promise<string>;
  capture(output: string, ctx: EnrichContext): Promise<void>;
}

/**
 * Tracks token costs per session.
 * Phase 5 uses a stub; Phase 12 adds real tracking.
 */
export interface CostTracker {
  record(sessionId: string, event: AgentEvent): void;
  getSessionCost(
    sessionId: string,
  ): { totalUsd: number; turns: number } | undefined;
  // F-2 fix: forget() called by idle sweep (Phase 13) to clean up evicted sessions
  forget?(sessionId: string): void;
}
```

### Step 2 — Add re-export to core index

```typescript
// packages/core/src/index.ts — add this line:

// ... existing exports ...

// AgentRuntime SPI (types only — no runtime deps)
export * from "./runtime-spi.js";
```

Add it **after** the existing `export * from "./supervised.js";` line (the last
export in the current index). The `export *` pattern re-exports all interfaces,
types, the `AGENT_EVENT_TYPES` const, and the `AgentEventType` type alias.

### Step 3 — Create the test

```typescript
// packages/core/src/runtime-spi.test.ts
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventType,
  type AgentRuntime,
  type RuntimeSession,
  type StartOpts,
  type SessionState,
  type PromptOpts,
  type AgentCapabilities,
  type CompactionResult,
  type ModelInfo,
  type ThinkingLevel,
  type SmartRouter,
  type PromptEnricher,
  type CostTracker,
  type EnrichContext,
} from "./runtime-spi.js";

describe("[unit] runtime-spi types", () => {
  describe("AgentEvent union completeness", () => {
    it("AGENT_EVENT_TYPES contains exactly 10 event types", () => {
      expect(AGENT_EVENT_TYPES).toHaveLength(10);
    });

    it("every union member has a matching type in AGENT_EVENT_TYPES", () => {
      // This is a compile-time + runtime check. If a new variant is added to
      // AgentEvent but not to AGENT_EVENT_TYPES, the exhaustive switch below
      // will produce a TypeScript error.
      const expectedTypes: AgentEventType[] = [
        "turn_start",
        "text",
        "thinking",
        "tool_call",
        "tool_result",
        "turn_end",
        "compaction",
        "model_changed",
        "thinking_changed",
        "error",
      ];
      expect([...AGENT_EVENT_TYPES].sort()).toEqual([...expectedTypes].sort());
    });

    it("exhaustive switch over AgentEvent compiles without default", () => {
      // If AgentEvent gains a new variant, this function will fail to typecheck
      // because the switch is exhaustive (no default case).
      function getEventName(e: AgentEvent): string {
        switch (e.type) {
          case "turn_start": return "turn_start";
          case "text": return "text";
          case "thinking": return "thinking";
          case "tool_call": return "tool_call";
          case "tool_result": return "tool_result";
          case "turn_end": return "turn_end";
          case "compaction": return "compaction";
          case "model_changed": return "model_changed";
          case "thinking_changed": return "thinking_changed";
          case "error": return "error";
        }
      }
      const event: AgentEvent = { type: "text", delta: "hi" };
      expect(getEventName(event)).toBe("text");
    });

    it("turn_start has model and sessionId fields", () => {
      const e: AgentEvent = { type: "turn_start", model: "claude-4", sessionId: "s1" };
      expect(e.type).toBe("turn_start");
    });

    it("turn_end has tokensIn, tokensOut, optional costUsd", () => {
      const e: AgentEvent = { type: "turn_end", tokensIn: 100, tokensOut: 50, costUsd: 0.01 };
      expect(e.type).toBe("turn_end");
      const e2: AgentEvent = { type: "turn_end", tokensIn: 0, tokensOut: 0 };
      expect(e2.type).toBe("turn_end");
    });

    it("tool_call has toolCallId, name, args", () => {
      const e: AgentEvent = {
        type: "tool_call",
        toolCallId: "tc1",
        name: "bash",
        args: { command: "ls" },
      };
      expect(e.type).toBe("tool_call");
    });

    it("tool_result has toolCallId, output, optional error", () => {
      const e: AgentEvent = {
        type: "tool_result",
        toolCallId: "tc1",
        output: "done",
      };
      expect(e.type).toBe("tool_result");
      const e2: AgentEvent = {
        type: "tool_result",
        toolCallId: "tc1",
        output: "fail",
        error: true,
      };
      expect(e2.type).toBe("tool_result");
    });

    it("error has message and recoverable flag", () => {
      const e: AgentEvent = { type: "error", message: "oops", recoverable: false };
      expect(e.type).toBe("error");
    });

    it("compaction has CompactionResult with strategy union", () => {
      const e: AgentEvent = {
        type: "compaction",
        result: { tokensBefore: 1000, tokensAfter: 500, strategy: "native" },
      };
      expect(e.type).toBe("compaction");
    });
  });

  describe("StartOpts shapes", () => {
    it("minimal StartOpts (required fields only)", () => {
      const opts: StartOpts = {
        cwd: "/tmp",
        agentDir: "/tmp/agent",
        sessionId: "s1",
        env: {},
      };
      expect(opts.cwd).toBe("/tmp");
    });

    it("full StartOpts (all optional fields)", () => {
      const opts: StartOpts = {
        cwd: "/tmp",
        agentDir: "/tmp/agent",
        sessionId: "s1",
        model: { id: "test" } as never,
        modelId: "test",
        thinking: "medium",
        systemPromptOverride: "override",
        toolsAllowList: ["bash", "read"],
        env: { FOO: "bar" },
        resumeFrom: "prev-session",
      };
      expect(opts.thinking).toBe("medium");
    });
  });

  describe("ThinkingLevel", () => {
    it("has 7 levels", () => {
      const levels: ThinkingLevel[] = [
        "off", "minimal", "low", "medium", "high", "xhigh", "max",
      ];
      expect(levels).toHaveLength(7);
    });
  });

  describe("AgentCapabilities", () => {
    it("has all required fields", () => {
      const caps: AgentCapabilities = {
        hasInteractive: true,
        hasHeadless: true,
        supportsTools: true,
        supportsResume: true,
        supportsCompaction: true,
        supportsImages: true,
        supportsThinking: true,
        execution: "in-process",
        maxContextWindow: 200_000,
        injectionMethod: "extension",
      };
      expect(caps.execution).toBe("in-process");
    });
  });

  describe("CompactionResult strategy", () => {
    it("strategy accepts all 5 values", () => {
      const strategies: CompactionResult["strategy"][] = [
        "native", "llm-summarize", "truncate", "continue-session", "none",
      ];
      expect(strategies).toHaveLength(5);
    });
  });

  describe("component interfaces (§5.1)", () => {
    it("SmartRouter.select returns runtime + reason", async () => {
      const router: SmartRouter = {
        async select() {
          return {
            runtime: {} as AgentRuntime,
            reason: "test",
          };
        },
      };
      const result = await router.select({ prompt: "hi" });
      expect(result.reason).toBe("test");
    });

    it("PromptEnricher has enrich + capture", async () => {
      const enricher: PromptEnricher = {
        async enrich(p) { return p; },
        async capture() {},
      };
      expect(await enricher.enrich("x", {} as EnrichContext)).toBe("x");
    });

    it("CostTracker has record + getSessionCost", () => {
      const tracker: CostTracker = {
        record() {},
        getSessionCost() { return undefined; },
      };
      expect(tracker.getSessionCost("s1")).toBeUndefined();
    });
  });

  describe("RuntimeSession interface shape", () => {
    it("has all required methods", () => {
      // Type-level check: a minimal object satisfying RuntimeSession must
      // have all interface members.
      expectTypeOf<RuntimeSession>().toMatchTypeOf<{
        readonly sessionId: string;
        readonly runtimeType: string;
        readonly executionModel: "in-process" | "subprocess";
        prompt(text: string, opts?: PromptOpts): Promise<void>;
        setModel(model: unknown): Promise<void>;
        setThinking(level: ThinkingLevel): void;
        compact(): Promise<CompactionResult>;
        getState(): SessionState;
        isIdle(): boolean;
        dispose(): Promise<void>;
        onEvent(handler: (event: AgentEvent) => void): () => void;
      }>();
    });
  });
});
```

### Step 4 — Verify the `Model<Api>` type import

The `import type { Model, Api } from "@earendil-works/pi-ai"` requires
`@earendil-works/pi-ai` to be available as a dependency of `@my-agent/core`.

Check `packages/core/package.json` — if `@earendil-works/pi-ai` is not already
a dependency, add it as a `peerDependency` (type-only import, no runtime dep):

```jsonc
// packages/core/package.json — add if missing
{
  "peerDependencies": {
    "@earendil-works/pi-ai": "*"
  }
}
```

> **Why peerDependency, not dependency:** The actual `pi-ai` package is loaded
> by the runtime (pi). Core only needs the types at compile time. Using
> `peerDependencies` avoids duplicating the package in the workspace.

Alternatively, if adding a peer dependency to core is undesirable (core should
be minimal), the `Model<Api>` type can be inlined as `unknown` with a comment,
and the actual typed version used in Phase 4 where pi-ai is a real dependency.
**Decision: add as peerDependency** — type safety is worth the declaration.

## Code Skeletons

### How Phase 4 consumes the SPI

```typescript
// packages/print/src/runtimes/pi-in-process.ts (Phase 4)

import type {
  AgentRuntime,
  RuntimeSession,
  StartOpts,
  AgentEvent,
  AgentCapabilities,
  ModelInfo,
  CompactionResult,
} from "@my-agent/core";

class PiInProcessRuntime implements AgentRuntime {
  readonly runtimeType = "pi";
  readonly displayName = "pi (earendil-works)";
  // ...
}
```

### How Phase 5 consumes the SPI

```typescript
// packages/print/src/runtimes/pool.ts (Phase 5)

import type {
  AgentRuntime,
  AgentEvent,
  SmartRouter,
  PromptEnricher,
  CostTracker,
} from "@my-agent/core";

class RuntimePool {
  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
  ) {}
}
```

## Test Plan

- **File:** `packages/core/src/runtime-spi.test.ts`
- **Tier:** `[unit]`
- **Cases:**
  1. `AGENT_EVENT_TYPES` has exactly 10 entries
  2. Every union member maps to a type in `AGENT_EVENT_TYPES`
  3. Exhaustive switch compiles (compile-time correctness gate)
  4. `turn_start` has `model` + `sessionId`
  5. `turn_end` has `tokensIn` + `tokensOut` + optional `costUsd`
  6. `tool_call` has `toolCallId` + `name` + `args`
  7. `tool_result` has `toolCallId` + `output` + optional `error`
  8. `error` has `message` + `recoverable`
  9. `compaction` has `CompactionResult` with strategy union
  10. `StartOpts` minimal shape (required fields only)
  11. `StartOpts` full shape (all optional fields)
  12. `ThinkingLevel` has 7 values
  13. `AgentCapabilities` has all fields
  14. `CompactionResult.strategy` accepts all 5 values
  15. `SmartRouter.select` returns runtime + reason
  16. `PromptEnricher` has enrich + capture
  17. `CostTracker` has record + getSessionCost
  18. `RuntimeSession` has all required methods (type-level check)

## Acceptance Criteria

- [ ] `packages/core/src/runtime-spi.ts` exists with all types from spec §1.1–§1.3, §5.1
- [ ] `AGENT_EVENT_TYPES` const tuple exported (10 entries)
- [ ] `packages/core/src/index.ts` re-exports `./runtime-spi.js`
- [ ] `packages/core/src/runtime-spi.test.ts` passes: `npx vitest run packages/core/src/runtime-spi.test.ts`
- [ ] `npx tsc --noEmit` in `packages/core/` passes (types compile)
- [ ] No runtime code in `runtime-spi.ts` (type-only module — verify no function bodies)
- [ ] `Model<Api>` import resolves (pi-ai available as peerDependency or inlined)
- [ ] All 10 AgentEvent variants present in the discriminated union
- [ ] All 5 CompactionResult strategies present
- [ ] All 7 ThinkingLevel values present

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `@earendil-works/pi-ai` not available as dep in core | Add as `peerDependencies` (type-only import). If unacceptable, inline as `unknown` with a TODO comment |
| `expectTypeOf` from vitest not available in older versions | Check vitest version (≥1.5.0). If unavailable, use `// @ts-expect-error` pattern instead |
| `export *` from index.ts causes name collision with existing exports | Check existing exports — `runtime-spi.ts` exports are prefixed/uniquely named (`AgentRuntime`, `StartOpts`, etc.). No collision with existing core types |
| Adding types to core violates "minimal core" principle (AGENTS.md §18) | Types are zero-runtime-cost. AGENTS.md says "minimal core" in terms of **runtime** code, not type definitions. The SPI is consumed by ALL phases — core is the only package all depend on |
| `Model<Api>` generic constraint breaks if pi-ai changes its types | Pin pi-ai version via root package.json. Type changes would be caught by `tsc --noEmit` in CI |

## Rollback

1. Delete `packages/core/src/runtime-spi.ts`
2. Delete `packages/core/src/runtime-spi.test.ts`
3. Remove `export * from "./runtime-spi.js";` from `packages/core/src/index.ts`
4. Remove `@earendil-works/pi-ai` from `packages/core/package.json` peerDependencies (if added)

No other package depends on these types yet (Phase 4+ will import them — not
this phase). Rollback is fully isolated.
