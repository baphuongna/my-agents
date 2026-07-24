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
import { createHash } from "node:crypto";
import { HindsightReviewer } from "./hindsight.js";

export type CouncilStrategy = "attributed" | "majority" | "judge";

/** Advisor fanout cadence (shard 06, Pattern 2).
 * - `user_turn` (default): advisors run ONCE per user turn; tool iterations reuse
 *   the cached guidance via the request signature.
 * - `per_call`: advisors run on every stream() call (no caching).
 * - `never`: disables caching entirely (same as per_call but explicit). */
export type CouncilCadence = "user_turn" | "per_call" | "never";

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
  /** Advisor fanout cadence (shard 06, Pattern 2). Default: "user_turn" — advisors
   * run once per user turn and reuse cached outputs for tool-loop iterations. */
  cadence?: CouncilCadence;
}

export class CouncilProvider implements ProviderProfile {
  readonly id: string;
  readonly model: string;
  private members: CouncilMember[];
  private strategy: CouncilStrategy;
  private judge?: ProviderProfile;
  /** P6 (shard 06, Pattern 6): signature cache for advisor fanout. Keyed by the
   * request signature (prefix up to last user message). A HIT reuses cached
   * member outputs without re-fanning. */
  private readonly sigCache = new Map<string, StreamEvent[]>();
  /** The fanout cadence (default: user_turn). */
  private readonly cadence: CouncilCadence;
  /** Number of cache hits (observability). */
  cacheHits = 0;
  /** Number of cache misses (observability). */
  cacheMisses = 0;

  constructor(opts: CouncilProviderOptions) {
    if (opts.members.length === 0) throw new Error("council requires ≥1 member");
    this.id = opts.id ?? `council:${opts.members.length}`;
    this.model = `council(${opts.members.map((m) => m.role).join(",")})`;
    this.members = opts.members;
    this.strategy = opts.strategy ?? "attributed";
    this.judge = opts.judge;
    this.cadence = opts.cadence ?? "user_turn";
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

  /** Create a HindsightReviewer backed by the first healthy member. */
  makeReviewer(): HindsightReviewer {
    const critic = this.members.find((m) => m.profile.health() !== "Failed")?.profile ?? this.members[0]!.profile;
    return new HindsightReviewer(critic);
  }

  /** Clear the signature cache (e.g. when member config changes). */
  clearCache(): void {
    this.sigCache.clear();
  }

  /** Number of cached signatures. */
  get cacheSize(): number {
    return this.sigCache.size;
  }

  async stream(
    prompt: SystemPrompt,
    history: History,
    opts?: { tools?: readonly import("@my-agent/core").OpenAITool[] },
  ): Promise<{ events: StreamEvent[] }> {
    // P6 (shard 06, Pattern 6): signature cache — on a HIT, reuse cached member
    // outputs without re-fanning. The signature hashes the prefix up to the LAST
    // user message so tool-loop iterations (which grow the assistant/tool tail)
    // don't invalidate it.
    if (this.cadence === "user_turn") {
      const sig = councilRequestSignature(prompt, history);
      const cached = this.sigCache.get(sig);
      if (cached) {
        this.cacheHits++;
        return { events: cached.map((e) => ({ ...e })) };
      }
      this.cacheMisses++;
      const result = await this.runFanout(prompt, history, opts);
      this.sigCache.set(sig, result.events);
      return result;
    }
    // per_call / never: no caching.
    return this.runFanout(prompt, history, opts);
  }

  /** Run the actual member fan-out + aggregation (the pre-cache stream() body). */
  private async runFanout(
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

/** Compute a request signature for the council cache (shard 06, Pattern 2/6).
 * The signature hashes the prompt tiers + the history prefix up to and including
 * the LAST user message. This means tool-loop iterations (which only grow the
 * assistant/tool tail) produce the same signature → cache hit → no re-fanout.
 *
 * Entries are serialized via JSON.stringify (best-effort structural hash). */
export function councilRequestSignature(
  prompt: SystemPrompt,
  history: History,
): string {
  const entries = history.entries();
  // Find the index of the LAST user-role entry.
  let lastUserIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && typeof e === "object" && "role" in e && (e as { role: string }).role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  // Prefix = everything up to and including the last user message (or all if none).
  const prefix = lastUserIdx >= 0 ? entries.slice(0, lastUserIdx + 1) : entries;
  const payload = JSON.stringify({
    stable: prompt.stable,
    context: prompt.context,
    volatile: prompt.volatile,
    prefix,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export type { LlmTrace };
