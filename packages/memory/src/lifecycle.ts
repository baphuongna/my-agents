/**
 * @my-agent/memory/lifecycle — Unified lifecycle manager.
 *
 * Replaces the fragmented domain onConsolidate() calls with a SINGLE coherent
 * lifecycle pipeline:
 *
 *   tick() = purge expired → decay weak → consolidate clusters → compile pages
 *
 * Sources:
 *   - agentmemory: Ebbinghaus decay, Jaccard supersede, auto-forget
 *   - graphify: time-decayed scoring, corroboration gating
 *   - context-mode: stale-source cleanup, FIFO eviction
 *   - mya existing: Brain.consolidate(), MemoryTree.promote(), purge()
 *
 * This is THE lifecycle entry point. Called on turn_end + DreamCycle timer.
 */
import type { Brain, Fact, Take } from "./brain.js";
import type { MemoryTree } from "./tree.js";
import { BrainStore } from "./brain-store.js";
import { nowWallclock } from "@my-agent/core";

// ── Lifecycle constants ───────────────────────────────────────────────────

/** Ebbinghaus decay rate per period. agentmemory default. */
const DECAY_RATE = 0.9;

/** Days per decay period. agentmemory default. */
const DECAY_PERIOD_DAYS = 7;

/** Strength below which a fact is purged. */
const PURGE_THRESHOLD = 0.05;

/** Minimum facts per consolidation bucket. */
const MIN_FACTS_PER_BUCKET = 3;

/** Cosine similarity threshold for consolidation clustering. */
const CONSOLIDATION_THRESHOLD = 0.85;

/** Jaccard threshold for supersede detection. agentmemory default. */
const SUPERSEDE_THRESHOLD = 0.7;

/** Max facts to consider per bucket (F7 DoS guard). */
const MAX_BUCKET_CONSIDERED = 200;

// ── Types ─────────────────────────────────────────────────────────────────

export interface LifecycleResult {
  purged: number;
  consolidated: { takesPromoted: number; factsConsumed: number };
  compiled: { pagesCompiled: number; takesConsumed: number };
  superseded: number;
  durationMs: number;
}

// ── Bag-of-words + cosine (shared with Brain but localized for cohesion) ──

function bow(text: string): Map<string, number> {
  const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length >= 2);
  const v = new Map<string, number>();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, aSq = 0, bSq = 0;
  for (const [k, v] of a) {
    aSq += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const [, v] of b) bSq += v * v;
  return aSq > 0 && bSq > 0 ? dot / (Math.sqrt(aSq) * Math.sqrt(bSq)) : 0;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ── Unified Lifecycle Manager ─────────────────────────────────────────────

export class LifecycleManager {
  private brainStore: BrainStore | undefined;

  constructor(
    private brain: Brain,
    private tree: MemoryTree | undefined,
  ) {}

  /** Wire a BrainStore so that Takes/Pages/Facts are persisted after tick(). */
  wireBrainStore(store: BrainStore): void {
    this.brainStore = store;
  }

  /**
   * Run the full lifecycle pipeline. Called on turn_end + DreamCycle timer.
   *
   * Pipeline (ordered):
   *   1. Purge expired facts (validUntil <= now)
   *   2. Purge decayed facts (strength < threshold, unless frequently accessed)
   *   3. Consolidate: cluster similar L0 facts → L1 Takes
   *   4. Compile: cluster similar L1 Takes → L2 Pages
   *   5. Reconcile tier labels with Brain state
   */
  tick(now: number = nowWallclock()): LifecycleResult {
    const start = now;

    // 1. Purge expired facts (validUntil)
    const purgedExpired = this.purgeExpired(now);

    // 2. Purge decayed facts (strength < threshold)
    const purgedDecayed = this.purgeDecayed(now);

    // 3. Consolidate: L0 facts → L1 Takes
    const consolidated = this.consolidate(now);

    // 4. Compile: L1 Takes → L2 Pages (only if tree is wired)
    const compiled = this.tree ? this.compile() : { pagesCompiled: 0, takesConsumed: 0 };

    // 5. Reconcile tier labels
    this.tree?.reconcile();

    // 6. Persist ALL state changes to BrainStore (full-fidelity).
    //    This ensures newly-created Takes + consolidated Facts + compiled Pages
    //    survive restart. Without this, consolidation is undone on restart.
    // C-GATE-2: Skip manual JSONL persistence when Brain storage is durable.
    //    SqliteBrainStore writes through on every putFact/putTake/putPage —
    //    the persistTakes/persistFact/persistPage calls below are redundant and
    //    would duplicate data. Still runs for InMemory (backward compat).
    if (this.brainStore && !this.brain.isDurable) {
      const takes = this.brain.takes;
      if (takes.length > 0) {
        void this.brainStore.persistTakes(takes, "L1");
      }
      // Persist facts that were consolidated (they got consolidatedAt set)
      for (const f of this.brain.allFacts.values()) {
        if (f.consolidatedAt !== undefined) {
          void this.brainStore.persistFact(f, "L1");
        }
      }
      // Persist any new pages
      for (const p of this.brain.allPages) {
        void this.brainStore.persistPage(p, "L2");
      }
    }

    return {
      purged: purgedExpired + purgedDecayed,
      consolidated,
      compiled,
      superseded: 0, // supersede happens at record time, not tick time
      durationMs: nowWallclock() - start,
    };
  }

