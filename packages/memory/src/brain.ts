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
import { InMemoryBrainStorage, type BrainStorage } from "./brain-storage.js";

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
  /** Tier-3: Ebbinghaus decay tracking. Updated by LifecycleManager. */
  accessCount?: number;
  lastAccessedAt?: number;
  strength?: number;
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
  /** Dig 3 Phase A: storage seam (swappable — InMemoryBrainStorage default,
   * SqliteBrainStore for durable backing in Phase B). */
  private readonly storage: BrainStorage;
  /** Tier-3: public read-only view for cross-class access (LifecycleManager, etc). */
  public get allFacts(): ReadonlyMap<string, Fact> { return this.storage.getFactMap(); }
  /** min facts per (source,entity) bucket before consolidation considers it. */
  /** F7 fix: caps to bound the O(n²) consolidate cost + memory. */
  private readonly maxFactContentChars = 4096;
  private readonly maxFactsTotal = 10_000;
  private readonly maxBucketConsidered = 200;

  constructor(private minFactsPerBucket = 3, private cosineThreshold = 0.85, storage?: BrainStorage) {
    this.storage = storage ?? new InMemoryBrainStorage();
  }

  /** Dig 3 Phase A: bulk-hydrate from a snapshot (used by manager.loadFromBrainStore).
   * Clears all storage state, reloads from the snapshot, and invalidates caches. */
  loadFromSnapshot(snapshot: {
    facts: Iterable<Fact>;
    takes: Iterable<Take>;
    pages: Iterable<BrainPage>;
    tombstones: Iterable<[string, { fact: Fact; deletedAt: number }]>;
  }): void {
    this.storage.loadFromSnapshot(snapshot);
    this.backlinksCache = null;
  }

  /** Phase 14c: backlinks() cache (performance). Invalidated on recordFact/purge. */
  private backlinksCache: Array<{ from: string; fromFactId: string; to: string; kind: "link" | "wikilink" | "bare" }> | null = null;

  /** Record a conversation-extracted hot fact. F7: content capped + total
   * fact count bounded (DoS guard against the dream-cycle O(n²)). */
  recordFact(f: Omit<Fact, "id" | "createdAt"> & { id?: string }): Fact {
    const content = f.content.length > this.maxFactContentChars
      ? f.content.slice(0, this.maxFactContentChars) + "…[truncated]"
      : f.content;
    if (this.storage.factCount >= this.maxFactsTotal) {
      throw new Error(`brain: fact cap reached (${this.maxFactsTotal})`);
    }
    const id = f.id ?? randomUUID();
    const full: Fact = { ...f, content, id, createdAt: nowWallclock() };
    this.storage.putFact(full);
    this.backlinksCache = null; // invalidate
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
    const now = nowWallclock();
    for (const f of this.storage.allFacts()) {
      if (f.consolidatedAt) continue;
      // Skip expired facts — they should be purged, not promoted to immortal Takes.
      if (f.validUntil !== undefined && f.validUntil <= now) continue;
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
      this.storage.putTake(take);
      for (const f of cluster) {
        f.consolidatedAt = nowWallclock();
        f.consolidatedInto = takeId;
        this.storage.putFact(f); // GAP-1 fix: persist in-place mutation for future SqliteBrainStore
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
    this.storage.putPage(full);
    return full;
  }

  factsByEntity(entity: string): Fact[] {
    return [...this.storage.allFacts()].filter((f) => f.entity === entity);
  }
  unconsolidatedFacts(): Fact[] {
    return [...this.storage.allFacts()].filter((f) => !f.consolidatedAt);
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
    if (this.backlinksCache) return this.backlinksCache;
    const edges: Array<{ from: string; fromFactId: string; to: string; kind: "link" | "wikilink" | "bare" }> = [];
    const WIKI = /\[\[([^|\]#\n]+?)(?:\|[^\]]+?)?\]\]/g;
    const LINK = /\[[^\]]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
    // strip fenced/inline code + mask link LABELS (so a wikilink inside a link text
    // label doesn't double-emit). Reference: gbrain stripCodeBlocks.
    const stripCode = (s: string): string =>
      s
        .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))
        .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
    for (const f of this.storage.allFacts()) {
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
    this.backlinksCache = out; // populate cache
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
    for (const f of [...this.storage.allFacts()]) {
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
    this.storage.putTombstone(f.id, { fact: f, deletedAt: now });
    this.storage.deleteFact(f.id);
    this.backlinksCache = null; // invalidate
  }

  /** CRITICAL-1: restore a soft-deleted fact from its tombstone. */
  restore(factId: string): boolean {
    const t = this.storage.getTombstone(factId);
    if (!t) return false;
    if (this.storage.factCount >= this.maxFactsTotal) return false;
    this.storage.putFact(t.fact);
    this.storage.deleteTombstone(factId);
    this.backlinksCache = null; // invalidate
    return true;
  }

  /** CRITICAL-1: purge tombstones older than the cutoff (matches gbrain
   * `purgeDeletedPages(olderThanHours=72)`). */
  purgeTombstones(olderThanHours = 72, now = nowWallclock()): number {
    const cutoff = now - olderThanHours * 3_600_000;
    let n = 0;
    for (const [id, t] of this.storage.allTombstones()) if (t.deletedAt < cutoff) { this.storage.deleteTombstone(id); n++; }
    return n;
  }

  get tombstoneCount(): number { return this.storage.tombstoneCount; }
  tombstonesList(): { id: string; fact: Fact; deletedAt: number }[] {
    return [...this.storage.allTombstones()].map(([id, t]) => ({ id, fact: t.fact, deletedAt: t.deletedAt }));
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
    for (const f of this.storage.allFacts()) {
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
    for (const f of this.storage.allFacts()) {
      if (!f.embedded) { (f as Fact & { embedded?: boolean }).embedded = true; this.storage.putFact(f); n++; }
    }
    return n;
  }

  /** Phase 10: count of embedded facts (for the embed dream-cycle phase). */
  get embeddedCount(): number {
    let n = 0;
    for (const f of this.storage.allFacts()) if ((f as Fact & { embedded?: boolean }).embedded) n++;
    return n;
  }
  get takeCount(): number {
    return this.storage.takeCount;
  }
  get factCount(): number {
    return this.storage.factCount;
  }

  /** Phase A: additive accessor for MemoryTree.compile() + domains. Returns a
   * shallow snapshot of takes (not the live Map — values are readonly references,
   * but DO NOT mutate them in place). */
  get takes(): Take[] {
    return [...this.storage.allTakes()];
  }

  /** Phase A: additive accessor for MemoryTree.compile() + domains. Returns a
   * shallow snapshot of pages. */
  get allPages(): BrainPage[] {
    return [...this.storage.allPages()];
  }

  // ── Phase 11: 5 more zero-LLM dream-cycle phases ────────────────────────

  /**
   * Dream cycle phase: lint — validate fact content. Flags empty content,
   * near-duplicates (exact-match), + facts with no entity. Returns a report.
   */
  lint(): { empty: string[]; duplicates: Array<{ ids: string[]; content: string }>; noEntity: string[] } {
    const empty: string[] = [];
    const noEntity: string[] = [];
    const byContent = new Map<string, string[]>();
    for (const f of this.storage.allFacts()) {
      if (!f.content.trim()) { empty.push(f.id); continue; } // M3: skip empty from dup map
      if (!f.entity) noEntity.push(f.id);
      // M2: fold entity into the duplicate key (same content, different entity ≠ dup).
      const key = `${f.entity.trim().toLowerCase()}\u0000${f.content.trim().toLowerCase()}`;
      const arr = byContent.get(key);
      if (arr) arr.push(f.id); else byContent.set(key, [f.id]);
    }
    const duplicates = [...byContent.values()].filter((ids) => ids.length > 1)
      .map((ids) => ({ ids, content: this.storage.getFact(ids[0]!)!.content }));
    return { empty, duplicates, noEntity };
  }

  /**
   * Dream cycle phase: orphans — find facts whose entity appears in NO backlink
   * edge (isolated — neither a source nor a target of any edge). Returns the
   * orphan fact ids.
   */
  orphans(): string[] {
    const edges = this.backlinks();
    // M4: restrict `connected` to entity names from edges (skip URL/slug `to`
    // targets — those live in a different namespace). Only `from` (always an
    // entity) + bare-name/wikilink `to` targets count.
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.from);
      if (e.kind === "bare" || e.kind === "wikilink") connected.add(e.to);
    }
    return [...this.storage.allFacts()]
      .filter((f) => !connected.has(f.entity))
      .map((f) => f.id);
  }

  /**
   * Dream cycle phase: schema-suggest — detect entities that are likely the
   * same (case-insensitive match or alias overlap) + propose a merge.
   * Returns merge proposals (zero-LLM; the operator confirms).
   */
  schemaSuggest(): Array<{ entities: string[]; reason: string }> {
    const proposals: Array<{ entities: string[]; reason: string }> = [];
    const entities = [...this.storage.allFacts()].map((f) => f.entity);
    const unique = [...new Set(entities)];
    // case-insensitive collision
    const byLower = new Map<string, string[]>();
    for (const e of unique) {
      const lc = e.toLowerCase();
      const arr = byLower.get(lc);
      if (arr) arr.push(e); else byLower.set(lc, [e]);
    }
    for (const [lc, group] of byLower) {
      if (group.length > 1) proposals.push({ entities: group, reason: `case-insensitive match: "${lc}"` });
    }
    return proposals;
  }

  /**
   * Dream cycle phase: resolve_symbol_edges — if a fact's content mentions
   * another entity by name (bare-name match against the known entity set),
   * emit a typed "bare" edge. This augments backlinks() with cross-entity
   * references that the regex extraction missed (e.g. the entity name wasn't
   * in the fact's own entityWords set).
   */
  resolveSymbolEdges(): Array<{ from: string; to: string; kind: "bare" }> {
    // C2: filter empty/falsy entities (an empty entity → /\b\b/ matches every
    // word boundary → spurious edges from every fact to "").
    const knownEntities = new Set(
      [...this.storage.allFacts()].map((f) => f.entity).filter((e) => e && e.trim()),
    );
    if (knownEntities.size === 0) return [];
    // H1: compile a single alternation regex ONCE (not N×M fresh compiles).
    const escaped = [...knownEntities].map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(`\\b(${escaped})\\b`, "gi"); // 'g' flag for matchAll
    // H2: dedup by (from|to).
    const seen = new Set<string>();
    const edges: Array<{ from: string; to: string; kind: "bare" }> = [];
    for (const f of this.storage.allFacts()) {
      if (!f.entity || !f.entity.trim()) continue;
      const found = new Set<string>();
      for (const m of f.content.matchAll(re)) {
        const target = m[1]!;
        if (target !== f.entity) found.add(target);
      }
      for (const to of found) {
        const key = `${f.entity}|${to}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ from: f.entity, to, kind: "bare" }); }
      }
    }
    return edges;
  }

  /**
   * Dream cycle phase: conversation_facts_backfill — scan a conversation (array
   * of {role, content}) for capitalized names that match known entities →
   * record new facts. This catches entity mentions the extractor missed.
   * Returns the count of new facts recorded.
   */
  conversationFactsBackfill(conversation: Array<{ role: string; content: string }>): number {
    // Phase 14c performance: precompute known-entities + backfilled-entities sets ONCE
    // (was O(N×M×K): hasBackfill() scanned all facts per name per message).
    const knownEntities = new Set<string>();
    const backfilledEntities = new Set<string>();
    for (const f of this.storage.allFacts()) {
      if (f.entity && f.entity.trim()) knownEntities.add(f.entity);
      if (f.source === "backfill") backfilledEntities.add(f.entity);
    }
    const recorded = new Set<string>();
    let n = 0;
    for (const msg of conversation) {
      if (msg.role === "tool" || msg.role === "system") continue;
      const names = msg.content.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
      for (const name of [...new Set(names)]) {
        if (!knownEntities.has(name) || recorded.has(name) || backfilledEntities.has(name)) continue;
        // C1: respect the fact cap — stop gracefully (not throw mid-loop).
        if (this.storage.factCount >= this.maxFactsTotal) return n;
        this.recordFact({
          kind: "event",
          entity: name,
          content: `${name} mentioned in conversation`,
          visibility: "private",
          notability: 1,
          source: "backfill",
        });
        recorded.add(name);
        backfilledEntities.add(name); // prevent re-backfill within this call too
        n++;
      }
    }
    return n;
  }
}

/** Bag-of-words vector (term → count). */
export function bow(text: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of text.toLowerCase().split(/\W+/)) {
    if (t.length < 2) continue;
    v.set(t, (v.get(t) ?? 0) + 1);
  }
  return v;
}

/** Cosine similarity of two bag-of-words vectors. */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
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
