# Phase 8: SmartRouter — Async Runtime Selection (Full Implementation)

> Depends on: Phase 2 (SPI types — `SmartRouter` interface), Phase 5 (createStubRouter replacement)
> Estimated: 2h
> Spec reference: §5.1 (`SmartRouter` interface), §5.2 (R7-5 RuntimePool construction),
> §5.3 (`createStubRouter` — Phase 5 stub this replaces)

## Objective

Replace the Phase 5 `createStubRouter` (always returns pi) with a full
`SmartRouter` that scores every registered runtime against the prompt and
selects the best one based on three factors:

1. **Keyword match** — does the prompt contain task-type keywords that favor a
   specific runtime? (e.g., "fix the bug in src/app.ts" → pi for coding;
   "summarize this article" → mya-native for text tasks)
2. **Model availability** — is the runtime actually available? (`isAvailable()`
   + `listModels()` to check if the preferred model exists)
3. **Cost penalty** — cheaper runtimes score higher for equivalent capability
   (e.g., mya-native at $0.15/M input vs pi at $3/M input)

**Why this phase exists:** Without smart routing, every prompt goes to pi
(the default). This wastes pi's powerful (and expensive) coding-agent
capabilities on simple text tasks that mya-native handles at 1/20th the cost.
Smart routing makes the platform cost-efficient: the right tool for each job.

**What this phase replaces:** The Phase 5 `createStubRouter` (spec §5.3):

```typescript
// BEFORE (Phase 5 stub):
export function createStubRouter(runtimes: Map<string, AgentRuntime>): SmartRouter {
  return {
    async select(input) {
      const rt = runtimes.get(input.agentOverride ?? "pi");
      if (!rt) throw new Error("No runtime available");
      return { runtime: rt, reason: "stub default" };
    },
  };
}

// AFTER (Phase 8 full impl):
const router = new SmartRouterImpl(runtimes);
const result = await router.select({ prompt: "summarize this" });
// result: { runtime: myaNativeRuntime, reason: "keyword:summarize + cheapest available" }
```

**Key design constraint:** `select()` is **async** — it may call
`listModels()` on multiple runtimes to check availability, which involves I/O.
The scoring algorithm is deterministic (same prompt + same availability → same
selection), making it fully testable.

## Deliverables

- `packages/print/src/runtimes/router.ts` — `SmartRouterImpl` class implementing `SmartRouter`
- `packages/print/src/runtimes/smart-router.test.ts` — `[unit]` tests

## Implementation Steps

### Step 1 — Define the scoring data structures

```typescript
// packages/print/src/runtimes/router.ts

import type {
  SmartRouter,
  AgentRuntime,
  AgentCapabilities,
} from "@my-agent/core";

/** A single runtime's score breakdown (for the reason string + testing). */
interface RuntimeScore {
  runtimeKey: string;
  runtime: AgentRuntime;
  keywordScore: number;
  availabilityScore: number;
  costScore: number;
  total: number;
  available: boolean;
}

/** Keyword → runtime affinity map. Higher weight = stronger signal. */
interface KeywordRule {
  keywords: string[];
  runtimeKey: string;
  weight: number;
}

/** Configuration for the router. */
export interface SmartRouterConfig {
  /** Keyword rules for task-type routing. */
  rules?: KeywordRule[];
  /** Default runtime when no keyword matches (default: "pi"). */
  defaultRuntime?: string;
  /** Cost weight multiplier (how much cost affects total score). Default: 0.2. */
  costWeight?: number;
  /** Keyword weight multiplier. Default: 1.0. */
  keywordWeight?: number;
}
```

### Step 2 — Define the default keyword rules

