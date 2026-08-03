# Phase 7: PromptEnricher — Memory Injection + Brain Capture (Full Implementation)

> Depends on: Phase 2 (SPI types — `EnrichContext`, `PromptEnricher`), Phase 5 (stubEnricher replacement)
> Estimated: 2h
> Spec reference: §5.1 (`EnrichContext` + `PromptEnricher` interfaces), §6.1 (PromptEnricher full impl),
> §7.2 (`RuntimeSessionAdapter` — enrich/capture call sites)

## Objective

Replace the Phase 5 `stubEnricher` (identity passthrough) with a full
`PromptEnricher` that:

1. **Injects memory context** before each prompt — calls `MemoryFacade.recall()`
   to retrieve relevant facts/takes/preferences and prepends them as a system
   block to the user's prompt.
2. **Captures outputs** after each turn — calls `Brain.recordFact()` to persist
   the assistant's response as a conversation fact for future recall.

**Why this phase exists:** Without memory injection, every agent session starts
from a blank slate. The user must re-state context ("I use TypeScript",
"the project is called mya") on every turn. With the enricher, recall() finds
relevant facts from prior sessions and injects them automatically. Without
output capture, the brain never learns from conversations — facts like "the
user prefers tabs" or "the auth module uses JWT" are lost when the session ends.

**Key design constraint:** The enricher **never blocks the prompt**. If recall
fails (memory backend down, query error), the original prompt is returned
unchanged. If capture fails (brain full, write error), the failure is logged
and swallowed. The enricher is a **best-effort optimization layer**, not a
critical path component.

**What this phase replaces:** The Phase 5 `stubEnricher` (spec §5.3):

```typescript
// BEFORE (Phase 5 stub):
export const stubEnricher: PromptEnricher = {
  async enrich(prompt) { return prompt; },  // identity passthrough
  async capture() {},                        // no-op
};

// AFTER (Phase 7 full impl):
export const enricher = new MemoryEnricher({ memory, brain });
```

## Deliverables

- `packages/print/src/runtimes/enricher.ts` — `MemoryEnricher` class implementing `PromptEnricher`
- `packages/print/src/runtimes/prompt-enricher.test.ts` — `[unit]` tests

## Implementation Steps

### Step 1 — Define the `MemoryEnricher` class

The enricher receives `MemoryFacade` (for recall) and `Brain` (for recordFact)
via constructor injection. This makes it testable with mocks and avoids tight
coupling to the agent lifecycle.

