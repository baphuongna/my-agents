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
  validFrom?: number;
  /** Phase 8: when set, the fact is purgeable once now > validUntil. */
  validUntil?: number;
  consolidatedAt?: number;
  consolidatedInto?: string; // the take id this fact promoted into
  /** Phase 10 dream-cycle embed phase marker. */
  embedded?: boolean;
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
  /** Review CRITICAL-1: soft-delete tombstones (review CRITICAL-1 — spec mandates
   * soft-delete + 72h TTL recovery; hard-delete breaks "consolidated facts never
   * deleted" + loses user data). */
  private readonly tombstones = new Map<string, { fact: Fact; deletedAt: number }>();
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

  /**
   * Dream cycle phase: backlinks — extract zero-LLM typed edges from fact
   * content (`[Name](path)` + `[[wikilink]]` + bare-name). Returns the edges.
   * Phase 8 implements this surface; persistence (TypedKnowledgeGraph) is
   * deferred to the typed-graph arm.
   *
   * Review-driven hardening:
   *   - HIGH-1: WIKI regex strips the pipe + alias (`[[Alice|Alias]]` → slug "Alice").
   *   - HIGH-2: fenced/inline code is stripped before edge extraction.
   *   - HIGH-3: bare-name edges use PascalCase-word membership against the
   *     entity's words (no over-firing on suffix substrings like "LLM" in "ProjectLLM").
   *   - LOW-1: dedup by (fromFactId|to|kind).
   */
  backlinks(): Array<{ from: string; fromFactId: string; to: string; kind: "link" | "wikilink" | "bare" }> {
    const edges: Array<{ from: string; fromFactId: string; to: string; kind: "link" | "wikilink" | "bare" }> = [];
    const WIKI = /\[\[([^|\]#\n]+?)(?:\|[^\]]+?)?\]\]/g;
    const LINK = /\[[^\]]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
    // strip fenced/inline code + mask link LABELS (so a wikilink inside a link text
    // label doesn't double-emit). Reference: gbrain stripCodeBlocks.
    const stripCode = (s: string): string =>
      s
        .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))
        .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
    for (const f of this.facts.values()) {
      const text = stripCode(f.content);
      // PascalCase-word split (HIGH-3): "MrsSmith" → {Mrs, Smith}; "ProjectLLM" → {Project, L, M}.
      const entityWords = new Set<string>();
      for (const m of f.entity.matchAll(/[A-Z][a-z]+/g)) entityWords.add(m[0]);
      // also include entity itself (exact-match case)
      entityWords.add(f.entity);
      let m: RegExpExecArray | null;
      WIKI.lastIndex = 0;
      while ((m = WIKI.exec(text)) !== null) edges.push({ from: f.entity, fromFactId: f.id, to: m[1]!, kind: "wikilink" });
      LINK.lastIndex = 0;
      while ((m = LINK.exec(text)) !== null) {
        // extract the URL portion: the last (...) in the match (skips nested display text)
        const urlM = m[0].match(/\(([^()\n]*)\)\s*$/);
        const url = urlM?.[1] ?? "";
        if (url) edges.push({ from: f.entity, fromFactId: f.id, to: url.split("|")[0]!, kind: "link" });
      }
      // bare names: only when the bare (capitalized word) MATCHES a word in the entity.
      // mask markdown link labels inside `text` so a bare name inside `[Alice](x)`
      // doesn't double-emit as both `link: x` AND `bare: Alice`.
      const maskedForBare = text.replace(LINK, (m) => " ".repeat(m.length));
      const bareMatches = maskedForBare.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
      const bare = new Set(bareMatches);
      for (const b of bare) if (entityWords.has(b)) edges.push({ from: f.entity, fromFactId: f.id, to: b, kind: "bare" });
    }
    // LOW-1: dedupe by (fromFactId|to|kind).
    const seen = new Set<string>();
    const out: typeof edges = [];
    for (const e of edges) {
      const k = `${e.fromFactId}|${e.to}|${e.kind}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }

  /**
   * Dream cycle phase: purge — soft-delete expired facts (review CRITICAL-1).
   * Consolidated facts are NEVER purged (spec line 71). Facts land in `tombstones`
   * with a `deletedAt` for `restore_page`-style recovery (within the 72h TTL).
   * Returns the count soft-deleted.
   */
  purge(now = nowWallclock()): number {
    let n = 0;
    for (const f of [...this.facts.values()]) {
      // M4: consolidated facts are immortal (spec line 71).
      if (f.consolidatedAt !== undefined) continue;
      const notYetValid = f.validFrom !== undefined && f.validFrom > now;
      const expired = f.validUntil !== undefined && f.validUntil <= now; // HIGH-4: inclusive end
      if (notYetValid && f.validUntil === undefined) { this.softDelete(f, now); n++; continue; }
      if (expired) { this.softDelete(f, now); n++; }
    }
    return n;
  }

  /** CRITICAL-1: soft-delete: move to tombstones (spec "soft-delete" — reversible via restore). */
  private softDelete(f: Fact, now: number): void {
    this.tombstones.set(f.id, { fact: f, deletedAt: now });
    this.facts.delete(f.id);
  }

  /** CRITICAL-1: restore a soft-deleted fact from its tombstone. */
  restore(factId: string): boolean {
    const t = this.tombstones.get(factId);
    if (!t) return false;
    if (this.facts.size >= this.maxFactsTotal) return false;
    this.facts.set(factId, t.fact);
    this.tombstones.delete(factId);
    return true;
  }

  /** CRITICAL-1: purge tombstones older than the cutoff (matches gbrain
   * `purgeDeletedPages(olderThanHours=72)`). */
  purgeTombstones(olderThanHours = 72, now = nowWallclock()): number {
    const cutoff = now - olderThanHours * 3_600_000;
    let n = 0;
    for (const [id, t] of this.tombstones) if (t.deletedAt < cutoff) { this.tombstones.delete(id); n++; }
    return n;
  }

  get tombstoneCount(): number { return this.tombstones.size; }
  tombstonesList(): { id: string; fact: Fact; deletedAt: number }[] {
    return [...this.tombstones.entries()].map(([id, t]) => ({ id, fact: t.fact, deletedAt: t.deletedAt }));
  }

  /**
   * Dream cycle phase: extract_facts — zero-LLM structured extraction from
   * fact content. Scans for dates, URLs, emails, commit hashes, + version
   * strings. Returns the extracted atoms (Phase 10 surface; an LLM-driven
   * extractor would be richer).
   */
  extractFacts(): Array<{ factId: string; kind: string; value: string }> {
    const atoms: Array<{ factId: string; kind: string; value: string }> = [];
    const patterns: Array<{ kind: string; re: RegExp }> = [
      { kind: "date", re: /\b(\d{4}-\d{2}-\d{2})\b/g },
      { kind: "url", re: /\b(https?:\/\/[^\s)]+)/g },
      { kind: "email", re: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g },
      { kind: "commit", re: /\b([0-9a-f]{7,40})\b/g },
      { kind: "version", re: /\bv?(\d+\.\d+\.\d+)\b/g },
    ];
    for (const f of this.facts.values()) {
      for (const { kind, re } of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(f.content)) !== null) atoms.push({ factId: f.id, kind, value: m[1]! });
      }
    }
    return atoms;
  }

  /**
   * Dream cycle phase: embed — marks facts as indexed for the vector arm.
   * Phase 10 Tier-1: a boolean flag (the vector arm computes on-the-fly; a
   * persisted embedding would replace this when an embedding model is wired).
   * Returns the count of facts newly marked.
   */
  embed(): number {
    let n = 0;
    for (const f of this.facts.values()) {
      if (!f.embedded) { (f as Fact & { embedded?: boolean }).embedded = true; n++; }
    }
    return n;
  }

  /** Phase 10: count of embedded facts (for the embed dream-cycle phase). */
  get embeddedCount(): number {
    let n = 0;
    for (const f of this.facts.values()) if ((f as Fact & { embedded?: boolean }).embedded) n++;
    return n;
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
