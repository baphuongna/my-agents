/**
 * @my-agent/memory/brain — gbrain memory patterns (§8 R35, Tier-1+).
 *
 * A richer page+chunk+facts+takes schema + the dream-cycle `consolidate` phase.
 * Hot facts (conversation-extracted) accumulate; when ≥3 facts share a
 * (source,entity) bucket AND ≥2 of them cluster (cosine ≥0.85), they promote to
 * one `take`; consumed facts are marked consolidated_at, never deleted.
 *
 * Source: §8 Memory completeness (R35); gbrain cycle/consolidate, takes-vs-facts.
 */
import { randomUUID } from "node:crypto";
import { nowWallclock } from "@my-agent/core";

export type FactKind = "event" | "preference" | "commitment" | "belief" | "fact";
export type FactVisibility = "private" | "world";

export interface Fact {
  id: string;
  kind: FactKind;
  entity: string; // the subject the fact is about
  content: string;
  visibility: FactVisibility;
  notability: number;
  source: string; // source session/id
  createdAt: number;
  consolidatedAt?: number;
  consolidatedInto?: string; // the take id this fact promoted into
}

export interface Take {
  id: string;
  sources: string[]; // fact ids consumed
  entity: string;
  text: string;
  synthesizedAt: number;
}

export interface BrainPage {
  id: string;
  slug: string;
  compiledTruth: string;
  source: string;
  createdAt: number;
  version: number;
}

/**
 * The brain: holds facts + takes + pages. The `consolidate()` dream-cycle phase
 * promotes clustered facts into takes (≥3 facts per (source,entity) bucket, ≥2
 * cosine-similar). Consumed facts are marked, never deleted.
 */
export class Brain {
  private readonly facts = new Map<string, Fact>();
  private readonly takes = new Map<string, Take>();
  private readonly pages = new Map<string, BrainPage>();
  /** min facts per (source,entity) bucket before consolidation considers it. */
  /** F7 fix: caps to bound the O(n²) consolidate cost + memory. */
  private readonly maxFactContentChars = 4096;
  private readonly maxFactsTotal = 10_000;
  private readonly maxBucketConsidered = 200;

  constructor(private minFactsPerBucket = 3, private cosineThreshold = 0.85) {}

  /** Record a conversation-extracted hot fact. F7: content capped + total
   * fact count bounded (DoS guard against the dream-cycle O(n²)). */
  recordFact(f: Omit<Fact, "id" | "createdAt"> & { id?: string }): Fact {
    const content = f.content.length > this.maxFactContentChars
      ? f.content.slice(0, this.maxFactContentChars) + "…[truncated]"
      : f.content;
    if (this.facts.size >= this.maxFactsTotal) {
      throw new Error(`brain: fact cap reached (${this.maxFactsTotal})`);
    }
    const id = f.id ?? randomUUID();
    const full: Fact = { ...f, content, id, createdAt: nowWallclock() };
    this.facts.set(id, full);
    return full;
  }

  /** Dream-cycle consolidate phase: promote clustered facts → takes.
   * Returns { takesPromoted, factsConsumed }. Idempotent (already-consolidated
   * facts are skipped). */
  consolidate(): { takesPromoted: number; factsConsumed: number } {
    let takesPromoted = 0;
    let factsConsumed = 0;
    // bucket unconsolidated facts by (source, entity)
    const buckets = new Map<string, Fact[]>();
    for (const f of this.facts.values()) {
      if (f.consolidatedAt) continue;
      const key = `${f.source}|${f.entity}`;
      const arr = buckets.get(key) ?? [];
      arr.push(f);
      buckets.set(key, arr);
    }
    for (const [, bucket] of buckets) {
      if (bucket.length < this.minFactsPerBucket) continue;
      // F7: bound the O(n²) pairwise cost — only consider the most recent N.
      const consider = bucket.length > this.maxBucketConsidered ? bucket.slice(-this.maxBucketConsidered) : bucket;
      // find a cluster of ≥2 cosine-similar facts
      const cluster = this.largestCluster(consider);
      if (cluster.length < 2) continue;
      const takeId = randomUUID();
      const take: Take = {
        id: takeId,
        sources: cluster.map((f) => f.id),
        entity: cluster[0]!.entity,
        text: cluster.map((f) => f.content).join(" / "),
        synthesizedAt: nowWallclock(),
      };
      this.takes.set(takeId, take);
      for (const f of cluster) {
        f.consolidatedAt = nowWallclock();
        f.consolidatedInto = takeId;
        factsConsumed++;
      }
      takesPromoted++;
    }
    return { takesPromoted, factsConsumed };
  }

  /** Greedy largest cluster by pairwise cosine (on bag-of-words vectors). */
  private largestCluster(facts: Fact[]): Fact[] {
    const vectors = facts.map((f) => bow(f.content));
    let best: number[] = [];
    for (let i = 0; i < facts.length; i++) {
      const cluster = [i];
      for (let j = 0; j < facts.length; j++) {
        if (j === i) continue;
        if (cosine(vectors[i]!, vectors[j]!) >= this.cosineThreshold) cluster.push(j);
      }
      if (cluster.length > best.length) best = cluster;
    }
    return best.map((i) => facts[i]!);
  }

  /** Put a brain page (compiled truth). */
  putPage(p: Omit<BrainPage, "id" | "createdAt" | "version"> & { id?: string }): BrainPage {
    const id = p.id ?? randomUUID();
    const full: BrainPage = { ...p, id, createdAt: nowWallclock(), version: 1 };
    this.pages.set(id, full);
    return full;
  }

  factsByEntity(entity: string): Fact[] {
    return [...this.facts.values()].filter((f) => f.entity === entity);
  }
  unconsolidatedFacts(): Fact[] {
    return [...this.facts.values()].filter((f) => !f.consolidatedAt);
  }
  get takeCount(): number {
    return this.takes.size;
  }
  get factCount(): number {
    return this.facts.size;
  }
}

/** Bag-of-words vector (term → count). */
function bow(text: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of text.toLowerCase().split(/\W+/)) {
    if (t.length < 2) continue;
    v.set(t, (v.get(t) ?? 0) + 1);
  }
  return v;
}

/** Cosine similarity of two bag-of-words vectors. */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) dot += v * w;
  }
  const magA = Math.sqrt([...a.values()].reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt([...b.values()].reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}
