/**
 * Hindsight / advisor lane (§10, oh-my-pi).
 *
 * A "hindsight" model reviews a (question, answer) pair AFTER it's produced
 * and emits a critique (issues + suggested improvements). Used to:
 *  - review a council's aggregated answer before showing to the user
 *  - review the main turn's answer as an optional second-model check
 *  - power an automated advisor lane (oh-my-pi §10)
 *
 * The critic is a separate AuxiliaryProvider (invariant #8: separate alloc;
 * never touches the main prompt cache).
 *
 * Source: §10 advisor/hindsight model lane, oh-my-pi advisor.
 */
import type { ComponentHealth, History, ProviderProfile, SystemPrompt, TokenUsage } from "@my-agent/core";

export interface HindsightIssue {
  severity: "info" | "warn" | "error";
  message: string;
}

export interface HindsightResult {
  issues: HindsightIssue[];
  summary: string;
  approved: boolean;
  usage: TokenUsage;
}

/** Build the hindsight prompt for a (question, answer) pair. */
function buildHindsightPrompt(question: string, answer: string): SystemPrompt {
  return {
    stable: [
      "You are a hindsight reviewer. Given a question and an answer, identify concrete",
      "issues (correctness, completeness, safety, clarity) and emit a JSON object:",
      `{ "issues": [{ "severity": "info"|"warn"|"error", "message": "..." }],`,
      `  "summary": "one-line overall assessment", "approved": true|false }`,
      "Only emit the JSON object — no prose, no markdown fences.",
    ].join("\n"),
    context: `## Question\n${question}\n\n## Answer\n${answer}`,
    volatile: "Review for: correctness, completeness, safety, clarity, missing context, wrong assumptions.",
  };
}

export class HindsightReviewer {
  constructor(private critic: ProviderProfile) {}

  health(): ComponentHealth {
    return this.critic.health();
  }

  /**
   * Review a (question, answer) pair. The critic stream is parsed for the first
   * JSON object it emits; if parsing fails, the result is reported as a single
   * "error" issue with the raw text.
   */
  async review(
    question: string,
    answer: string,
    history?: History,
  ): Promise<HindsightResult> {
    const prompt = buildHindsightPrompt(question, answer);
    const emptyHistory: History = history ?? { append() {}, entries: () => [] };
    try {
      const { events } = await this.critic.stream(prompt, emptyHistory);
      const text = events
        .filter((e) => e.kind === "text")
        .map((e) => (e.kind === "text" ? e.text : ""))
        .join("");
      const usage = collectUsage(events);
      const parsed = tryParseHindsight(text);
      if (parsed) return { ...parsed, usage };
      return {
        issues: [{ severity: "error", message: `hindsight critic returned unparseable output: ${text.slice(0, 120)}` }],
        summary: "hindsight parse failed",
        approved: false,
        usage,
      };
    } catch (e) {
      return {
        issues: [{ severity: "error", message: `hindsight critic threw: ${(e as Error).message}` }],
        summary: "hindsight error",
        approved: false,
        usage: { input: 0, output: 0 },
      };
    }
  }
}

function collectUsage(events: { kind: string }[]): TokenUsage {
  let input = 0, output = 0;
  for (const e of events) {
    // Cast through unknown — the runtime shape is well-known (the done event has .usage).
    const ev = e as unknown as { kind: string; usage?: TokenUsage };
    if (ev.kind === "done" && ev.usage) {
      input += ev.usage.input ?? 0;
      output += ev.usage.output ?? 0;
    }
  }
  return { input, output };
}

function tryParseHindsight(text: string): Omit<HindsightResult, "usage"> | null {
  // Extract the first JSON object from the text (handles stray whitespace/fences).
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice) as { issues?: HindsightIssue[]; summary?: string; approved?: boolean };
    return {
      issues: Array.isArray(obj.issues) ? obj.issues : [],
      summary: typeof obj.summary === "string" ? obj.summary : "",
      approved: obj.approved === true,
    };
  } catch {
    return null;
  }
}