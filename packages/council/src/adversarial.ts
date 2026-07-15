/**
 * Adversarial review (§6 cross-check pattern, ported from pi-dynamic-workflows).
 *
 * Each finding is judged independently by N reviewers who are told to REFUTE
 * it (default real=false when uncertain). A finding survives only when the
 * share of reviewers calling it "real" meets the threshold.
 *
 * 3 phases: Investigate (already done — findings provided as input) →
 * Refute (N reviewers vote {real, reason}) → Filter by threshold.
 *
 * Reviewers are separate ProviderProfile calls fanned out in parallel
 * (mirrors CouncilProvider's fan-out + HindsightReviewer's JSON-scanning
 * approach).
 */
import type { History, ProviderProfile, SystemPrompt, StreamEvent } from "@my-agent/core";

export interface AdversarialReviewConfig {
  /** Number of independent reviewers per finding. Default: 2. */
  reviewerCount?: number;
  /** Minimum agreement fraction (0–1) for a finding to survive. Default: 0.5. */
  threshold?: number;
  /** Provider profiles to cycle through for reviewer calls. */
  providers: ProviderProfile[];
}

/** Per-finding tally returned in the result's `votes` array. */
export interface FindingVote {
  finding: string;
  realCount: number;
  total: number;
}

/** Result of an adversarial review pass. */
export interface AdversarialReviewResult {
  /** Findings that survived the threshold. */
  real: string[];
  /** Findings refuted (below threshold). */
  refuted: string[];
  /** Per-finding vote tallies. */
  votes: FindingVote[];
}

/** A single reviewer's parsed verdict. */
interface ReviewerVerdict {
  real: boolean;
  reason: string;
}

const DEFAULT_REVIEWER_COUNT = 2;
const DEFAULT_THRESHOLD = 0.5;
const REVIEWER_TIMEOUT_MS = 30_000;

/**
 * Run an adversarial review over a set of findings.
 *
 * For each finding, `reviewerCount` reviewers (cycled across `providers`)
 * independently vote {real, reason}. A finding survives iff the fraction of
 * "real" votes ≥ threshold. Unparseable reviewer output defaults to
 * real=false (matching the skeptical default).
 */
export async function adversarialReview(
  findings: string[],
  options: AdversarialReviewConfig,
): Promise<AdversarialReviewResult> {
  const reviewerCount = options.reviewerCount ?? DEFAULT_REVIEWER_COUNT;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const providers = options.providers;

  if (providers.length === 0) {
    throw new Error("adversarialReview requires ≥1 provider");
  }

  const emptyHistory: History = { append() {}, entries: () => [] };

  // Phase: Refute — fan out all findings × reviewers in parallel.
  const votes: FindingVote[] = await Promise.all(
    findings.map(async (finding) => {
      const verdicts = await Promise.all(
        Array.from({ length: reviewerCount }, (_, r) => {
          const provider = providers[r % providers.length]!;
          return runReviewer(provider, finding, emptyHistory);
        }),
      );
      const realCount = verdicts.filter((v) => v.real).length;
      return { finding, realCount, total: verdicts.length };
    }),
  );

  // Phase: Filter — partition by threshold.
  const real: string[] = [];
  const refuted: string[] = [];
  for (const v of votes) {
    const ratio = v.total > 0 ? v.realCount / v.total : 0;
    if (ratio >= threshold) {
      real.push(v.finding);
    } else {
      refuted.push(v.finding);
    }
  }

  return { real, refuted, votes };
}

/**
 * Dispatch one reviewer call to a provider and parse its {real, reason} verdict.
 * On timeout, parse failure, or thrown error, defaults to {real: false}.
 */
async function runReviewer(
  provider: ProviderProfile,
  finding: string,
  history: History,
): Promise<ReviewerVerdict> {
  const prompt: SystemPrompt = {
    stable: [
      "You are a skeptical reviewer. Try to REFUTE the finding below.",
      'Default to real=false when uncertain. Emit a JSON object: {"real": true|false, "reason": "..."}.',
      "Only emit the JSON object — no prose.",
    ].join(" "),
    context: `FINDING: ${finding}`,
    volatile: "Evaluate whether this finding is real/accurate.",
  };

  try {
    const result = await Promise.race([
      provider.stream(prompt, history),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("adversarial reviewer timed out")), REVIEWER_TIMEOUT_MS),
      ),
    ]);
    const text = extractText(result.events);
    const parsed = tryParseVerdict(text);
    return parsed ?? { real: false, reason: "unparseable reviewer output" };
  } catch {
    return { real: false, reason: "reviewer call failed" };
  }
}

/** Extract concatenated text from a stream's events. */
function extractText(events: StreamEvent[]): string {
  return events
    .filter((e) => e.kind === "text")
    .map((e) => (e.kind === "text" ? e.text : ""))
    .join("");
}

/**
 * Scan text for the first balanced JSON object and extract {real, reason}.
 * Uses brace-depth + string-state tracking (mirrors hindsight.ts:tryParseHindsight)
 * so embedded `}` inside string values does not break scanning.
 */
function tryParseVerdict(text: string): ReviewerVerdict | null {
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j]!;
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) return null;
    const candidate = text.slice(i, end + 1);
    try {
      const obj = JSON.parse(candidate) as { real?: boolean; reason?: string };
      return {
        real: obj.real === true,
        reason: typeof obj.reason === "string" ? obj.reason : "",
      };
    } catch {
      i = end + 1;
    }
  }
  return null;
}
