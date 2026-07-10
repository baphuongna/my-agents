/**
 * Council provider (§6) — fan-out to N member providers → vote/aggregate.
 *
 * A CouncilProvider implements ProviderProfile (drops into the registry / fallback
 * chain like any single profile). stream() runs ALL members in parallel on the
 * same prompt, collects each member's text answer, then emits an aggregated
 * response per the chosen strategy.
 *
 * Strategies:
 *   - "attributed": emit each member's answer as `## <member>: <text>` chunks
 *     (the caller sees all N perspectives; no judge call).
 *   - "majority": pick the answer shared by the most members (exact-match vote;
 *     ties broken by member order). Emits only the winner.
 *   - "judge": run a judge profile over the N answers → emit its synthesis.
 *     (Costs one extra call; the judge is a separate AuxiliaryProvider — invariant #8.)
 *
 * Source: §6 council archetype, openhuman model_council, the `council` skill
 * (Skeptic/Pragmatist/Critic vote → consensus + dissent).
 */
import type {
  ComponentHealth,
  History,
  LlmTrace,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
  TokenUsage,
} from "@my-agent/core";

export type CouncilStrategy = "attributed" | "majority" | "judge";

export interface CouncilMember {
  /** The underlying provider. */
  profile: ProviderProfile;
  /** Human-readable role label (e.g. "Skeptic", "Pragmatist", "Critic"). */
  role: string;
}

export interface CouncilProviderOptions {
  id?: string;
  members: CouncilMember[];
  strategy?: CouncilStrategy;
  /** For "judge" strategy: a separate profile that synthesizes the answers. */
  judge?: ProviderProfile;
}

export class CouncilProvider implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private members: CouncilMember[];
  private strategy: CouncilStrategy;
  private judge?: ProviderProfile;

  constructor(opts: CouncilProviderOptions) {
    if (opts.members.length === 0) throw new Error("council requires ≥1 member");
    this.id = opts.id ?? `council:${opts.members.length}`;
    this.model = `council(${opts.members.map((m) => m.role).join(",")})`;
    this.members = opts.members;
    this.strategy = opts.strategy ?? "attributed";
    this.judge = opts.judge;
    if (this.strategy === "judge" && !this.judge) {
      // Degrade gracefully: no judge wired → fall back to attributed.
      this.strategy = "attributed";
    }
  }

  health(): ComponentHealth {
    const healthy = this.members.filter((m) => m.profile.health() !== "Failed").length;
    if (healthy === this.members.length) return "Healthy";
    if (healthy === 0) return "Failed";
    return "Degraded";
  }

  async stream(
    prompt: SystemPrompt,
    history: History,
  ): Promise<{ events: StreamEvent[] }> {
    // Fan-out: every member answers the same prompt in parallel.
    const responses = await Promise.all(
      this.members.map(async (m) => {
        try {
          const { events } = await m.profile.stream(prompt, history);
          return { role: m.role, text: extractText(events), ok: true as const };
        } catch {
          return { role: m.role, text: "", ok: false as const };
        }
      }),
    );

    const events: StreamEvent[] = [];
    let input = 0;
    let output = 0;

    if (this.strategy === "attributed") {
      for (const r of responses) {
        if (!r.ok || !r.text) continue;
        events.push({ kind: "text", text: `## ${r.role}\n${r.text}\n\n` });
        output += estimateTokens(r.text);
      }
    } else if (this.strategy === "majority") {
      const winner = vote(responses.filter((r) => r.ok).map((r) => r.text));
      events.push({ kind: "text", text: winner });
      output += estimateTokens(winner);
    } else {
      // judge
      const answers = responses
        .filter((r) => r.ok)
        .map((r) => `### ${r.role}\n${r.text}`)
        .join("\n\n");
      const judgePrompt: SystemPrompt = {
        stable: "You are the council judge. Synthesize the members' answers into one consensus response, noting dissent.",
        context: answers,
        volatile: prompt.volatile,
      };
      try {
        const { events: jEvents } = await this.judge!.stream(judgePrompt, history);
        for (const e of jEvents) {
          if (e.kind === "text") events.push(e);
          if (e.kind === "done") input += e.usage.input;
        }
      } catch {
        // judge failed → degrade to attributed
        for (const r of responses) {
          if (r.ok && r.text) events.push({ kind: "text", text: `## ${r.role}\n${r.text}\n\n` });
        }
      }
    }

    const usage: TokenUsage = { input, output };
    events.push({ kind: "done", usage });
    return { events };
  }
}

/** Extract concatenated text from a stream's events. */
function extractText(events: StreamEvent[]): string {
  return events
    .filter((e) => e.kind === "text")
    .map((e) => (e.kind === "text" ? e.text : ""))
    .join("");
}

/** Majority vote: return the most-common exact answer (ties → first). */
function vote(answers: string[]): string {
  if (answers.length === 0) return "";
  const counts = new Map<string, number>();
  for (const a of answers) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best = answers[0]!;
  let bestN = 0;
  for (const [a, n] of counts) {
    if (n > bestN) {
      best = a;
      bestN = n;
    }
  }
  return best;
}

/** Rough token estimate (~4 chars/token) for usage accounting. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type { LlmTrace };