```typescript
// packages/print/src/runtimes/enricher.ts

import type {
  PromptEnricher,
  EnrichContext,
} from "@my-agent/core";
import type { MemoryFacade } from "@my-agent/memory";
import type { Brain } from "@my-agent/memory";

export interface MemoryEnricherConfig {
  memory: MemoryFacade;
  brain: Brain;
  /** Maximum number of memory hits to inject (default 5). Prevents prompt
   * bloat when recall returns many results. */
  maxInjectionHits?: number;
  /** Maximum characters of injected context (default 2000). Truncates the
   * combined recall block if it exceeds this. */
  maxInjectionChars?: number;
  /** Minimum recall score threshold (default 0.0 — all hits included). */
  minScore?: number;
}

/**
 * Full PromptEnricher implementation.
 *
 * enrich(): Injects memory context before the user's prompt.
 *   1. Calls MemoryFacade.recall(prompt) to find relevant facts/takes.
 *   2. Formats the top hits as a system block.
 *   3. Prepends the block to the prompt.
 *   4. On ANY error, returns the original prompt unchanged (never blocks).
 *
 * capture(): Persists the assistant's output to Brain for future recall.
 *   1. Calls Brain.recordFact() with the output text.
 *   2. On ANY error, logs a warning and swallows (never blocks).
 *
 * The enricher is constructed ONCE at startup (in main.ts) and passed to
 * RuntimePool, which passes it to RuntimeSessionAdapter (Phase 5).
 */
export class MemoryEnricher implements PromptEnricher {
  private readonly memory: MemoryFacade;
  private readonly brain: Brain;
  private readonly maxHits: number;
  private readonly maxChars: number;
  private readonly minScore: number;

  constructor(config: MemoryEnricherConfig) {
    this.memory = config.memory;
    this.brain = config.brain;
    this.maxHits = config.maxInjectionHits ?? 5;
    this.maxChars = config.maxInjectionChars ?? 2000;
    this.minScore = config.minScore ?? 0;
  }

  async enrich(prompt: string, ctx: EnrichContext): Promise<string> {
    try {
      // recall() is synchronous — returns MemoryDomainEntry[] immediately.
      // Each entry has { domain, hits: MemoryHit[] }.
      // F-7 fix: MemoryDomainOpts does not have sessionAware/sessionId fields.
      // Session-scoped recall requires extending MemoryDomainOpts in @my-agent/memory (IMPL).
      const results = this.memory.recall(prompt, {
        topK: this.maxHits,
      });

      // Flatten hits across all domains, filter by score, and take top N.
      const allHits = results
        .flatMap((d) => d.hits)
        .filter((h) => h.score >= this.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxHits);

      if (allHits.length === 0) return prompt;

      // Format the memory block
      const block = this.formatMemoryBlock(allHits, ctx);

      // Truncate if exceeds max chars
      const truncated = block.length > this.maxChars
        ? block.slice(0, this.maxChars) + "\n…[memory truncated]"
        : block;

      return `${truncated}\n\n---\n\n${prompt}`;
    } catch (e) {
      // CRITICAL: enrich failure must NEVER block the prompt.
      console.warn(`[enricher] recall failed: ${(e as Error).message}`);
      return prompt;
    }
  }

  async capture(output: string, ctx: EnrichContext): Promise<void> {
    if (!output.trim()) return;

    try {
      // Record the output as a conversation fact for future recall.
      // entity: the session (so recall can scope by session).
      // kind: "fact" — a neutral observation from the conversation.
      // source: the runtime type + session id (provenance).
      this.brain.recordFact({
        kind: "fact",
        entity: ctx.sessionId,
        content: output.slice(0, 4096), // Brain caps at 4096 chars anyway
        visibility: "private",
        notability: 1, // base notability; dream-cycle may promote via consolidate
        source: `${ctx.runtimeType}:${ctx.sessionId}`,
        // validUntil: undefined — no expiry (persistent until consolidated)
      });
    } catch (e) {
      // CRITICAL: capture failure must NEVER block the response.
      console.warn(`[enricher] capture failed: ${(e as Error).message}`);
    }
  }

  /**
   * Format memory hits into a system-prompt block.
   * Structure:
   *   ## Memory Context (auto-injected)
   *   - [domain] content (score: 0.85)
   *   - [domain] content (score: 0.72)
   */
  private formatMemoryBlock(
    hits: Array<{ content: string; score: number; role?: string }>,
    ctx: EnrichContext,
  ): string {
    const header = ctx.role
      ? `## Memory Context (role: ${ctx.role})`
      : "## Memory Context";

    const lines = hits.map((h) => {
      const roleTag = h.role ? `[${h.role}]` : "[memory]";
      const content = h.content.replace(/\n/g, " ").slice(0, 200); // one-line per hit
      return `- ${roleTag} ${content}`;
    });

    return `${header}\n${lines.join("\n")}`;
  }
}
```

### Step 2 — Wire into RuntimePool (replace stub)

In `main.ts`, replace the stub enricher with the real one:

```typescript
// packages/print/src/main.ts (Phase 7 wiring — replaces Phase 5 stub)

import { MemoryEnricher } from "./runtimes/enricher.js";

// The memory + brain instances are already created by createAgent() (Phase 4/5).
// Access them from the shared agent instance or the PiRuntimeDeps.
const enricher = new MemoryEnricher({
  memory: sharedMemory,   // MemoryManagerImpl instance from shared-instances.ts
  brain: sharedBrain,     // Brain instance from shared-instances.ts
});

// Replace: const enricher = stubEnricher;
// With: (already above)

const pool = new RuntimePool(router, runtimes, enricher, costTracker);
```

> **Shared instance note:** `memory` and `brain` are already created in
> `shared-instances.ts` (Phase 4/5 wiring). The enricher receives the SAME
> instances that pi sessions use — so facts recorded by mya-native are
> immediately visible to pi sessions and vice versa.

### Step 3 — Verify the adapter call sites (no code change needed)

The `RuntimeSessionAdapter` (Phase 5, spec §7.2) already calls enrich/capture
correctly:

```typescript
// RuntimeSessionAdapter.prompt() — already in Phase 5 code:

// enrich (before session.prompt):
let enriched = text;
try {
  enriched = await this.enricher.enrich(text, {
    sessionId: this.session.sessionId,
    runtimeType: this.session.runtimeType,
    executionModel: this.session.executionModel,
  });
} catch (e) { console.warn(`[adapter] enrich failed: ${e}`); }

