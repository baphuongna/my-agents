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
  /** Per-member timeout in ms (default 30s; R41 fix). */
  timeoutMs?: number;
}

/** A member's contribution (text + observed usage + ok flag). */
interface MemberResponse {
  role: string;
  text: string;
  ok: boolean;
  timedOut?: boolean;
  /** Observed input/output tokens from the member's stream. */
  usage: TokenUsage;
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
    opts?: { tools?: readonly import("@my-agent/core").OpenAITool[] },
  ): Promise<{ events: StreamEvent[] }> {
    // Fan-out: every HEALTHY member answers in parallel (R41: skip Failed members).
    // Each member is wrapped in a per-member timeout so a hung provider cannot
    // block the whole council (Promise.all would otherwise wait forever).
    const DEFAULT_MEMBER_TIMEOUT_MS = 30_000;
    const responses: MemberResponse[] = await Promise.all(
      this.members
        .filter((m) => m.profile.health() !== "Failed")
        .map(async (m): Promise<MemberResponse> => {
          const timeoutMs = m.timeoutMs ?? DEFAULT_MEMBER_TIMEOUT_MS;
          try {
            const result = await Promise.race([
              m.profile.stream(prompt, history, { tools: opts?.tools }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("council member timed out")), timeoutMs),
              ),
            ]);
            const usage = collectUsage(result.events);
            return { role: m.role, text: extractText(result.events), ok: true, usage };
          } catch (e) {
            const timedOut = e instanceof Error && /timed out/.test(e.message);
            return {
              role: m.role,
              text: "",
              ok: false,
              timedOut,
              usage: { input: 0, output: 0 },
            };
          }
        }),
    );

    const events: StreamEvent[] = [];
    let input = 0;
    let output = 0;
    // Aggregate member usage (R41 fix: was discarding member done events).
    for (const r of responses) {
      input += r.usage.input;
      output += r.usage.output;
    }
    // Exclude timed-out members' partial text from aggregation.
    const okResponses = responses.filter((r) => r.ok);

    if (this.strategy === "attributed") {
      for (const r of okResponses) {
        events.push({ kind: "text", text: `## ${r.role}\n${r.text}\n\n` });
      }
    } else if (this.strategy === "majority") {
      const winner = vote(okResponses.map((r) => r.text));
      events.push({ kind: "text", text: winner });
    } else {
      // judge
      const answers = okResponses
        .map((r) => `### ${r.role}\n${r.text}`)
        .join("\n\n");
      const judgePrompt: SystemPrompt = {
        stable: "You are the council judge. Synthesize the members' answers into one consensus response, noting dissent.",
        context: answers,
        volatile: prompt.volatile,
      };
      try {
        const judgeResult = await this.judge!.stream(judgePrompt, history, { tools: opts?.tools });
        const judgeUsage = collectUsage(judgeResult.events);
        for (const e of judgeResult.events) if (e.kind === "text") events.push(e);
        // judge cost ADDED to member cost (real council cost = members + judge).
        input += judgeUsage.input;
        output = judgeUsage.output; // emitted text is the judge's synthesis
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

/** Sum input/output tokens from a stream's done events. */
function collectUsage(events: StreamEvent[]): TokenUsage {
  let input = 0;
  let output = 0;
  for (const e of events) {
    if (e.kind === "done") {
      input += e.usage.input ?? 0;
      output += e.usage.output ?? 0;
    }
  }
  return { input, output };
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

export type { LlmTrace };