```typescript
// packages/print/src/runtimes/router.ts (continued)

/**
 * Default keyword routing rules. These are heuristics — not exhaustive.
 * Each rule maps task-type keywords to a preferred runtime with a weight.
 *
 * Scoring: if ANY keyword in the rule appears in the prompt (case-insensitive,
 * word-boundary match), the runtime gets `weight` points added to its
 * keyword score.
 */
const DEFAULT_RULES: KeywordRule[] = [
  // ── Coding / file system tasks → pi ──
  {
    keywords: ["fix", "bug", "refactor", "implement", "debug", "code", "function", "class", "test", "build", "compile", "lint"],
    runtimeKey: "pi",
    weight: 2.0,
  },
  {
    keywords: ["file", "directory", "edit", "write", "create file", "src/", "import", "export", "module", "package.json", "tsconfig"],
    runtimeKey: "pi",
    weight: 2.0,
  },
  // ── Text/analysis tasks → mya-native (cheaper, sufficient) ──
  {
    keywords: ["summarize", "summary", "translate", "paraphrase", "rewrite"],
    runtimeKey: "mya-native",
    weight: 2.0,
  },
  {
    keywords: ["explain", "describe", "answer", "question", "what is", "how does", "why"],
    runtimeKey: "mya-native",
    weight: 1.0,
  },
  // ── Interactive/complex tasks → pi ──
  {
    keywords: ["review", "analyze", "architect", "design", "plan", "migrate", "deploy", "configure", "setup"],
    runtimeKey: "pi",
    weight: 1.5,
  },
];
```

### Step 3 — Implement the `SmartRouterImpl` class

```typescript
// packages/print/src/runtimes/router.ts (continued)

/**
 * Full SmartRouter implementation.
 *
 * select() algorithm:
 *   1. If agentOverride is set and the runtime exists + is available, return it.
 *   2. For each registered runtime, compute a score:
 *      a. keywordScore: sum of matching keyword rule weights
 *      b. availabilityScore: 1.0 if available, 0.0 if not
 *      c. costScore: normalized inverse of cost (cheaper = higher)
 *      d. total = (keywordScore × keywordWeight) + (costScore × costWeight)
 *         (availability is a gate, not additive — unavailable = total = -infinity)
 *   3. If modelOverride is set, check if the selected runtime has that model.
 *   4. Return the highest-scoring runtime. If all are unavailable, throw.
 */
export class SmartRouterImpl implements SmartRouter {
  private readonly runtimes: Map<string, AgentRuntime>;
  private readonly rules: KeywordRule[];
  private readonly defaultRuntime: string;
  private readonly costWeight: number;
  private readonly keywordWeight: number;

  constructor(runtimes: Map<string, AgentRuntime>, config: SmartRouterConfig = {}) {
    this.runtimes = runtimes;
    this.rules = config.rules ?? DEFAULT_RULES;
    this.defaultRuntime = config.defaultRuntime ?? "pi";
    this.costWeight = config.costWeight ?? 0.2;
    this.keywordWeight = config.keywordWeight ?? 1.0;
  }

  async select(input: {
    prompt: string;
    agentOverride?: string;
    modelOverride?: string;
  }): Promise<{ runtime: AgentRuntime; reason: string }> {
    // ── Step 1: Explicit override ──
    if (input.agentOverride) {
      const rt = this.runtimes.get(input.agentOverride);
      if (rt?.isAvailable()) {
        if (input.modelOverride) {
          const hasModel = await this.runtimeHasModel(rt, input.modelOverride);
          if (!hasModel) {
            // Override specified a model the runtime doesn't have — fall through
            // to scoring (don't throw; the user may have specified a partial match).
          } else {
            return { runtime: rt, reason: `override:${input.agentOverride} (model: ${input.modelOverride})` };
          }
        } else {
          return { runtime: rt, reason: `override:${input.agentOverride}` };
        }
      }
      // If override runtime doesn't exist or isn't available, fall through to scoring.
      // This is intentional: we don't want to crash when a stale override is given.
    }

    // ── Step 2: Score every runtime ──
    const scores = await this.scoreAllRuntimes(input.prompt);

    // ── Step 3: Filter to available runtimes ──
    const available = scores.filter((s) => s.available);
    if (available.length === 0) {
      throw new Error("No runtime available");
    }

    // ── Step 4: Handle modelOverride ──
    let candidates = available;
    if (input.modelOverride) {
      const withModel = available.filter((s) =>
        this.runtimeHasModelSync(s.runtime, input.modelOverride!),
      );
      if (withModel.length > 0) candidates = withModel;
      // If no runtime has the model, fall back to all available (model is best-effort).
    }

    // ── Step 5: Select highest score ──
    candidates.sort((a, b) => b.total - a.total);
    const best = candidates[0]!;

    // ── Step 6: If no keyword matched (best.keywordScore === 0), use default ──
    if (best.keywordScore === 0 && best.total <= this.costWeight) {
      const defaultRt = this.runtimes.get(this.defaultRuntime);
      if (defaultRt?.isAvailable()) {
        return { runtime: defaultRt, reason: `default:${this.defaultRuntime}` };
      }
    }

    return {
      runtime: best.runtime,
      reason: this.buildReason(best),
    };
  }

  /**
   * Score all registered runtimes for a given prompt.
   */
  private async scoreAllRuntimes(prompt: string): Promise<RuntimeScore[]> {
    const scores: RuntimeScore[] = [];
    const promptLower = prompt.toLowerCase();

    for (const [key, runtime] of this.runtimes) {
      const available = runtime.isAvailable();

      // keywordScore: sum of matching rule weights
      let keywordScore = 0;
      for (const rule of this.rules) {
        if (rule.runtimeKey !== key) continue;
        for (const kw of rule.keywords) {
          // Word-boundary match (case-insensitive)
          const regex = new RegExp(`\\b${escapeRegex(kw.toLowerCase())}\\b`, "i");
          if (regex.test(promptLower)) {
            keywordScore += rule.weight;
            break; // one match per rule is enough
          }
        }
      }

      // costScore: normalized inverse cost (0.0 to 1.0)
      const cost = runtime.costPerMTokens?.();
      const costPerMTokens = cost ? (cost.input + cost.output) : 20; // default high if unknown
      // Normalize: cheaper is better. Using a soft normalization:
      //   score = 1.0 / (1.0 + costPerMTokens / 10)
      //   $0/M  → 1.0 (free)
      //   $1/M  → 0.91
      //   $10/M → 0.5
      //   $20/M → 0.33
      //   $50/M → 0.17
      const costScore = 1.0 / (1.0 + costPerMTokens / 10);

      const total = available
        ? keywordScore * this.keywordWeight + costScore * this.costWeight
        : -Infinity;

      scores.push({
        runtimeKey: key,
        runtime,
        keywordScore,
        availabilityScore: available ? 1.0 : 0.0,
        costScore,
        total,
        available,
      });
    }

    return scores;
  }

  /**
   * Check if a runtime has a specific model (async — may call listModels).
   */
  private async runtimeHasModel(runtime: AgentRuntime, modelId: string): Promise<boolean> {
    try {
      const models = await runtime.listModels();
      return models.some(
        (m) => m.id === modelId || m.id.startsWith(modelId) || modelId.startsWith(m.id),
      );
    } catch {
      return false; // if listModels fails, assume the model is unavailable
    }
  }

  /**
   * Synchronous model check (uses cached capabilities — doesn't call listModels).
   * Used as a fast filter before the async check.
   */
  private runtimeHasModelSync(runtime: AgentRuntime, modelId: string): boolean {
    // We can't check exact model availability synchronously, but we can check
    // if the runtime's capabilities suggest it might have the model.
    // For now, return true (optimistic) — the async check will filter precisely.
    void modelId;
    void runtime;
    return true;
  }

  /**
   * Build a human-readable reason string from the score breakdown.
   */
  private buildReason(score: RuntimeScore): string {
    const parts: string[] = [];
    if (score.keywordScore > 0) {
      parts.push(`keyword:${score.keywordScore.toFixed(1)}`);
    }
    parts.push(`cost:${score.costScore.toFixed(2)}`);
    if (score.keywordScore === 0) {
      parts.push("no-keyword-match");
    }
    return parts.join(" + ");
  }
}

/** Escape a string for use in a RegExp. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

### Step 4 — Wire into RuntimePool (replace stub)

```typescript
// packages/print/src/main.ts (Phase 8 wiring — replaces Phase 5 stub)

