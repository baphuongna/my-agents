/**
 * Integration + credentialed eval tiers (§15) — extends the unit-tier
 * ParityHarness with two higher-level tiers + a golden-fixture freshness gate.
 *
 * - IntegrationTier: drives multi-turn conversations through MockProvider (no
 *   network) and asserts tool-call sequences + the final answer. Zero-cost,
 *   deterministic.
 * - CredentialedTier: runs a real ProviderProfile (OpenAI/Anthropic/…). Gated
 *   by MYA_CREDENTIALED=1 — opt-in only (makes live API calls).
 * - warnFixtureFreshness: warns when a recorded golden fixture is older than
 *   FRESHNESS_WARN_DAYS (30).
 *
 * These tiers extend (do not replace or alter) the existing unit-tier harness.
 *
 * Source: §15 Eval & Quality Gates, task 01_01-agent.
 */
import { MockProvider } from "@my-agent/ai";
import type { MockTrace } from "@my-agent/ai";
import type {
  History,
  OpenAITool,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";
import { checkGoldenAge } from "./egress.js";

const EMPTY_PROMPT: SystemPrompt = { stable: "", context: "", volatile: "" };

/** Minimal in-memory History. MockProvider ignores the body, but the type
 *  requires the methods — this stub satisfies it without touching the network. */
function emptyHistory(): History {
  const entries: unknown[] = [];
  return {
    append: (e: unknown) => {
      entries.push(e);
    },
    entries: () => entries,
  };
}

/** Collect tool-call names / final text from a stream event. */
function collectEvent(
  e: StreamEvent,
  toolCalls: string[],
  onText: (t: string) => void,
): void {
  if (e.kind === "tool_calls") {
    for (const c of e.calls) toolCalls.push(c.name);
  } else if (e.kind === "text") {
    onText(e.text);
  }
}

// ─── Integration tier (local mock services, no network) ────────────────────

/** A conversation turn: the mock trace this turn replays + optional tools. */
export interface IntegrationTurn {
  trace: MockTrace;
  tools?: OpenAITool[];
}

/** A multi-turn integration scenario (no network — MockProvider replay). */
export interface IntegrationScenario {
  id: string;
  description: string;
  /** One entry per provider.stream() call (multi-turn). */
  turns: IntegrationTurn[];
  /** Tool-call names that MUST appear across the conversation (asserted). */
  expectToolCalls?: string[];
  /** Final assistant text the last turn must emit. */
  expectedResponse: string;
  /** When the golden fixture was recorded (freshness gate). ms epoch. */
  recordedAt?: number;
}

export interface IntegrationResult {
  id: string;
  passed: boolean;
  toolCalls: string[];
  finalText: string;
  reason?: string;
}

/**
 * IntegrationTier — drives multi-turn conversations through MockProvider.
 * No network: every turn replays a canned StreamEvent[] trace. Asserts the
 * expected tool calls fire and the final answer matches.
 */
export class IntegrationTier {
  private scenarios: IntegrationScenario[] = [];

  add(s: IntegrationScenario): void {
    this.scenarios.push(s);
  }

  /** Run a single scenario. */
  async run(s: IntegrationScenario): Promise<IntegrationResult> {
    const observed: string[] = [];
    let finalText = "";
    for (const turn of s.turns) {
      const provider = new MockProvider(turn.trace);
      const { events } = await provider.stream(EMPTY_PROMPT, emptyHistory(), {
        tools: turn.tools,
      });
      for (const e of events) collectEvent(e, observed, (t) => (finalText = t));
    }
    const missingTools = (s.expectToolCalls ?? []).filter(
      (n) => !observed.includes(n),
    );
    const responseOk = finalText === s.expectedResponse;
    const passed = missingTools.length === 0 && responseOk;
    const reasons: string[] = [];
    if (missingTools.length > 0)
      reasons.push(`missing tool calls: ${missingTools.join(", ")}`);
    if (!responseOk) reasons.push(`response mismatch (got "${finalText}")`);
    return {
      id: s.id,
      passed,
      toolCalls: observed,
      finalText,
      reason: passed ? undefined : reasons.join("; "),
    };
  }

  /** Run all added scenarios. */
  async runAll(): Promise<IntegrationResult[]> {
    const out: IntegrationResult[] = [];
    for (const s of this.scenarios) out.push(await this.run(s));
    return out;
  }
}

/** Built-in integration scenario: two-turn tool-call conversation (no network). */
export const toolCallConversation: IntegrationScenario = {
  id: "int-01-tool-call-conversation",
  description: "two-turn conversation: model calls get_weather, then answers",
  turns: [
    {
      // Turn 1: model emits a tool call.
      trace: {
        id: "mock-turn-1",
        model: "mock-1",
        events: [
          {
            kind: "tool_calls",
            calls: [{ id: "call_1", name: "get_weather", args: { city: "Paris" } }],
          },
          { kind: "done", usage: { input: 5, output: 1 }, finish: "tool" },
        ],
      },
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
    },
    {
      // Turn 2: tool result injected, model answers with text.
      trace: {
        id: "mock-turn-2",
        model: "mock-1",
        events: [
          { kind: "text", text: "The weather in Paris is sunny." },
          { kind: "done", usage: { input: 8, output: 3 }, finish: "stop" },
        ],
      },
    },
  ],
  expectToolCalls: ["get_weather"],
  expectedResponse: "The weather in Paris is sunny.",
};

// ─── Credentialed tier (real provider, opt-in) ─────────────────────────────

/** A credentialed scenario: a real prompt driven through a live provider. */
export interface CredentialedScenario {
  id: string;
  description: string;
  /** Seed conversation (role-tagged). */
  turns: { role: "user" | "assistant" | "tool"; content: string }[];
  tools?: OpenAITool[];
  /** The streamed final text must contain this substring. */
  expectedResponse: string;
  recordedAt?: number;
}

export interface CredentialedResult {
  id: string;
  passed: boolean;
  finalText: string;
  toolCalls: string[];
  reason?: string;
}

/**
 * CredentialedTier — runs scenarios against a REAL provider
 * (OpenAI/Anthropic/OpenRouter/local llama.cpp/…). Gated by MYA_CREDENTIALED=1:
 * throws unless explicitly opted in. Makes real network calls — lift the
 * egress guard (restoreEgress) before use.
 */
export class CredentialedTier {
  constructor(private provider: ProviderProfile) {}

  /** True only when MYA_CREDENTIALED=1. */
  static get enabled(): boolean {
    return process.env["MYA_CREDENTIALED"] === "1";
  }

  /** Assert the gate is open (throws otherwise). */
  private ensureEnabled(): void {
    if (!CredentialedTier.enabled) {
      throw new Error(
        "credentialed tier requires MYA_CREDENTIALED=1 (makes real API calls)",
      );
    }
  }

  /** Run a single scenario through the real provider. */
  async run(s: CredentialedScenario): Promise<CredentialedResult> {
    this.ensureEnabled();
    const observed: string[] = [];
    let finalText = "";
    const { events } = await this.provider.stream(
      EMPTY_PROMPT,
      credentialedHistory(s.turns),
      { tools: s.tools },
    );
    for (const e of events) collectEvent(e, observed, (t) => (finalText = t));
    const passed = finalText.includes(s.expectedResponse);
    return {
      id: s.id,
      passed,
      finalText,
      toolCalls: observed,
      reason: passed
        ? undefined
        : `response did not contain "${s.expectedResponse}" (got "${finalText}")`,
    };
  }

  /** Run multiple scenarios. */
  async runAll(scenarios: CredentialedScenario[]): Promise<CredentialedResult[]> {
    this.ensureEnabled();
    const out: CredentialedResult[] = [];
    for (const s of scenarios) out.push(await this.run(s));
    return out;
  }
}

/** History seeded with the scenario's conversation turns. */
function credentialedHistory(
  turns: { role: string; content: string }[],
): History {
  const entries: unknown[] = turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));
  return {
    append: (e: unknown) => {
      entries.push(e);
    },
    entries: () => entries,
  };
}