// capture (after session.prompt):
if (this.textBuffer) {
  try {
    await this.enricher.capture(this.textBuffer, {
      sessionId: this.session.sessionId,
      runtimeType: this.session.runtimeType,
      executionModel: this.session.executionModel,
    });
  } catch (e) { console.warn(`[adapter] capture failed: ${e}`); }
}
```

No change needed — the adapter calls `enricher.enrich()` and
`enricher.capture()` with `EnrichContext`. The Phase 5 stub is a drop-in
replacement target; the Phase 7 `MemoryEnricher` implements the same interface.

### Step 4 — Write the test

```typescript
// packages/print/src/runtimes/prompt-enricher.test.ts

import { describe, it, expect, vi } from "vitest";
import { MemoryEnricher } from "./enricher.js";
import type { EnrichContext, MemoryHit } from "@my-agent/core";
import type { MemoryDomainEntry } from "@my-agent/memory";  // F-7 fix: from memory, not core

// ── Mock factories ──

function mockMemoryFacade(hits: MemoryHit[] = []) {
  const entries: MemoryDomainEntry[] = hits.length > 0
    ? [{ domain: "archivist", hits }]
    : [];
  return {
    recall: vi.fn((_query: string) => entries),
    record: vi.fn(),
    consolidate: vi.fn(),
  };
}

function mockBrain() {
  return {
    recordFact: vi.fn(() => ({ id: "fact-1", createdAt: Date.now() })),
    consolidate: vi.fn(() => ({ takesPromoted: 0, factsConsumed: 0 })),
    allFacts: new Map(),
    backlinks: vi.fn(() => []),
  };
}

function makeCtx(overrides: Partial<EnrichContext> = {}): EnrichContext {
  return {
    sessionId: "s1",
    runtimeType: "pi",
    executionModel: "in-process",
    ...overrides,
  };
}