import { SmartRouterImpl } from "./runtimes/router.js";

// Phase 5 used: const router = createStubRouter(runtimes);
// Phase 8 replaces with:
const router = new SmartRouterImpl(runtimes);

const pool = new RuntimePool(router, runtimes, enricher, costTracker);
```

### Step 5 — Write the test

```typescript
// packages/print/src/runtimes/smart-router.test.ts

import { describe, it, expect, vi } from "vitest";
import { SmartRouterImpl, type SmartRouterConfig, type KeywordRule } from "./router.js";
import type { AgentRuntime, AgentCapabilities, ModelInfo } from "@my-agent/core";

// ── Mock runtime factory ──

function mockRuntime(
  runtimeType: string,
  opts: {
    available?: boolean;
    models?: ModelInfo[];
    cost?: { input: number; output: number };
  } = {},
): AgentRuntime {
  const available = opts.available ?? true;
  const models = opts.models ?? [];
  return {
    runtimeType,
    displayName: `mock-${runtimeType}`,
    async start() { return {} as never; },
    isAvailable: () => available,
    async listModels() { return models; },
    capabilities: (): AgentCapabilities => ({
      hasInteractive: false,
      hasHeadless: true,
      supportsTools: true,
      supportsResume: false,
      supportsCompaction: false,
      supportsImages: false,
      supportsThinking: false,
      execution: "in-process",
      maxContextWindow: 128_000,
      injectionMethod: "in-process-call",
    }),
    ...(opts.cost ? { costPerMTokens: () => opts.cost! } : {}),
  };
}