// ─── Golden fixture freshness gate (30-day warn) ───────────────────────────

/** Warn threshold: fixtures older than this (days) trigger a freshness warning. */
export const FRESHNESS_WARN_DAYS = 30;

export interface FreshnessWarning {
  id: string;
  ageDays: number;
  message: string;
}

/**
 * Freshness gate: warn when a golden fixture is older than `maxAgeDays`
 * (default FRESHNESS_WARN_DAYS = 30). Returns one warning per stale fixture
 * (empty array when all fresh / age unknown). This is a WARN — never a hard
 * failure (best-effort, consistent with checkGoldenAge).
 */
export function warnFixtureFreshness(
  fixtures: { id: string; recordedAt?: number }[],
  now: number,
  maxAgeDays = FRESHNESS_WARN_DAYS,
): FreshnessWarning[] {
  const warnings: FreshnessWarning[] = [];
  for (const f of fixtures) {
    const { stale, ageDays } = checkGoldenAge(f.recordedAt, now, maxAgeDays);
    if (stale && ageDays !== null) {
      warnings.push({
        id: f.id,
        ageDays,
        message: `golden fixture "${f.id}" is ${ageDays} days old (>${maxAgeDays}) — model may have drifted; consider re-recording`,
      });
    }
  }
  return warnings;
}