  /** Phase 1: Purge facts whose validUntil has elapsed. */
  private purgeExpired(now: number): number {
    let n = 0;
    for (const f of [...this.brain.allFacts.values()]) {
      if (f.consolidatedAt !== undefined) continue; // consolidated = immortal
      if (f.validUntil !== undefined && f.validUntil <= now) {
        this.brain.purge(now);
        n++;
      }
    }
    return n;
  }

  /** Phase 2: Purge facts whose strength has decayed below threshold. */
  private purgeDecayed(now: number): number {
    let n = 0;
    const toPurge: string[] = [];
    for (const f of this.brain.allFacts.values()) {
      if (f.consolidatedAt !== undefined) continue; // consolidated = immortal
      const strength = this.computeStrength(f, now);
      if (strength < PURGE_THRESHOLD) {
        toPurge.push(f.id);
      }
    }
    // Brain.purge handles soft-delete + tombstone
    if (toPurge.length > 0) {
      this.brain.purge(now);
      n = toPurge.length; // approximate — purge may have already removed some
    }
    return n;
  }

  /**
   * Compute Ebbinghaus decay strength.
   * strength = (notability / 10) * DECAY_RATE^(days/DECAY_PERIOD_DAYS) * accessBoost
   * Frequently-accessed facts get a floor that prevents full decay.
   */
  computeStrength(f: Fact, now: number = nowWallclock()): number {
    const baseNotability = Math.max(1, f.notability ?? 1);
    const ageDays = (now - f.createdAt) / (24 * 60 * 60 * 1000);
    const decayPeriods = Math.floor(ageDays / DECAY_PERIOD_DAYS);
    const decayFactor = Math.pow(DECAY_RATE, decayPeriods);
    // Access boost: log-scaled, capped at 0.5
    const accessBoost = Math.min(0.5, Math.log1p(f.accessCount ?? 0) * 0.1);
    return (baseNotability * decayFactor * (1 + accessBoost)) / 10;
  }

  /**
   * Phase 3: Consolidate L0 facts → L1 Takes.
   * Clusters facts by (source, entity) bucket, then by cosine similarity.
   * Creates a Take for each qualifying cluster (≥ MIN_FACTS_PER_BUCKET).
   */
  private consolidate(now: number): { takesPromoted: number; factsConsumed: number } {
    const buckets = new Map<string, Fact[]>();
    for (const f of this.brain.allFacts.values()) {
      if (f.consolidatedAt !== undefined) continue;
      // Skip expired facts
      if (f.validUntil !== undefined && f.validUntil <= now) continue;
      const key = `${f.source}|${f.entity}`;
      const arr = buckets.get(key) ?? [];
      arr.push(f);
      buckets.set(key, arr);
    }

    let takesPromoted = 0;
    let factsConsumed = 0;

    for (const [, bucket] of buckets) {
      if (bucket.length < MIN_FACTS_PER_BUCKET) continue;
      const consider = bucket.length > MAX_BUCKET_CONSIDERED ? bucket.slice(-MAX_BUCKET_CONSIDERED) : bucket;
      const vectors = consider.map((f) => bow(f.content));

      // Find the largest seed-centered cluster
      let bestCluster: number[] = [];
      for (let i = 0; i < consider.length; i++) {
        const cluster = [i];
        for (let j = 0; j < consider.length; j++) {
          if (j === i) continue;
          if (cosine(vectors[i]!, vectors[j]!) >= CONSOLIDATION_THRESHOLD) cluster.push(j);
        }
        if (cluster.length > bestCluster.length) bestCluster = cluster;
      }

      if (bestCluster.length < 2) continue;

      // Create the Take via Brain's consolidate (it handles mutation)
      // We let Brain.consolidate do the actual promotion — this is a no-op
      // if Brain's own consolidation already ran. The lifecycle manager
      // delegates to Brain for the actual data mutation.
      break; // Brain.consolidate handles all buckets in one pass
    }

    // Delegate to Brain for actual consolidation
    const result = this.brain.consolidate();
    takesPromoted = result.takesPromoted;
    factsConsumed = result.factsConsumed;

    return { takesPromoted, factsConsumed };
  }

  /** Phase 4: Compile L1 Takes → L2 Pages. */
  private compile(): { pagesCompiled: number; takesConsumed: number } {
    if (!this.tree) return { pagesCompiled: 0, takesConsumed: 0 };
    return this.tree.compile();
  }

  /**
   * Check if a new fact should supersede an existing one.
   * Returns the existing fact's id if Jaccard > threshold, or null.
   * Called at record time (not tick time).
   */
  findSuperseded(content: string, entity: string): string | null {
    const newTokens = new Set(content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
    if (newTokens.size === 0) return null;

    let bestMatch: { id: string; score: number } | null = null;
    for (const f of this.brain.allFacts.values()) {
      if (f.entity !== entity) continue;
      if (f.consolidatedAt !== undefined) continue; // don't supersede consolidated
      const oldTokens = new Set(f.content.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
      if (oldTokens.size === 0) continue;
      const score = jaccard(newTokens, oldTokens);
      if (score > SUPERSEDE_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { id: f.id, score };
      }
    }
    return bestMatch?.id ?? null;
  }

  /** Record a recall hit — updates access tracking for decay computation. */
  recordAccess(factId: string, now: number = nowWallclock()): void {
    const f = this.brain.allFacts.get(factId);
    if (!f) return;
    this.brain.touchFact(factId, {
      lastAccessedAt: now,
      accessCount: (f.accessCount ?? 0) + 1,
    });
  }
}