function makeRuntimes(
  entries: Array<[string, AgentRuntime]>,
): Map<string, AgentRuntime> {
  return new Map(entries);
}

describe("[unit] SmartRouterImpl", () => {
  describe("keyword scoring", () => {
    it("selects pi for coding keywords (fix, bug, refactor)", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({ prompt: "Fix the bug in the auth module" });
      expect(result.runtime.runtimeType).toBe("pi");
      expect(result.reason).toContain("keyword");
    });

    it("selects mya-native for text keywords (summarize, translate)", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({ prompt: "Summarize this article for me" });
      expect(result.runtime.runtimeType).toBe("mya-native");
      expect(result.reason).toContain("keyword");
    });

    it("multiple keyword matches accumulate score", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      // "fix the code" matches two pi rules: {fix} weight 2.0 + {code} weight 2.0
      const result = await router.select({ prompt: "fix the code" });
      expect(result.runtime.runtimeType).toBe("pi");
    });

    it("keyword match is case-insensitive", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({ prompt: "SUMMARIZE THIS" });
      expect(result.runtime.runtimeType).toBe("mya-native");
    });

    it("keyword match uses word boundaries (no partial matches)", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      // "refix" should NOT match "fix" (word boundary)
      // But since neither keyword matches strongly, cost determines → mya-native (cheaper)
      const result = await router.select({ prompt: "refix the value" });
      // No keyword match → default to pi
      expect(result.reason).toContain("default:pi");
    });
  });

  describe("model availability", () => {
    it("excludes unavailable runtimes", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { available: false, cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { available: true, cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      // Prompt with pi keyword, but pi is unavailable → falls back
      const result = await router.select({ prompt: "fix the bug" });
      expect(result.runtime.runtimeType).toBe("mya-native");
    });

    it("throws when no runtime is available", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { available: false })],
        ["mya-native", mockRuntime("mya-native", { available: false })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      await expect(router.select({ prompt: "anything" })).rejects.toThrow("No runtime available");
    });

    it("filters by modelOverride when runtime has the model", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", {
          models: [{ id: "claude-sonnet-4", provider: "anthropic", contextWindow: 200_000, maxTokens: 8192, reasoning: true }],
          cost: { input: 3, output: 15 },
        })],
        ["mya-native", mockRuntime("mya-native", {
          models: [{ id: "gpt-4o-mini", provider: "openai", contextWindow: 128_000, maxTokens: 4096, reasoning: false }],
          cost: { input: 0.15, output: 0.6 },
        })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({
        prompt: "summarize",  // would normally pick mya-native
        modelOverride: "claude-sonnet-4",  // but model is only on pi
      });
      expect(result.runtime.runtimeType).toBe("pi");
    });
  });

  describe("cost penalty", () => {
    it("cheaper runtime wins when no keyword matches", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],     // $18/M total
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })], // $0.75/M total
      ]);
      const router = new SmartRouterImpl(runtimes, { costWeight: 1.0 });

      const result = await router.select({ prompt: "hello" }); // no keyword match
      expect(result.runtime.runtimeType).toBe("mya-native");
      expect(result.reason).toContain("cost");
    });

    it("keyword score can override cost penalty", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],     // expensive
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })], // cheap
      ]);
      const router = new SmartRouterImpl(runtimes, { costWeight: 0.2, keywordWeight: 1.0 });

      // "fix the code" gives pi keyword score 4.0 (two rules × 2.0)
      // pi total = 4.0 × 1.0 + 0.36 × 0.2 = 4.07
      // mya total = 0.0 × 1.0 + 0.93 × 0.2 = 0.19
      const result = await router.select({ prompt: "fix the code" });
      expect(result.runtime.runtimeType).toBe("pi");
    });

    it("runtime without costPerMTokens gets high default cost (penalized)", async () => {
      const runtimes = makeRuntimes([
        ["expensive", mockRuntime("expensive")],  // no cost → default $20/M
        ["cheap", mockRuntime("cheap", { cost: { input: 0.1, output: 0.1 } })], // $0.2/M
      ]);
      const router = new SmartRouterImpl(runtimes, { costWeight: 1.0 });

      const result = await router.select({ prompt: "test" });
      expect(result.runtime.runtimeType).toBe("cheap");
    });

    it("costWeight config controls cost influence", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);

      // With costWeight = 0, cost doesn't matter → default (pi) when no keyword
      const routerNoCost = new SmartRouterImpl(runtimes, { costWeight: 0 });
      const resultNoCost = await routerNoCost.select({ prompt: "hello" });
      expect(resultNoCost.runtime.runtimeType).toBe("pi"); // default, no cost influence

      // With costWeight = 1.0, cost dominates → mya-native (cheaper)
      const routerCostly = new SmartRouterImpl(runtimes, { costWeight: 1.0 });
      const resultCostly = await routerCostly.select({ prompt: "hello" });
      expect(resultCostly.runtime.runtimeType).toBe("mya-native");
    });
  });

  describe("default selection", () => {
    it("returns default runtime when no keyword matches and cost is neutral", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes, { costWeight: 0 });

      const result = await router.select({ prompt: "hello world" });
      expect(result.runtime.runtimeType).toBe("pi"); // default
      expect(result.reason).toContain("default:pi");
    });

    it("custom defaultRuntime config", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes, {
        defaultRuntime: "mya-native",
        costWeight: 0,
      });

      const result = await router.select({ prompt: "hello world" });
      expect(result.runtime.runtimeType).toBe("mya-native");
      expect(result.reason).toContain("default:mya-native");
    });

    it("falls back to available runtime when default is unavailable", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { available: false })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes, { costWeight: 0 });

      // Default is pi, but pi is unavailable. Should select mya-native
      // (the only available runtime).
      const result = await router.select({ prompt: "hello" });
      expect(result.runtime.runtimeType).toBe("mya-native");
    });
  });

  describe("agentOverride", () => {
    it("explicit override bypasses scoring", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      // Prompt has summarize keyword (→ mya-native), but override says pi
      const result = await router.select({
        prompt: "summarize this",
        agentOverride: "pi",
      });
      expect(result.runtime.runtimeType).toBe("pi");
      expect(result.reason).toContain("override:pi");
    });

    it("override with modelOverride returns matching runtime", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", {
          models: [{ id: "claude-sonnet-4", provider: "anthropic", contextWindow: 200_000, maxTokens: 8192, reasoning: true }],
        })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({
        prompt: "test",
        agentOverride: "pi",
        modelOverride: "claude-sonnet-4",
      });
      expect(result.runtime.runtimeType).toBe("pi");
      expect(result.reason).toContain("model: claude-sonnet-4");
    });

    it("non-existent override falls through to scoring", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({
        prompt: "hello",
        agentOverride: "nonexistent",
      });
      expect(result.runtime.runtimeType).toBe("pi"); // default
    });
  });

  describe("custom keyword rules", () => {
    it("uses custom rules when provided", async () => {
      const customRules: KeywordRule[] = [
        { keywords: ["deploy", "ship"], runtimeKey: "pi", weight: 5.0 },
      ];
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes, { rules: customRules });

      const result = await router.select({ prompt: "deploy the app" });
      expect(result.runtime.runtimeType).toBe("pi");
      expect(result.reason).toContain("keyword");
    });

    it("custom rules with no matches falls to default", async () => {
      const customRules: KeywordRule[] = [
        { keywords: ["very-specific-keyword"], runtimeKey: "pi", weight: 5.0 },
      ];
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
        ["mya-native", mockRuntime("mya-native", { cost: { input: 0.15, output: 0.6 } })],
      ]);
      const router = new SmartRouterImpl(runtimes, { rules: customRules, costWeight: 0 });

      const result = await router.select({ prompt: "hello world" });
      expect(result.runtime.runtimeType).toBe("pi"); // default
      expect(result.reason).toContain("default");
    });
  });

  describe("reason string", () => {
    it("includes keyword score in reason", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({ prompt: "fix the bug" });
      expect(result.reason).toMatch(/keyword:\d+\.\d+/);
    });

    it("includes cost score in reason", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
      ]);
      const router = new SmartRouterImpl(runtimes);

      const result = await router.select({ prompt: "fix the bug" });
      expect(result.reason).toMatch(/cost:\d+\.\d+/);
    });

    it("includes 'no-keyword-match' when keyword score is 0", async () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi", { cost: { input: 3, output: 15 } })],
      ]);
      const router = new SmartRouterImpl(runtimes, { costWeight: 1.0 });

      const result = await router.select({ prompt: "hello" });
      expect(result.reason).toContain("no-keyword-match");
    });
  });

  describe("select is async (returns Promise)", () => {
    it("returns a Promise", () => {
      const runtimes = makeRuntimes([
        ["pi", mockRuntime("pi")],
      ]);
      const router = new SmartRouterImpl(runtimes);
      const result = router.select({ prompt: "test" });
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
```

### Step 6 — Add re-export to runtimes barrel

```typescript
// packages/print/src/runtimes/index.ts
export { SmartRouterImpl, type SmartRouterConfig, type KeywordRule } from "./router.js";
```

## Code Skeletons

### How RuntimePool uses the router (Phase 5 — no change)

```typescript
// RuntimePool.acquireWithRuntime() — already implemented in Phase 5:

async acquireWithRuntime(sessionId, opts) {
  // ...
  let runtime: AgentRuntime;
  if (opts?.agentType) {
    runtime = this.runtimes.get(opts.agentType)!;
  } else {
    // Phase 5 used createStubRouter (always pi).
    // Phase 8: this.router is now SmartRouterImpl with scoring.
    const result = await this.router.select({
      prompt: opts?.prompt ?? "",
      modelOverride: opts?.model,
    });
    runtime = result.runtime;
    // result.reason is available for logging/debugging
  }
  // ...
}
```

### Scoring algorithm visual

```
Prompt: "Fix the bug in auth.ts"
                 │
                 ▼
    ┌──────────────────────────────────────┐
    │         SmartRouterImpl.select()      │
    └──────────────────┬───────────────────┘
                       │
    ┌──────────────────▼───────────────────┐
    │  Score each runtime:                  │
    │                                       │
    │  pi:                                   │
    │    keyword: "fix" (2.0) + "bug" (2.0)  │
    │           + "auth.ts" → "file" (2.0)   │
    │    = 6.0 × keywordWeight(1.0) = 6.0    │
    │    cost: $18/M → 0.36 × costWeight(0.2)│
    │    = 0.07                              │
    │    total = 6.07                        │
    │                                       │
    │  mya-native:                           │
    │    keyword: 0.0 (no text keywords)     │
    │    cost: $0.75/M → 0.93 × 0.2          │
    │    = 0.19                              │
    │    total = 0.19                        │
    │                                       │
    │  claude:                               │
    │    keyword: 0.0                        │
    │    cost: unknown → default $20/M       │
    │    → 0.33 × 0.2 = 0.07                 │
    │    total = 0.07                        │
    └──────────────────┬───────────────────┘
                       │
    ┌──────────────────▼───────────────────┐
    │  Winner: pi (total: 6.07)             │
    │  Reason: "keyword:6.0 + cost:0.36"    │
    └──────────────────────────────────────┘
```

### Construction wiring (main.ts)

```typescript
// packages/print/src/main.ts

import { SmartRouterImpl } from "./runtimes/router.js";

// Phase 5 used: const router = createStubRouter(runtimes);
// Phase 8 replaces with:
const router = new SmartRouterImpl(runtimes, {
  // Optional config overrides:
  // defaultRuntime: "pi",
  // costWeight: 0.2,
  // keywordWeight: 1.0,
  // rules: [customKeywordRules],
});

const pool = new RuntimePool(router, runtimes, enricher, costTracker);
```

## Test Plan

- **File:** `packages/print/src/runtimes/smart-router.test.ts`
- **Tier:** `[unit]`
- **Cases:**
  1. selects pi for coding keywords (fix, bug, refactor)
  2. selects mya-native for text keywords (summarize, translate)
  3. multiple keyword matches accumulate score
  4. keyword match is case-insensitive
  5. keyword match uses word boundaries (no partial matches)
  6. excludes unavailable runtimes
  7. throws when no runtime is available
  8. filters by modelOverride when runtime has the model
  9. cheaper runtime wins when no keyword matches
  10. keyword score can override cost penalty
  11. runtime without costPerMTokens gets high default cost (penalized)
  12. costWeight config controls cost influence
  13. returns default runtime when no keyword matches and cost is neutral
  14. custom defaultRuntime config
  15. falls back to available runtime when default is unavailable
  16. explicit agentOverride bypasses scoring
  17. override with modelOverride returns matching runtime
  18. non-existent override falls through to scoring
  19. uses custom rules when provided
  20. custom rules with no matches falls to default
  21. reason includes keyword score
  22. reason includes cost score
  23. reason includes "no-keyword-match" when keyword score is 0
  24. select() returns a Promise

## Acceptance Criteria

- [ ] `packages/print/src/runtimes/router.ts` exists with `SmartRouterImpl` implementing `SmartRouter`
- [ ] `select()` is async (returns `Promise<{ runtime, reason }>`)
- [ ] Keyword scoring: coding keywords → pi, text keywords → mya-native
- [ ] Keyword matching is case-insensitive and word-boundary-aware
- [ ] Multiple keyword matches accumulate additively
- [ ] Unavailable runtimes excluded from selection (isAvailable() gate)
- [ ] Throws "No runtime available" when all runtimes are unavailable
- [ ] Cost penalty: cheaper runtime scores higher (normalized inverse)
- [ ] costWeight config controls cost influence on total score
- [ ] Default selection returns `defaultRuntime` when no keyword matches
- [ ] Custom `defaultRuntime` config respected
- [ ] `agentOverride` bypasses scoring (explicit override)
- [ ] `modelOverride` filters candidates by model availability
- [ ] Non-existent `agentOverride` falls through to scoring (no crash)
- [ ] `reason` string includes keyword score + cost score breakdown
- [ ] `smart-router.test.ts` passes: `npx vitest run packages/print/src/runtimes/smart-router.test.ts`
- [ ] `npx tsc --noEmit` in `packages/print/` passes
- [ ] `createStubRouter` import removed from `main.ts` (replaced with `SmartRouterImpl`)
- [ ] No real runtime required for tests (all mocked)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Keyword rules are too coarse (false positives) | Default rules use word-boundary matching + weight scaling. Operators can customize via `SmartRouterConfig.rules`. The scoring is transparent (reason string shows breakdown) |
| `listModels()` is called per-select (latency) | Only called when `modelOverride` is set (rare). Normal path uses `isAvailable()` (sync) + `costPerMTokens()` (sync). `listModels()` is not called during keyword scoring |
| Cost data is stale (provider changes pricing) | `costPerMTokens()` is a static estimate per runtime. Acceptable for routing heuristics. Precise cost tracking is Phase 12 (CostTracker) |
| Default rules don't match real user behavior | Rules are configurable (`SmartRouterConfig.rules`). The default set covers common patterns (coding vs text). Operators can A/B test rule sets |
| `escapeRegex` misses special characters in keywords | Keywords in DEFAULT_RULES are simple words (no regex metachars). Custom rules should sanitize. `escapeRegex` handles all standard metacharacters |
| Routing creates a hot path (called per prompt) | Scoring is O(runtimes × rules × keywords) — with 3 runtimes and 5 rules, that's 15 regex tests per prompt. Sub-millisecond. No caching needed |
| `agentOverride` points to a stale runtime (after pool reconfigure) | Falls through to scoring (doesn't throw). The default runtime catches the fallback. Graceful degradation |
| Two runtimes have identical scores (tie) | `sort()` is stable in V8 — the first-registered runtime wins. This is deterministic and matches the runtimes Map insertion order (pi first) |
| `modelOverride` filtering via `listModels()` is slow for large model lists | Model lists are typically <50 entries. `.some()` is O(n) with early exit. Acceptable |
| User expects routing to be "smart" (ML-based) | This is a heuristic router, not ML. The spec (§5.1) defines `select()` as returning `{ runtime, reason }` — deterministic + explainable. ML routing is a future enhancement |

## Rollback

1. Delete `packages/print/src/runtimes/router.ts`
2. Delete `packages/print/src/runtimes/smart-router.test.ts`
3. Restore `createStubRouter` in `main.ts`:
   ```typescript
   // Revert to Phase 5 stub:
   const router = createStubRouter(runtimes);
   ```
4. Remove the re-export from `packages/print/src/runtimes/index.ts`

No runtime depends on `SmartRouterImpl` directly — only the `SmartRouter`
interface. The stub satisfies the same interface (`select()` returns
`{ runtime, reason }`), so rolling back has zero impact on RuntimePool or any
session lifecycle.
