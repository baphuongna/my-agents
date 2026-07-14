/**
 * @my-agent/memory/tree — L0/L1/L2 tier coordinator (Phase A Gap 3).
 *
 * The three-tier memory hierarchy from gbrain:
 *   L0 (Events) — raw `Fact`s, ephemeral, session-scoped, auto-24h TTL.
 *   L1 (Takes)  — consolidated `Take`s, cross-session, persistent.
 *   L2 (Pages)  — compiled `BrainPage`s, cross-project, vector-indexed.
 *
 * `MemoryTree` wraps Brain (it does NOT modify Brain). It owns a tier label per
 * record id + a single point of entry for all promotions. Brain stays as the
 * lowest-level primitive (the 477-test baseline is frozen).
 *
 * Source: source/.learned/GAP-IMPLEMENTATION-PLAN.md Phase A Gap 3.
 */
import { randomUUID } from "node:crypto";
import { nowWallclock } from "@my-agent/core";
import { type Brain, type BrainPage, type Fact, type Take, bow, cosine } from "./brain.js";

/** Tier label. */
export type Tier = "L0" | "L1" | "L2";

/** 24h TTL on raw facts (L0). Exported for tests + reuse. */
export const L0_TTL_MS = 86_400_000;

/** Cosine threshold for L2 compile. */
const L2_COSINE_THRESHOLD = 0.85;
/** Minimum cluster size to promote. */
const L2_MIN_CLUSTER = 2;
/** F7-style cap: bound O(n²) pairwise cost on compile(). */
const L2_MAX_TAKES_CONSIDERED = 200;

/**
 * Tier label store. One record id → one Tier. `brain` is the underlying store;
 * MemoryTree never holds copies of facts/takes/pages, it just tracks their tier
 * labels.
 */
export class MemoryTree {
  private readonly tierMap = new Map<string, Tier>();
  /** Tracks facts recorded via assignTier for L0 promotion detection. */
  private readonly knownL0Ids = new Set<string>();

  constructor(private readonly brain: Brain) {}

  /**
   * Assign a Tier to a fact (L0 by default). Auto-sets `validUntil = now + 24h`
   * if not provided, then delegates to `brain.recordFact`. Returns the
   * persisted Fact.
   *
   * NEVER modifies `Brain.recordFact` (which is the lowest-level primitive).
   */
  assignTier(
    fact: Omit<Fact, "id" | "createdAt"> & { id?: string; tier?: Tier; validUntil?: number },
  ): { fact: Fact; tier: Tier } {
    const effective: typeof fact = { ...fact };
    const requestedTier: Tier = fact.tier ?? "L0";
    if (requestedTier === "L0" && effective.validUntil === undefined) {
      effective.validUntil = nowWallclock() + L0_TTL_MS;
    }
    delete (effective as { tier?: Tier }).tier;
    const persisted = this.brain.recordFact(effective as Omit<Fact, "id" | "createdAt"> & { id?: string });
    this.tierMap.set(persisted.id, requestedTier);
    if (requestedTier === "L0") this.knownL0Ids.add(persisted.id);
    return { fact: persisted, tier: requestedTier };
  }

  /**
   * L0 → L1: run `brain.consolidate()`, then re-label any new takes as L1. Also
   * re-labels the consumed L0 facts (those now carry `consolidatedInto`) as
   * "L1" so they don't get re-purged.
   */
  promote(): { takesPromoted: number; factsConsumed: number; l0ToL1: number } {
    const beforeTakeIds = new Set(this.brain.takes.map((t) => t.id));
    const result = this.brain.consolidate();
    let l0ToL1 = 0;
    for (const t of this.brain.takes) {
      if (!beforeTakeIds.has(t.id)) this.tierMap.set(t.id, "L1");
    }
    // Walk each take's sources (consumed fact ids) and demote L0 → L1 in the
    // tier map. Brain itself already marks `consolidatedAt`/`consolidatedInto`;
    // we only mirror that in the tier labels.
    for (const t of this.brain.takes) {
      for (const fid of t.sources) {
        if (this.tierMap.get(fid) === "L0") { this.tierMap.set(fid, "L1"); l0ToL1++; }
      }
    }
    return { ...result, l0ToL1 };
  }

