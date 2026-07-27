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
import type { SqliteMemoryManager } from "./sqlite-manager.js";

/** Result of a single dream cycle. */
export interface DreamResult {
  memoriesConsolidated: number;
  skillsReviewed: number;
  summary: string;
  durationMs: number;
  /** True when the consolidation function declined to consolidate (decline strategy). */
  declined?: boolean;
  /** Reason given when consolidation was declined. */
  declineReason?: string;
  /** Recurring patterns the consolidation function identified. */
  patterns?: string[];
  /** True when the cycle aborted early due to a distributed shutdown signal. */
  shutdownAborted?: boolean;
}

/** A single memory entry handed to the consolidation function. */
export interface ConsolidationMemory {
  id?: string;
  entity: string;
  content: string;
  memoryType?: string;
}

/** Input passed to the LLM-driven consolidation callback. */
export interface ConsolidationInput {
  memories: ConsolidationMemory[];
}

/** The consolidation decision returned by the LLM (or a deterministic stand-in).
 *
 *  - `consolidate: true`  → store `summary` (+ `patterns`) as a dream fact and
 *    optionally supersede the source memories.
 *  - `consolidate: false` → decline strategy: do NOT store; surface
 *    `declineReason` (e.g. "memories are too disparate / low signal").
 */
export interface ConsolidationDecision {
  consolidate: boolean;
  summary: string;
  patterns: string[];
  declineReason?: string;
  /** Optional ids of source memories to mark superseded by this consolidation. */
  supersede?: string[];
}

/** Higher-level consolidation callback (the "summaryFn" pattern). Takes the
 * collected memories and returns a structured consolidate/decline decision.
 * This decouples the dream cycle from any specific provider wiring. */
export type ConsolidationFn = (input: ConsolidationInput) => Promise<ConsolidationDecision>;

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
  /** Legacy Brain (old system). Optional when sqliteMemory is provided. */
  brain?: Brain;
  skillCurator?: SkillCurator;
  /** Period between automatic cycles (default: 30 min). */
  intervalMs?: number;
  /** LLM provider for richer consolidation (optional; absent → zero-LLM digest). */
  provider?: ProviderProfile;
  /** SQLite memory manager (NEW — preferred over brain when available). */
  sqliteMemory?: SqliteMemoryManager;
  /** Idle check: cycle only runs when this returns true (default: always idle). */
  isIdle?: () => boolean;
  /** Allow private facts to be sent to the LLM provider (default: false).
   *  Tier-3 privacy: prevents private memories from leaking to external APIs. */
  allowPrivateInPrompt?: boolean;
  /** Higher-level LLM consolidation callback (the "summaryFn" pattern). When
   *  present, the dream cycle asks it for a consolidate/decline decision
   *  instead of (or in addition to) the raw provider. Takes precedence over
   *  `provider` for the consolidation step. */
  consolidationFn?: ConsolidationFn;
  /** Distributed-shutdown check: when this returns true the dream cycle aborts
   *  gracefully (no new storage), so a fleet of agents can wind down together. */
  isShuttingDown?: () => boolean;
}