describe("[unit] MemoryEnricher", () => {
  describe("enrich — memory injection", () => {
    it("prepends memory context when recall returns hits", async () => {
      const hits: MemoryHit[] = [
        { id: "hit", role: "archivist", content: "User prefers TypeScript", score: 0.9 },
        { id: "hit", role: "archivist", content: "Project uses tabs not spaces", score: 0.8 },
      ];
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("Write a function", makeCtx());

      // Memory block should be prepended
      expect(result).toContain("## Memory Context");
      expect(result).toContain("User prefers TypeScript");
      expect(result).toContain("Project uses tabs not spaces");
      // Original prompt should be after the separator
      expect(result).toContain("---");
      expect(result.endsWith("Write a function")).toBe(true);
    });

    it("returns raw prompt when recall returns no hits", async () => {
      const memory = mockMemoryFacade([]); // no hits
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("hello world", makeCtx());
      expect(result).toBe("hello world");
    });

    it("calls recall with the prompt as query", async () => {
      const memory = mockMemoryFacade([]);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      await enricher.enrich("how to deploy", makeCtx());
      expect(memory.recall).toHaveBeenCalledWith(
        "how to deploy",
        expect.objectContaining({ topK: 5 }),  // R2-3 fix: removed sessionAware
      );
    });

    it("recall options do not include sessionAware or sessionId (F-7 fix)", async () => {
      const memory = mockMemoryFacade([]);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      await enricher.enrich("test", makeCtx({ sessionId: "my-session" }));
      expect(memory.recall).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ topK: 5 }),  // R2-3 fix: no sessionId field
      );
      );
    });

    it("limits hits to maxInjectionHits", async () => {
      const hits: MemoryHit[] = Array.from({ length: 10 }, (_, i) => ({
        role: "archivist",
        content: `fact ${i}`,
        score: 0.5 + i * 0.01,
      }));
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({
        memory: memory as never,
        brain: brain as never,
        maxInjectionHits: 3,
      });

      const result = await enricher.enrich("test", makeCtx());
      // Count the number of "-" list items in the memory block
      const lines = result.split("\n").filter((l) => l.startsWith("- "));
      expect(lines).toHaveLength(3);
    });

    it("sorts hits by score descending", async () => {
      const hits: MemoryHit[] = [
        { id: "hit", role: "archivist", content: "low", score: 0.3 },
        { id: "hit", role: "archivist", content: "high", score: 0.9 },
        { id: "hit", role: "archivist", content: "mid", score: 0.6 },
      ];
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("test", makeCtx());
      const lines = result.split("\n").filter((l) => l.startsWith("- "));
      expect(lines[0]).toContain("high");
      expect(lines[1]).toContain("mid");
      expect(lines[2]).toContain("low");
    });

    it("filters hits below minScore threshold", async () => {
      const hits: MemoryHit[] = [
        { id: "hit", role: "archivist", content: "relevant", score: 0.8 },
        { id: "hit", role: "archivist", content: "irrelevant", score: 0.1 },
      ];
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({
        memory: memory as never,
        brain: brain as never,
        minScore: 0.5,
      });

      const result = await enricher.enrich("test", makeCtx());
      expect(result).toContain("relevant");
      expect(result).not.toContain("irrelevant");
    });

    it("truncates memory block when exceeding maxInjectionChars", async () => {
      const hits: MemoryHit[] = [
        { id: "hit", role: "archivist", content: "x".repeat(500), score: 0.9 },
        { id: "hit", role: "archivist", content: "y".repeat(500), score: 0.8 },
        { id: "hit", role: "archivist", content: "z".repeat(500), score: 0.7 },
      ];
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({
        memory: memory as never,
        brain: brain as never,
        maxInjectionChars: 800,
      });

      const result = await enricher.enrich("test", makeCtx());
      expect(result).toContain("[memory truncated]");
      // The total memory block (before the separator) should be ≤ 800 + truncation suffix
      const memoryBlock = result.split("\n\n---\n\n")[0]!;
      expect(memoryBlock.length).toBeLessThanOrEqual(820); // 800 + suffix
    });
  });

  describe("enrich — error handling (never blocks)", () => {
    it("returns raw prompt when recall throws", async () => {
      const memory = {
        recall: vi.fn(() => { throw new Error("DB connection failed"); }),
        record: vi.fn(),
        consolidate: vi.fn(),
      };
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("important prompt", makeCtx());
      expect(result).toBe("important prompt");
    });

    it("returns raw prompt when recall returns malformed data", async () => {
      const memory = {
        recall: vi.fn(() => { return null as never; }), // malformed
        record: vi.fn(),
        consolidate: vi.fn(),
      };
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("test", makeCtx());
      expect(result).toBe("test");
    });
  });

  describe("capture — brain recording", () => {
    it("calls brain.recordFact with the output", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      await enricher.capture("The answer is 42", makeCtx());

      expect(brain.recordFact).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "fact",
          content: "The answer is 42",
          visibility: "private",
          notability: 1,
        }),
      );
    });

    it("includes sessionId as entity for session-scoped recall", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      await enricher.capture("output text", makeCtx({ sessionId: "sess-abc" }));

      expect(brain.recordFact).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: "sess-abc",
        }),
      );
    });

    it("includes runtimeType in source field for provenance", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      await enricher.capture("output", makeCtx({ runtimeType: "mya-native", sessionId: "s1" }));

      expect(brain.recordFact).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "mya-native:s1",
        }),
      );
    });

    it("does NOT call recordFact when output is empty", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      await enricher.capture("", makeCtx());
      await enricher.capture("   \n  ", makeCtx()); // whitespace-only

      expect(brain.recordFact).not.toHaveBeenCalled();
    });

    it("truncates output to 4096 chars before recording", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const longOutput = "x".repeat(5000);
      await enricher.capture(longOutput, makeCtx());

      expect(brain.recordFact).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/^x{4096}$/),
        }),
      );
    });
  });

  describe("capture — error handling (never blocks)", () => {
    it("swallows error when brain.recordFact throws", async () => {
      const memory = mockMemoryFacade();
      const brain = {
        recordFact: vi.fn(() => { throw new Error("brain full"); }),
        consolidate: vi.fn(),
        allFacts: new Map(),
        backlinks: vi.fn(() => []),
      };
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      // Should NOT throw
      await expect(enricher.capture("output", makeCtx())).resolves.toBeUndefined();
    });
  });

  describe("EnrichContext fields", () => {
    it("uses ctx.role in memory block header when provided", async () => {
      const hits: MemoryHit[] = [
        { id: "hit", role: "archivist", content: "test fact", score: 0.9 },
      ];
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("test", makeCtx({ role: "coder" }));
      expect(result).toContain("role: coder");
    });

    it("omits role from header when ctx.role is undefined", async () => {
      const hits: MemoryHit[] = [
        { id: "hit", role: "archivist", content: "test fact", score: 0.9 },
      ];
      const memory = mockMemoryFacade(hits);
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = await enricher.enrich("test", makeCtx({ role: undefined }));
      expect(result).not.toContain("role:");
      expect(result).toContain("## Memory Context");
    });
  });

  describe("integration with RuntimeSessionAdapter contract", () => {
    it("enrich is async and returns a string", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = enricher.enrich("test", makeCtx());
      expect(result).toBeInstanceOf(Promise);
      expect(typeof await result).toBe("string");
    });

    it("capture is async and returns void", async () => {
      const memory = mockMemoryFacade();
      const brain = mockBrain();
      const enricher = new MemoryEnricher({ memory: memory as never, brain: brain as never });

      const result = enricher.capture("output", makeCtx());
      expect(result).toBeInstanceOf(Promise);
      expect(await result).toBeUndefined();
    });
  });
});
```

### Step 5 — Add re-export to runtimes barrel

```typescript
// packages/print/src/runtimes/index.ts
export { MemoryEnricher, type MemoryEnricherConfig } from "./enricher.js";
```

## Code Skeletons

### How the adapter uses the enricher (Phase 5 — no change)

```typescript
// RuntimeSessionAdapter.prompt() — already implemented in Phase 5:

async prompt(text: string): Promise<void> {
  // 1. ENRICH: inject memory context
  let enriched = text;
  try {
    enriched = await this.enricher.enrich(text, {
      sessionId: this.session.sessionId,
      runtimeType: this.session.runtimeType,
      executionModel: this.session.executionModel,
    });
  } catch (e) { /* enricher itself catches, but adapter double-guards */ }

  // 2. PROMPT: send enriched text to the runtime session
  await this.session.prompt(enriched);

  // 3. CAPTURE: record the assistant's output for future recall
  if (this.textBuffer) {
    try {
      await this.enricher.capture(this.textBuffer, {
        sessionId: this.session.sessionId,
        runtimeType: this.session.runtimeType,
        executionModel: this.session.executionModel,
      });
    } catch (e) { /* capture itself catches, but adapter double-guards */ }
  }
}
```

### Enrich → Prompt → Capture flow

```
User sends: "Write a deploy script"
                 │
                 ▼
    ┌────────────────────────────────┐
    │  RuntimeSessionAdapter.prompt() │
    └────────────┬───────────────────┘
                 │
    ┌────────────▼───────────────────┐
    │  MemoryEnricher.enrich()       │
    │                                │
    │  memory.recall("Write a       │
    │    deploy script")             │
    │  → hits: [                     │
    │      "user uses Docker",       │
    │      "project is TypeScript",  │
    │      "CI/CD via GitHub Actions"│
    │    ]                           │
    │                                │
    │  Returns:                      │
    │  "## Memory Context            │
    │   - [archivist] user uses...   │
    │   - [archivist] project is...  │
    │   - [archivist] CI/CD via...   │
    │                                │
    │   ---                          │
    │                                │
    │   Write a deploy script"       │
    └────────────┬───────────────────┘
                 │
    ┌────────────▼───────────────────┐
    │  session.prompt(enriched)       │
    │  → assistant generates output   │
    │  → events stream to listeners   │
    └────────────┬───────────────────┘
                 │
    ┌────────────▼───────────────────┐
    │  MemoryEnricher.capture()      │
    │                                │
    │  brain.recordFact({            │
    │    content: assistantOutput,    │
    │    entity: sessionId,           │
    │    source: "pi:s1",            │
    │  })                             │
    └────────────────────────────────┘
```

### Construction wiring (main.ts)

```typescript
// packages/print/src/main.ts

import { MemoryEnricher } from "./runtimes/enricher.js";

// sharedMemory + sharedBrain are already created in shared-instances.ts
// (the same instances used by PiInProcessRuntime's PiRuntimeDeps).
const enricher = new MemoryEnricher({
  memory: sharedMemory,
  brain: sharedBrain,
  maxInjectionHits: 5,    // default
  maxInjectionChars: 2000, // default
});

// Phase 5 used: const enricher = stubEnricher;
// Phase 7 replaces with the real MemoryEnricher above.
const pool = new RuntimePool(router, runtimes, enricher, costTracker);
```

## Test Plan

- **File:** `packages/print/src/runtimes/prompt-enricher.test.ts`
- **Tier:** `[unit]`
- **Cases:**
  1. enrich prepends memory context when recall returns hits
  2. enrich returns raw prompt when recall returns no hits
  3. enrich calls recall with the prompt as query
  4. enrich passes sessionId to recall for session-scoped queries
  5. enrich limits hits to maxInjectionHits
  6. enrich sorts hits by score descending
  7. enrich filters hits below minScore threshold
  8. enrich truncates memory block when exceeding maxInjectionChars
  9. enrich returns raw prompt when recall throws (never blocks)
  10. enrich returns raw prompt when recall returns malformed data
  11. capture calls brain.recordFact with the output
  12. capture includes sessionId as entity
  13. capture includes runtimeType in source field
  14. capture does NOT call recordFact when output is empty
  15. capture truncates output to 4096 chars
  16. capture swallows error when brain.recordFact throws (never blocks)
  17. enrich uses ctx.role in header when provided
  18. enrich omits role from header when undefined
  19. enrich is async and returns a string
  20. capture is async and returns void

## Acceptance Criteria

- [ ] `packages/print/src/runtimes/enricher.ts` exists with `MemoryEnricher` implementing `PromptEnricher`
- [ ] `enrich()` calls `MemoryFacade.recall()` with the prompt as query
- [ ] `enrich()` prepends memory context block when hits are returned
- [ ] `enrich()` returns the original prompt unchanged on ANY error (never blocks)
- [ ] `enrich()` respects `maxInjectionHits`, `maxInjectionChars`, `minScore` config
- [ ] `capture()` calls `Brain.recordFact()` with the assistant output
- [ ] `capture()` includes provenance (source = `runtimeType:sessionId`)
- [ ] `capture()` does NOT record empty/whitespace-only output
- [ ] `capture()` swallows errors silently (never blocks)
- [ ] `prompt-enricher.test.ts` passes: `npx vitest run packages/print/src/runtimes/prompt-enricher.test.ts`
- [ ] `npx tsc --noEmit` in `packages/print/` passes
- [ ] `stubEnricher` import removed from `main.ts` (replaced with `MemoryEnricher`)
- [ ] No real memory backend required for tests (all mocked)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `recall()` is synchronous but slow (FTS scan across many backends) | Called once per prompt; acceptable latency for most use cases. If profiling shows >100ms, add a short-circuit for prompts <10 chars (unlikely to have useful recall) |
| Memory injection bloats the prompt (token cost) | `maxInjectionHits` (5) + `maxInjectionChars` (2000) bound the block. Each hit is truncated to 200 chars one-liner. Total worst case: ~5 × 200 = 1000 chars |
| Recall returns irrelevant hits (noise) | `minScore` threshold filters low-relevance hits. Default 0.0 includes all; operators can raise the threshold via config |
| Brain.recordFact() called for every turn → brain grows unbounded | Brain already has a `maxFactsTotal` cap (10,000) and dream-cycle consolidation promotes facts to takes (consuming them). This is existing behavior — the enricher just feeds facts in |
| `capture()` records the FULL assistant output → facts are too long | Output truncated to 4096 chars before recording (Brain's own cap). One fact per turn is reasonable |
| Enricher shares the same memory/brain instances as pi sessions → cross-contamination | This is intentional: shared memory means cross-runtime context (facts from mya-native visible to pi). Session-scoped recall via `sessionId` prevents reading other sessions' facts |
| `MemoryDomainEntry` shape from recall() differs from mock | The mock returns `{ domain, hits }` which matches the `MemoryDomain` interface. If the real shape changes, the test mock must be updated — caught by `tsc --noEmit` |
| Concurrent enrich calls share the same memory instance | `recall()` is synchronous and stateless (read-only). No race condition. `recordFact()` is also synchronous (putFact). Thread-safe by design |
| `MemoryFacade` interface is from `@my-agent/memory` but `MemoryManagerImpl` implements it | The enricher depends on the interface, not the impl. `MemoryManagerImpl.withBrain()` returns a `MemoryManagerImpl` that satisfies `MemoryFacade`. Type-compatible |

## Rollback

1. Delete `packages/print/src/runtimes/enricher.ts`
2. Delete `packages/print/src/runtimes/prompt-enricher.test.ts`
3. Restore `stubEnricher` in `main.ts`:
   ```typescript
   // Revert to Phase 5 stub:
   const enricher = stubEnricher;
   ```
4. Remove the re-export from `packages/print/src/runtimes/index.ts`

No runtime depends on `MemoryEnricher` directly — only the `PromptEnricher`
interface. The stub satisfies the same interface, so rolling back has zero
impact on RuntimePool, RuntimeSessionAdapter, or any runtime session.