  /**
   * L1 → L2: cluster takes by bag-of-words cosine (≥ L2_MIN_CLUSTER similar
   * takes → 1 BrainPage). Bounded by L2_MAX_TAKES_CONSIDERED (F7-style O(n²)
   * guard). Marks the cluster take ids as L2 + the new page id as L2.
   *
   * bow()/cosine() are duplicated verbatim from brain.ts (kept file-local there
   * for the Brain API surface). If Brain ever exports them, swap to imports.
   *   // keep in sync with brain.ts:471-488
   */
  compile(threshold: number = L2_COSINE_THRESHOLD, minCluster: number = L2_MIN_CLUSTER): { pagesCompiled: number; takesConsumed: number } {
    const allTakes = this.brain.takes;
    if (allTakes.length === 0) return { pagesCompiled: 0, takesConsumed: 0 };
    const consider = allTakes.length > L2_MAX_TAKES_CONSIDERED
      ? allTakes.slice(-L2_MAX_TAKES_CONSIDERED)
      : allTakes;
    const vectors = consider.map((t) => bow(t.text));
    // Greedy: for each take, find the largest cluster of similar takes (cosine ≥ threshold).
    const used = new Set<string>();
    let pagesCompiled = 0;
    let takesConsumed = 0;
    for (let i = 0; i < consider.length; i++) {
      const seed = consider[i]!;
      if (used.has(seed.id)) continue;
      const cluster: Take[] = [seed];
      used.add(seed.id);
      for (let j = i + 1; j < consider.length; j++) {
        const candidate = consider[j]!;
        if (used.has(candidate.id)) continue;
        if (cosine(vectors[i]!, vectors[j]!) >= threshold) {
          cluster.push(candidate);
          used.add(candidate.id);
        }
      }
      if (cluster.length >= minCluster) {
        const slug = `compiled/${cluster[0]!.entity}-${randomUUID().slice(0, 8)}`;
        const compiledTruth = cluster.map((t) => t.text).join(" / ");
        const page = this.brain.putPage({ slug, compiledTruth, source: "compile" });
        this.tierMap.set(page.id, "L2");
        for (const t of cluster) this.tierMap.set(t.id, "L2");
        pagesCompiled++;
        takesConsumed += cluster.length;
      }
    }
    return { pagesCompiled, takesConsumed };
  }

  /** Read the tier label for a record id. */
  getTier(id: string): Tier | undefined {
    return this.tierMap.get(id);
  }

  /**
   * Demote: remove the tier label (the record itself is unaffected — this is a
   * label-only reset, not a Brain delete). If a hard delete is needed, use
   * `brain.purge`/`restore`. Returns true if the id had a label.
   */
  demote(id: string): boolean {
    const had = this.tierMap.has(id);
    this.tierMap.delete(id);
    this.knownL0Ids.delete(id);
    return had;
  }

  /** H2 fix: reconcile tierMap with Brain state — remove labels for ids that
   * were purged/restored/deleted outside the tree. Call in onConsolidate. */
  reconcile(): number {
    if (!this.brain) return 0;
    const liveIds = new Set<string>();
    // L0 facts (unconsolidated — consolidated facts are consumed into takes)
    for (const f of this.brain.unconsolidatedFacts()) liveIds.add(f.id);
    // L1 takes + their source fact ids
    for (const t of this.brain.takes) {
      liveIds.add(t.id);
      for (const srcId of t.sources) liveIds.add(srcId);
    }
    // L2 pages
    const pages = ((this.brain as unknown as { allPages?: BrainPage[] }).allPages) ?? [];
    for (const p of pages) liveIds.add(p.id);
    let removed = 0;
    for (const id of [...this.tierMap.keys()]) {
      if (!liveIds.has(id)) { this.tierMap.delete(id); this.knownL0Ids.delete(id); removed++; }
    }
    return removed;
  }

  /** Snapshot of the tier map (for diagnostics + tests). */
  snapshot(): Record<string, Tier> {
    return Object.fromEntries(this.tierMap);
  }
}
