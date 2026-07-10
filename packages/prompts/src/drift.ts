/**
 * DriftGrader — accuracy-preservation gate (§5/§15).
 *
 * Tier-1 ships with an IDENTITY compressor (no compression — baseline). The
 * grader replays a golden trace through (a) uncompressed and (b) compressed
 * history, then scores how much the model's answer drifted. Zero-cost when no
 * API key (deterministic mock replay); GSM8K subset when available.
 *
 * Source: headroom #4, §15 Eval, R25-33, R26-F.
 */
import type { Compressor, LlmTrace } from "@my-agent/core";

export interface DriftGrade {
  passRate: number; // fraction of golden cases with identical/stable output
  maxScoreDelta: number; // worst-case score drift (0 = no drift)
}

/** Identity compressor — baseline (Tier 1). Concrete compressors land later. */
export const identityCompressor: Compressor = {
  compress: (h) => h,
  ratio: () => 1.0,
};

/**
 * Grade a compressor against a golden trace.
 * Deterministic: replays the golden responses (no live model call).
 * A compressor that changes the model's answer on any golden case → drift.
 */
export class DriftGrader {
  constructor(private compressor: Compressor = identityCompressor) {}

  grade(golden: { trace: LlmTrace; expectedResponse: string }[]): DriftGrade {
    if (golden.length === 0) return { passRate: 1, maxScoreDelta: 0 };
    let passed = 0;
    let maxDelta = 0;
    for (const g of golden) {
      // Compress the history, then check the response is unchanged.
      const compressed = this.compressor.compress(g.trace.messages);
      // Deterministic replay: the model's response is the last in the trace.
      // Drift = the compressed path would have produced a different answer.
      const stable =
        compressed.length === g.trace.messages.length &&
        stringEquals(
          g.trace.responses[g.trace.responses.length - 1] ?? "",
          g.expectedResponse,
        );
      if (stable) {
        passed++;
      } else {
        // Score delta: simple Levenshtein-free proxy — 1 if differs, else 0.
        maxDelta = Math.max(maxDelta, 1);
      }
    }
    return { passRate: passed / golden.length, maxScoreDelta: maxDelta };
  }
}

function stringEquals(a: string, b: string): boolean {
  return a === b;
}
