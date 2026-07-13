/**
 * @my-agent/memory/dream-cycle — LLM-driven offline consolidation (§8 R35).
 *
 * Runs while the agent is idle: collects recent memory facts from the last
 * interval, asks an (optional) LLM provider to summarize + extract patterns,
 * stores the summary back as a new "dream" fact, and reviews skills for
 * staleness (>30 days unused → noted for cleanup). The cycle is driven by a
 * configurable timer (default 30 min) and may also be invoked manually via
 * dream().
 *
 * Decoupling note: the memory package must NOT depend on @my-agent/skills
 * (siblings share only @my-agent/core). The SkillCurator surface below is a
 * small structural interface; callers adapt @my-agent/skills' SkillStore +
 * curate() to it at the wiring seam.
 *
 * Source: §8 Memory dream-cycle (consolidate); gbrain consolidate phase.
 */
import {
  nowWallclock,
  type History,
  type ProviderProfile,
  type StreamEvent,
  type SystemPrompt,
} from "@my-agent/core";
import type { Brain, Fact } from "./brain.js";

/** Result of a single dream cycle. */
export interface DreamResult {
  memoriesConsolidated: number;
  skillsReviewed: number;
  summary: string;
  durationMs: number;
}

/**
 * Skill-curation surface the dream cycle reviews for staleness. Implementations
 * adapt @my-agent/skills (`SkillStore` + `curate()`) to this interface; the
 * memory package stays decoupled from @my-agent/skills.
 */
export interface SkillCurator {
  /**
   * Review loaded skills for relevance/staleness. Returns the count reviewed +
   * the names of stale skills (e.g. >30 days unused) noted for cleanup.
   */
  review():
    | Promise<{ reviewed: number; stale: string[] }>
    | { reviewed: number; stale: string[] };
}

/** DreamCycle constructor options. */
export interface DreamCycleOptions {
  brain: Brain;
  skillCurator?: SkillCurator;
  /** Period between automatic cycles (default: 30 min). */
  intervalMs?: number;
  /** LLM provider for richer consolidation (optional; absent → zero-LLM digest). */
  provider?: ProviderProfile;
}

/** Default cycle interval: 30 minutes. */
export const DEFAULT_DREAM_INTERVAL_MS = 30 * 60 * 1000;

/** Staleness threshold for the skill review (>30 days unused). */
export const STALE_SKILL_AFTER_DAYS = 30;

/** Source/entity marker for dream-summarized facts. */
const DREAM_SOURCE = "dream";
const DREAM_ENTITY = "dream-summary";

/**
 * DreamCycle — periodic offline consolidation of recent memory + skill review.
 *
 * The timer is unref'd so dreaming never keeps an otherwise-idle process alive.
 */
export class DreamCycle {
  private readonly brain: Brain;
  private readonly skillCurator?: SkillCurator;
  private readonly intervalMs: number;
  private readonly provider?: ProviderProfile;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: DreamCycleOptions) {
    this.brain = opts.brain;
    this.skillCurator = opts.skillCurator;
    this.intervalMs = opts.intervalMs ?? DEFAULT_DREAM_INTERVAL_MS;
    this.provider = opts.provider;
  }

  /** Whether the periodic timer is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Begin periodic dream cycles (fires every intervalMs). Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      // Fire-and-forget; periodic cycles must never reject the timer.
      void this.dream().catch(() => {
        /* swallow — next tick retries */
      });
    }, this.intervalMs);
    // Dreaming is a background nicety: never keep the process alive for it.
    const t = this.timer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }

  /** Stop dreaming (clears the timer). Idempotent. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run one dream cycle manually. */
  async dream(): Promise<DreamResult> {
    const start = nowWallclock();

    // 1. Collect recent memory facts from the last interval period.
    const recent = this.collectRecentFacts();

    // 2. Summarize: LLM if a provider is wired, else a zero-LLM digest.
    const summary = this.provider
      ? await this.summarizeWithProvider(recent)
      : this.basicSummarize(recent);

    // 3. Store the summary back as a new "dream" fact (source: dream).
    this.brain.recordFact({
      kind: "belief",
      entity: DREAM_ENTITY,
      content: summary,
      visibility: "private",
      notability: 5,
      source: DREAM_SOURCE,
    });

    // 4. Review skills for staleness (>30 days unused → noted for cleanup).
    const skillsReviewed = await this.reviewSkills();

    return {
      memoriesConsolidated: recent.length,
      skillsReviewed,
      summary,
      durationMs: nowWallclock() - start,
    };
  }

  /**
   * Collect unconsolidated facts from the last `intervalMs` period. Dream
   * summaries (source: "dream") are excluded so they don't feed back into
   * themselves on the next cycle.
   */
  private collectRecentFacts(now: number = nowWallclock()): Fact[] {
    const cutoff = now - this.intervalMs;
    return this.brain
      .unconsolidatedFacts()
      .filter((f) => f.createdAt >= cutoff && f.source !== DREAM_SOURCE);
  }

  /** Ask the LLM to summarize the recent facts + extract patterns. */
  private async summarizeWithProvider(recent: Fact[]): Promise<string> {
    const corpus =
      recent.length === 0
        ? "(no new memories in this period)"
        : recent
            .map((f, i) => `${i + 1}. [${f.entity}] ${f.content}`)
            .join("\n");
    const prompt: SystemPrompt = {
      stable:
        "You are a memory consolidation engine. Summarize the following memory entries into a concise summary and extract recurring patterns.",
      context: `Consolidate these ${recent.length} memory entries:\n${corpus}`,
      volatile: "",
    };
    const { events } = await this.provider!.stream(prompt, makeStubHistory());
    const text = collectText(events);
    // If the provider emitted no text, fall back to the deterministic digest.
    return text.trim().length > 0 ? text : this.basicSummarize(recent);
  }

  /** Zero-LLM basic consolidation: a deterministic digest of recent facts. */
  private basicSummarize(recent: Fact[]): string {
    if (recent.length === 0) return "No new memories to consolidate.";
    const byEntity = new Map<string, number>();
    for (const f of recent) byEntity.set(f.entity, (byEntity.get(f.entity) ?? 0) + 1);
    const top = [...byEntity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([e, n]) => `${e} (${n})`)
      .join(", ");
    return `Consolidated ${recent.length} memories. Top entities: ${top}.`;
  }

  /** Review skills via the curator; returns the count reviewed. */
  private async reviewSkills(): Promise<number> {
    if (!this.skillCurator) return 0;
    const { reviewed } = await this.skillCurator.review();
    return reviewed;
  }
}

/** Build a minimal no-op History for a single provider call. */
function makeStubHistory(): History {
  return {
    append() {
      /* no-op — single-shot consolidation needs no history */
    },
    entries: () => [],
  };
}

/** Accumulate text chunks from stream events. */
function collectText(events: StreamEvent[]): string {
  let out = "";
  for (const e of events) {
    if (e.kind === "text") out += e.text;
  }
  return out;
}
