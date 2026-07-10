/**
 * Parity harness (§15) — runs golden scenarios through the system + grades drift.
 *
 * Two tiers of scenario:
 *   - MOCK (no network): replay a canned StreamEvent[] trace through MockProvider,
 *     verify deterministic replay + that compression doesn't drift the answer.
 *   - LIVE (needs API key): run a real prompt through a provider, check the
 *     answer against expected behavior steps.
 *
 * The harness is the substrate for the §5 accuracy-preservation gate: a
 * compressor that drifts any golden scenario is refused.
 *
 * Source: §15 Eval & Quality Gates, claw-code #16, headroom #4, R25-33, R26-F.
 */
import type { Compressor, LlmTrace } from "@my-agent/core";
import { DriftGrader, type DriftGrade } from "@my-agent/prompts";

/** A single eval scenario. */
export interface ParityScenario {
  id: string;
  tier: "mock" | "live";
  description: string;
  /** The golden trace (messages + the expected model responses). */
  trace: LlmTrace;
  /** The response the model SHOULD produce (drift baseline). */
  expectedResponse: string;
  /** Optional behavior steps to assert (tool calls / state transitions). */
  expectSteps?: { kind: "tool_call" | "state"; expect: unknown }[];
}

/** Result of running one scenario. */
export interface ScenarioResult {
  id: string;
  passed: boolean;
  drift: DriftGrade;
  reason?: string;
}

/**
 * ParityHarness — grade a set of scenarios against a compressor.
 * MOCK scenarios run zero-cost (deterministic replay); the drift grader checks
 * the compressor doesn't change the answer.
 */
export class ParityHarness {
  private scenarios: ParityScenario[] = [];

  add(s: ParityScenario): void {
    this.scenarios.push(s);
  }

  /** Grade a compressor against all MOCK scenarios (deterministic, no network). */
  async grade(compressor: Compressor = { compress: (h) => h, ratio: () => 1 }): Promise<ScenarioResult[]> {
    const grader = new DriftGrader(compressor);
    const results: ScenarioResult[] = [];
    for (const s of this.scenarios) {
      if (s.tier === "live") continue; // live scenarios need a real provider run (separate path)
      const drift = grader.grade([{ trace: s.trace, expectedResponse: s.expectedResponse }]);
      const passed = drift.passRate === 1 && drift.maxScoreDelta === 0;
      results.push({
        id: s.id,
        passed,
        drift,
        reason: passed ? undefined : `drift: passRate=${drift.passRate.toFixed(2)} maxDelta=${drift.maxScoreDelta}`,
      });
    }
    return results;
  }

  /** Summary: overall pass + which scenarios drifted. */
  summarize(results: ScenarioResult[]): { passed: number; failed: number; drifters: string[] } {
    let passed = 0;
    const drifters: string[] = [];
    for (const r of results) {
      if (r.passed) passed++;
      else drifters.push(r.id);
    }
    return { passed, failed: results.length - passed, drifters };
  }
}

/** A built-in mock scenario: identical passthrough (no drift expected). */
export const identicalPassthrough: ParityScenario = {
  id: "01-identical-passthrough",
  tier: "mock",
  description: "identity compressor must not drift a single-fact answer",
  trace: { messages: [{ role: "user", content: "What is 2+2?" }], responses: ["4"] },
  expectedResponse: "4",
};

/** A built-in mock scenario: key fact preserved under compression. */
export const keyFactPreserved: ParityScenario = {
  id: "02-key-fact-preserved",
  tier: "mock",
  description: "compression must preserve the key fact in the answer",
  trace: {
    messages: [
      { role: "user", content: "Remember the project deadline is July 31." },
      { role: "assistant", content: "Noted: deadline July 31." },
    ],
    responses: ["The deadline is July 31."],
  },
  expectedResponse: "The deadline is July 31.",
};

/** Convenience: a harness pre-loaded with the built-in mock scenarios. */
export function defaultHarness(): ParityHarness {
  const h = new ParityHarness();
  h.add(identicalPassthrough);
  h.add(keyFactPreserved);
  return h;
}