/** Default cycle interval: 4 hours (deep consolidation — shallow lifecycle runs on every turn_end). */
export const DEFAULT_DREAM_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  private readonly brain?: Brain;
  private readonly sqliteMemory?: SqliteMemoryManager;
  private readonly skillCurator?: SkillCurator;
  private readonly intervalMs: number;
  private readonly provider?: ProviderProfile;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isIdle: () => boolean;
  private readonly allowPrivateInPrompt: boolean;
  private readonly consolidationFn?: ConsolidationFn;
  private isShuttingDown: () => boolean;
  private shutdownRequested = false;

  constructor(opts: DreamCycleOptions) {
    this.brain = opts.brain;
    this.sqliteMemory = opts.sqliteMemory;
    this.skillCurator = opts.skillCurator;
    this.intervalMs = opts.intervalMs ?? DEFAULT_DREAM_INTERVAL_MS;
    this.provider = opts.provider;
    this.isIdle = opts.isIdle ?? (() => true);
    this.allowPrivateInPrompt = opts.allowPrivateInPrompt ?? false;
    this.consolidationFn = opts.consolidationFn;
    this.isShuttingDown = opts.isShuttingDown ?? (() => false);
  }

  /** Whether the periodic timer is currently armed. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Begin periodic dream cycles (fires every intervalMs). Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      // Skip if agent is active (idle check prevents competing for LLM tokens).
      if (!this.isIdle()) return;
      // Distributed shutdown: stop arming once a shutdown is requested.
      if (this.isShuttingDown() || this.shutdownRequested) {
        this.stop();
        return;
      }
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

  /** Signal a distributed shutdown: arms the shutdown flag so the next periodic
   *  tick stops the timer, and any in-flight cycle aborts gracefully. Also
   *  stops the timer immediately. Idempotent. */
  shutdown(): void {
    this.shutdownRequested = true;
    this.stop();
  }

  /** Run one dream cycle manually. */
  async dream(): Promise<DreamResult> {
    const start = nowWallclock();

    // Distributed shutdown: abort before doing any work/storage.
    if (this.isShuttingDown() || this.shutdownRequested) {
      return {
        memoriesConsolidated: 0,
        skillsReviewed: 0,
        summary: "Dream cycle aborted: shutdown in progress.",
        durationMs: nowWallclock() - start,
        shutdownAborted: true,
      };
    }

    // C-GATE-1: When Brain is durable, its analysis path MUST run.
    // The old `if (sqliteMemory) return dreamSQLite` early-return is collapsed
    // when Brain is durable — Brain's facts + dream summaries must be processed.
    // dreamSQLite STILL runs for SMM's working_memory data (complementary —
    // different data source; see dig3 plan §6 note) AFTER the Brain path.
    if (this.sqliteMemory && !this.brain?.isDurable) {
      return this.dreamSQLite(start);
    }

    // Legacy Brain path (old system)
    if (!this.brain) {
      return { memoriesConsolidated: 0, skillsReviewed: 0, summary: "No memory backend.", durationMs: 0 };
    }

    // 1. Collect recent memory facts from the last interval period.
    const recent = this.collectRecentFacts();

    // 2. Consolidate: consolidationFn (LLM decision) if wired, else LLM
    //    provider summary, else a zero-LLM deterministic digest.
    let summary: string;
    let patterns: string[] | undefined;
    let declined = false;
    let declineReason: string | undefined;

    if (this.consolidationFn) {
      const decision = await this.runConsolidationFn(recent);
      // Re-check shutdown after the (possibly slow) LLM call.
      if (this.isShuttingDown() || this.shutdownRequested) {
        return {
          memoriesConsolidated: recent.length,
          skillsReviewed: 0,
          summary: "Dream cycle aborted mid-consolidation: shutdown in progress.",
          durationMs: nowWallclock() - start,
          shutdownAborted: true,
          patterns: decision.patterns,
        };
      }
      if (!decision.consolidate) {
        // Decline strategy: do NOT store the summary; surface the reason.
        declined = true;
        declineReason = decision.declineReason ?? "consolidation declined";
        summary = declineReason;
        patterns = decision.patterns;
      } else {
        summary = assembleDreamSummary(decision.summary, decision.patterns);
        patterns = decision.patterns;
      }
    } else {
      summary = this.provider
        ? await this.summarizeWithProvider(recent)
        : this.basicSummarize(recent);
    }

    // 3. Store the summary back as a new "dream" fact — UNLESS declined or there
    //    are no new memories to summarize. The recent.length guard ensures
    //    idempotency: a 2nd dream() call with no new facts does not create a
    //    duplicate summary (consistent with dreamSQLite's rows.length > 0 guard).
    if (!declined && recent.length > 0) {
      this.brain.recordFact({
        kind: "belief",
        entity: DREAM_ENTITY,
        content: summary,
        visibility: "private",
        notability: 5,
        source: DREAM_SOURCE,
      });
    }

    // 4. Review skills for staleness (>30 days unused → noted for cleanup).
    const skillsReviewed = await this.reviewSkills();

    // 4b. C-GATE-1 supplement: When Brain is durable AND sqliteMemory is present,
    //     also consolidate SMM's working_memory data (complementary data source —
    //     brain_facts vs working_memory are disjoint). Skill review already ran
    //     above, so pass skipSkills=true to avoid duplication.
    //     F5: best-effort — failures are swallowed (SMM retries next cycle).
    //     F6: capture + merge SMM's memoriesConsolidated into the returned count.
    let smmConsolidated = 0;
    if (this.brain?.isDurable && this.sqliteMemory) {
      try {
        const smmResult = await this.dreamSQLite(start, true);
        smmConsolidated = smmResult.memoriesConsolidated;
      } catch {
        /* best-effort — SMM consolidation retries next cycle */
      }
    }

    return {
      memoriesConsolidated: recent.length + smmConsolidated,
      skillsReviewed,
      summary,
      durationMs: nowWallclock() - start,
      ...(declined ? { declined: true, declineReason } : {}),
      ...(patterns && patterns.length > 0 ? { patterns } : {}),
    };
  }

  /** Invoke the LLM-driven consolidation callback, mapping Fact[] → the callback
   *  input shape. Falls back to a decline when the callback throws. */
  private async runConsolidationFn(recent: Fact[]): Promise<ConsolidationDecision> {
    const memories: ConsolidationMemory[] = recent.map((f) => ({
      id: f.id,
      entity: f.entity,
      content: f.content,
      ...(f.kind ? { memoryType: f.kind } : {}),
    }));
    try {
      return await this.consolidationFn!({ memories });
    } catch (e) {
      // A failed LLM call → conservative decline (don't store garbage).
      return {
        consolidate: false,
        summary: "",
        patterns: [],
        declineReason: `consolidation failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * SQLite dream cycle: uses the new SQLite memory system.
   * Collects recent working_memory entries, summarizes them,
   * stores the summary as episodic memory, and runs lifecycle.
   *
   * @param skipSkills When true, skip skill review (already done in Brain path).
   */
  private async dreamSQLite(start: number, skipSkills = false): Promise<DreamResult> {
    const db = this.sqliteMemory!.getDatabase();
    const cutoff = new Date(nowWallclock() - this.intervalMs).toISOString();

    // 1. Collect recent unconsolidated memories from SQLite
    const rows = db.prepare(`
      SELECT id, content, memory_type, importance, source
      FROM working_memory
      WHERE timestamp >= ?
        AND consolidated_at IS NULL
        AND superseded_by IS NULL
        AND source NOT LIKE 'dream%'
        AND scope = 'global'
      ORDER BY importance DESC, timestamp DESC
      LIMIT 50
    `).all(cutoff) as Array<{ id: string; content: string; memory_type: string; importance: number; source: string }>;

    // 2. Summarize
    const summary = this.provider
      ? await this.summarizeSqliteWithProvider(rows)
      : this.basicSummarizeSqlite(rows);

    // 3. Store summary as episodic memory (the dream output)
    if (rows.length > 0) {
      this.sqliteMemory!.recordEpisodic({
        content: `[Dream] ${summary}`,
        source: DREAM_SOURCE,
        importance: 0.6,
        veracity: "inferred",
        memoryType: "event",
      });
    }

    // 4. Run lifecycle (consolidate working→episodic, degrade, purge)
    this.sqliteMemory!.lifecycle();

    // 5. Review skills (skip if already done in the Brain path)
    const skillsReviewed = skipSkills ? 0 : await this.reviewSkills();

    return {
      memoriesConsolidated: rows.length,
      skillsReviewed,
      summary,
      durationMs: nowWallclock() - start,
    };
  }

  /** LLM summarization of SQLite rows. */
  private async summarizeSqliteWithProvider(rows: Array<{ content: string; memory_type: string }>): Promise<string> {
    const corpus =
      rows.length === 0
        ? "(no new memories in this period)"
        : rows.map((r, i) => `${i + 1}. [${r.memory_type}] ${r.content}`).join("\n");
    const prompt: SystemPrompt = {
      stable: "You are a memory consolidation engine. Summarize the following memories into a concise summary and extract recurring patterns.",
      context: `Consolidate these ${rows.length} memories:\n${corpus}`,
      volatile: "",
    };
    try {
      const { events } = await this.provider!.stream(prompt, makeStubHistory());
      const text = collectText(events);
      return text.trim().length > 0 ? text : this.basicSummarizeSqlite(rows);
    } catch {
      return this.basicSummarizeSqlite(rows);
    }
  }

  /** Zero-LLM deterministic digest of SQLite rows. */
  private basicSummarizeSqlite(rows: Array<{ content: string; memory_type: string }>): string {
    if (rows.length === 0) return "No new memories to consolidate.";
    const byType = new Map<string, number>();
    for (const r of rows) byType.set(r.memory_type, (byType.get(r.memory_type) ?? 0) + 1);
    const top = [...byType.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, n]) => `${t}(${n})`)
      .join(", ");
    const samples = rows.slice(0, 3).map((r) => r.content.slice(0, 60)).join(" | ");
    return `Consolidated ${rows.length} memories [${top}]. Recent: ${samples}`;
  }

  /**
   * Collect unconsolidated facts from the last `intervalMs` period. Dream
   * summaries (source: "dream") are excluded so they don't feed back into
   * themselves on the next cycle.
   * Tier-3: private facts are only sent to the provider when
   * allowPrivateInPrompt is true (default false — trust boundary).
   */
  private collectRecentFacts(now: number = nowWallclock()): Fact[] {
    if (!this.brain) return [];
    const cutoff = now - this.intervalMs;
    return this.brain
      .unconsolidatedFacts()
      .filter(
        (f) =>
          f.createdAt >= cutoff &&
          f.source !== DREAM_SOURCE &&
          (this.allowPrivateInPrompt || f.visibility !== "private"),
      );
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
    try {
      const { events } = await this.provider!.stream(prompt, makeStubHistory());
      const text = collectText(events);
      // If the provider emitted no text, fall back to the deterministic digest.
      return text.trim().length > 0 ? text : this.basicSummarize(recent);
    } catch {
      // Provider error (network, auth, timeout) → fall back to deterministic digest.
      return this.basicSummarize(recent);
    }
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
    try {
      const { reviewed } = await this.skillCurator.review();
      return reviewed;
    } catch {
      // Skill review is best-effort — never fail the dream cycle for it
      return 0;
    }
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

/** Assemble the stored dream-summary text from a summary + identified patterns.
 *  Pure + exported so the prompt assembly is unit-testable. */
export function assembleDreamSummary(summary: string, patterns: string[]): string {
  const trimmed = summary.trim();
  if (patterns.length === 0) return trimmed;
  return `${trimmed}\n\nPatterns: ${patterns.join("; ")}`;
}

/** Build the system+context prompt an LLM consolidation call should use, given
 *  the collected memories. Pure + exported for testing the prompt contract. */
export function buildConsolidationPrompt(memories: ConsolidationMemory[]): {
  stable: string;
  context: string;
} {
  const corpus =
    memories.length === 0
      ? "(no new memories in this period)"
      : memories
          .map((m, i) => `${i + 1}. [${m.entity}] ${m.content}`)
          .join("\n");
  return {
    stable:
      "You are a memory consolidation engine. Identify recurring patterns, decide whether these memories are worth consolidating, and produce a concise summary. If the memories are too disparate or low-signal, decline consolidation.",
    context: `Consolidate these ${memories.length} memory entries (respond with a consolidate/decline decision + patterns + summary):\n${corpus}`,
  };
}
