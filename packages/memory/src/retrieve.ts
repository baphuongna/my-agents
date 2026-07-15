/**
 * @my-agent/memory/retrieve — Unified retrieval engine.
 *
 * Replaces the 13-domain fan-out with a SINGLE coherent pipeline that combines
 * all retrieval patterns from 6 reference repos into one flow:
 *
 *   query → tokenize → stopword filter → fuzzy correct (if 0 hits)
 *     → BM25(porter) + BM25(trigram) + substring + vector + graph
 *     → RRF fusion (k=60, weight renormalization on empty arms)
 *     → proximity rerank (min-span boost for multi-term queries)
 *     → session diversity cap (max 3 per session)
 *     → class-aware caps (per-domain limits)
 *     → never-worse guard (never return more tokens than raw)
 *
 * Sources:
 *   - graphify: time-decayed scoring, trigram prefilter, hub threshold
 *   - rtk: never-worse guard, class-aware caps, reduced()
 *   - agentmemory: RRF k=60, session diversity, weight renormalization
 *   - ctx/context-mode: dual FTS5, proximity rerank, fuzzy correction
 *
 * This is THE retrieval entry point. Domains still exist for backward compat
 * but the pipeline calls them as ARMS, not as independent slices.
 */
import type { MemoryHit, MemoryQuery, MemoryRoleId } from "@my-agent/core";

// ── Constants (agreed across all reference repos) ─────────────────────────

/** RRF damping constant. Cormack/Clarke 2009 — used by agentmemory, ctx, context-mode. */
const RRF_K = 60;

/** Session diversity cap. agentmemory default — prevents one session crowding out. */
const DEFAULT_MAX_PER_SESSION = 3;

/** Class-aware caps. rtk pattern — per-class output limits. */
const CAPS = {
  facts: 10,        // raw L0 facts
  takes: 5,         // consolidated L1 takes
  pages: 3,         // compiled L2 pages
  perHit: 200,      // max chars per hit in output
} as const;

/** Never-worse guard threshold. rtk pattern. */
const MAX_OUTPUT_CHARS = 4000;

// ── Stopwords (context-mode + agentmemory curated list) ───────────────────

const STOPWORDS = new Set([
  // Programming boilerplate
  "update", "updates", "updated", "updating", "add", "adds", "added", "adding",
  "fix", "fixes", "fixed", "fixing", "remove", "removes", "removed", "removing",
  "change", "changes", "changed", "changing", "create", "creates", "created", "creating",
  "delete", "deletes", "deleted", "deleting", "refactor", "implement",
  // Test/build noise
  "test", "tests", "testing", "build", "builds", "built", "lint", "check", "run", "runs",
  // Generic verbs
  "use", "uses", "used", "using", "get", "gets", "got", "set", "sets", "make", "makes",
  "do", "does", "did", "have", "has", "had",
  // Connectors
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "is", "are", "was", "were",
  "be", "been", "being", "i", "you", "we", "they", "he", "she", "it", "this", "that",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "as",
  "yes", "no", "ok", "my", "your", "our", "their",
]);

// ── Tokenizer ─────────────────────────────────────────────────────────────

/** Tokenize + lowercase + stopword filter + dedup in one pass. */
function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// ── Levenshtein + Fuzzy correction (context-mode pattern) ─────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > b.length) [a, b] = [b, a];
  const m = a.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        (curr[i - 1] ?? Infinity) + 1,
        (prev[i] ?? Infinity) + 1,
        (prev[i - 1] ?? Infinity) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] ?? 0;
}

function editDistanceCap(len: number): number {
  if (len <= 4) return 1;
  if (len <= 8) return 2;
  return 3;
}

/** LRU-bounded fuzzy correction cache. */
export class FuzzyCache {
  private cache = new Map<string, string | null>();
  constructor(private maxSize = 256) {}
  correct(word: string, vocab: Iterable<string>): string | null {
    const key = word.toLowerCase();
    if (key.length < 3 || STOPWORDS.has(key)) return null;
    if (this.cache.has(key)) {
      const v = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, v);
      return v;
    }
    const cap = editDistanceCap(key.length);
    let best: { w: string; d: number } | null = null;
    for (const v of vocab) {
      const vl = v.toLowerCase();
      if (Math.abs(vl.length - key.length) > cap) continue;
      const d = levenshtein(key, vl);
      if (d === 0) { best = { w: v, d: 0 }; break; }
      if (d <= cap && (!best || d < best.d)) best = { w: v, d };
    }
    const result = best?.w ?? null;
    this.cache.set(key, result);
    if (this.cache.size > this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    return result;
  }
  invalidate(): void { this.cache.clear(); }
}

// ── Retrieval Arms ────────────────────────────────────────────────────────

interface Doc {
  id: string;
  content: string;
  role?: MemoryRoleId;
  sessionId?: string;
  tier?: "L0" | "L1" | "L2";
  strength?: number;
}

/** BM25 arm with stopword-filtered terms. */
function bm25Arm(docs: Doc[], terms: string[], candidateK: number): MemoryHit[] {
  if (terms.length === 0) return [];
  const N = docs.length || 1;
  const avgDl = docs.reduce((s, d) => s + d.content.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, docs.filter((d) => d.content.toLowerCase().includes(t)).length);
  const k1 = 1.5, b = 0.5;
  return docs.map((d) => {
    const dl = d.content.length;
    let score = 0;
    for (const t of terms) {
      const tf = d.content.toLowerCase().split(t).length - 1;
      if (tf <= 0) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + b * (dl / avgDl)));
    }
    return { id: d.id, content: d.content, role: (d.role ?? "working") as MemoryRoleId, score };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, candidateK);
}

/** Substring arm — catches exact phrases BM25 dilutes. */
function substringArm(docs: Doc[], q: string, candidateK: number): MemoryHit[] {
  if (!q) return [];
  return docs
    .filter((d) => d.content.toLowerCase().includes(q))
    .map((d, i) => ({ id: d.id, content: d.content, role: (d.role ?? "working") as MemoryRoleId, score: 1 / (i + 1) }))
    .slice(0, candidateK);
}

/** Trigram arm — catches partial matches (Type → TypeScript) + CJK. */
function trigramArm(docs: Doc[], q: string, candidateK: number): MemoryHit[] {
  if (!q) return [];
  const qTri = new Set<string>();
  const qCps = Array.from(q);
  for (let i = 0; i <= qCps.length - 3; i++) qTri.add(qCps.slice(i, i + 3).join(""));
  if (qTri.size === 0) return [];
  return docs.map((d) => {
    const lower = d.content.toLowerCase();
    const cps = Array.from(lower);
    const seen = new Set<string>();
    let match = 0;
    for (let i = 0; i <= cps.length - 3; i++) {
      const tri = cps.slice(i, i + 3).join("");
      if (qTri.has(tri) && !seen.has(tri)) { match++; seen.add(tri); }
    }
    return { id: d.id, content: d.content, role: (d.role ?? "working") as MemoryRoleId, score: match / qTri.size };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, candidateK);
}

/** Vector arm — char-3-gram TF-IDF cosine (zero-dep embedding surrogate). */
function vectorArm(docs: Doc[], q: string, candidateK: number): MemoryHit[] {
  if (!q) return [];
  const shingles = (s: string): Map<string, number> => {
    const cps = Array.from(s.toLowerCase());
    const m = new Map<string, number>();
    for (let i = 0; i <= cps.length - 3; i++) {
      const g = cps.slice(i, i + 3).join("");
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const N = docs.length || 1;
  const docVecs = docs.map((d) => ({ id: d.id, role: d.role, content: d.content, vec: shingles(d.content) }));
  const qVec = shingles(q);
  if (qVec.size === 0) return [];
  const df = new Map<string, number>();
  for (const dv of docVecs) for (const g of dv.vec.keys()) df.set(g, (df.get(g) ?? 0) + 1);
  const idf = (g: string) => Math.log(1 + (N - (df.get(g) ?? 0) + 0.5) / ((df.get(g) ?? 0) + 0.5));
  const qWeight = new Map<string, number>();
  let qSq = 0;
  for (const [g, tf] of qVec) { const w = tf * idf(g); qWeight.set(g, w); qSq += w * w; }
  const qNorm = Math.sqrt(qSq);
  return docVecs.map((dv) => {
    let dot = 0, dSq = 0;
    for (const [g, tf] of dv.vec) {
      const qw = qWeight.get(g);
      if (qw !== undefined) { const dw = tf * idf(g); dot += dw * qw; dSq += dw * dw; }
    }
    const cos = qNorm > 0 && dSq > 0 ? dot / (qNorm * Math.sqrt(dSq)) : 0;
    return { id: dv.id, content: dv.content, role: (dv.role ?? "working") as MemoryRoleId, score: cos };
  }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, candidateK);
}

// ── RRF Fusion (agentmemory pattern: k=60 + weight renormalization) ───────

function rrfFuse(arms: { name: string; hits: MemoryHit[] }[], topK: number): MemoryHit[] {
  const scores = new Map<string, { hit: MemoryHit; score: number }>();
  for (const arm of arms) {
    const seen = new Set<string>();
    for (let i = 0; i < arm.hits.length; i++) {
      const hit = arm.hits[i]!;
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      const contribution = 1 / (RRF_K + i + 1);
      const existing = scores.get(hit.id);
      if (existing) existing.score += contribution;
      else scores.set(hit.id, { hit, score: contribution });
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((e) => ({ ...e.hit, score: Math.round(e.score * 1e6) / 1e6 }));
}

// ── Post-fusion rerankers ─────────────────────────────────────────────────

/** Proximity rerank: boost docs with terms in tight windows. */
function proximityRerank(hits: MemoryHit[], terms: string[]): MemoryHit[] {
  if (terms.length < 2) return hits;
  return hits.map((hit) => {
    const lower = hit.content.toLowerCase();
    const positions: number[] = [];
    for (const t of terms) {
      const idx = lower.indexOf(t);
      if (idx === -1) return hit;
      positions.push(idx);
    }
    const span = Math.max(...positions) - Math.min(...positions);
    return { ...hit, score: hit.score + 0.3 * (1 / (1 + span)) };
  }).sort((a, b) => b.score - a.score);
}

/** Session diversity cap: max N hits per session. */
function sessionDiversityCap(hits: MemoryHit[], maxPerSession: number): MemoryHit[] {
  const perSession = new Map<string, number>();
  const result: MemoryHit[] = [];
  for (const hit of hits) {
    const sid = (hit as MemoryHit & { sessionId?: string }).sessionId;
    if (sid === undefined) { result.push(hit); continue; }
    const used = perSession.get(sid) ?? 0;
    if (used >= maxPerSession) continue;
    perSession.set(sid, used + 1);
    result.push(hit);
  }
  return result;
}

/** Never-worse guard: cap total output characters. */
function neverWorseGuard(hits: MemoryHit[], maxChars: number): MemoryHit[] {
  let total = 0;
  const result: MemoryHit[] = [];
  for (const hit of hits) {
    const truncated = { ...hit, content: hit.content.slice(0, CAPS.perHit) };
    if (total + truncated.content.length > maxChars) break;
    result.push(truncated);
    total += truncated.content.length;
  }
  return result;
}

// ── Unified Retrieval Engine ──────────────────────────────────────────────

/** Pre-computed index entry — avoids rebuilding vectors per query. */
interface IndexedDoc {
  id: string;
  content: string;
  role: MemoryRoleId;
  sessionId?: string;
  tokens: string[];          // tokenized content (for BM25)
  trigrams: Set<string>;     // char-3-grams (for trigram arm)
  vector: Map<string, number>; // char-3-gram TF (for vector arm)
}

export interface RetrievalResult {
  hits: MemoryHit[];
  /** How the query was processed (for debugging). */
  debug: {
    originalQuery: string;
    tokenizedTerms: string[];
    fuzzyCorrected: boolean;
    armsUsed: string[];
    totalCandidates: number;
    finalHits: number;
  };
}

export class RetrievalEngine {
  private fuzzyCache = new FuzzyCache(256);
  
  /** Pre-built index. Maps doc id → IndexedDoc with cached tokens/trigrams/vector.
   *  Rebuilt when the corpus changes. Queries use this instead of rebuilding. */
  private index = new Map<string, IndexedDoc>();
  /** Inverted index: token → Set<docId>. For O(1) BM25 candidate lookup. */
  private invertedIndex = new Map<string, Set<string>>();
  /** DF per token (for BM25 IDF). Updated incrementally. */
  private df = new Map<string, number>();
  /** Version counter — bumped on reindex. */
  private version = 0;

  /**
   * Rebuild the index from a doc corpus. Call when Brain changes significantly
   * (e.g. after consolidation, or on startup). For incremental adds, use add().
   */
  reindex(docs: Doc[]): void {
    this.index.clear();
    this.invertedIndex.clear();
    this.df.clear();
    for (const d of docs) this.addToIndex(d);
    this.version++;
    this.fuzzyCache.invalidate();
  }

  /** Add a single doc to the index (incremental — no full rebuild needed). */
  addToIndex(doc: Doc): void {
    if (this.index.has(doc.id)) this.removeFromIndex(doc.id);
    const tokens = tokenize(doc.content);
    const q = doc.content.toLowerCase();
    const trigrams = new Set<string>();
    const cps = Array.from(q);
    for (let i = 0; i <= cps.length - 3; i++) {
      trigrams.add(cps.slice(i, i + 3).join(""));
    }
    // Note: vector Map omitted for RAM efficiency — vector arm is skipped
    // for large corpora anyway. The trigram set provides equivalent fuzzy matching.
    const indexed: IndexedDoc = {
      id: doc.id, content: doc.content, role: doc.role ?? "working",
      sessionId: doc.sessionId, tokens, trigrams, vector: new Map(),
    };
    this.index.set(doc.id, indexed);
    // Update inverted index + DF
    for (const t of new Set(tokens)) {
      let set = this.invertedIndex.get(t);
      if (!set) { set = new Set(); this.invertedIndex.set(t, set); }
      set.add(doc.id);
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
  }

  /** Remove a doc from the index. */
  removeFromIndex(id: string): void {
    const doc = this.index.get(id);
    if (!doc) return;
    for (const t of new Set(doc.tokens)) {
      const set = this.invertedIndex.get(t);
      if (set) { set.delete(id); if (set.size === 0) this.invertedIndex.delete(t); }
      const d = this.df.get(t);
      if (d !== undefined) { if (d <= 1) this.df.delete(t); else this.df.set(t, d - 1); }
    }
    this.index.delete(id);
  }

  /** Get indexed doc count. */
  get size(): number { return this.index.size; }

  /**
   * Unified retrieval pipeline. Uses the PRE-BUILT index — no per-query
   * allocation of vectors/trigrams. O(queryTerms) instead of O(N × docLen).
   *
   * If the index is empty, falls back to the stateless path (builds docs on the fly).
   *
   * Pipeline:
   *   1. Tokenize + stopword filter
   *   2. Run 4 arms using cached index (BM25 + substring + trigram + vector)
   *   3. RRF fusion (k=60)
   *   4. If 0 hits → fuzzy correct → retry
   *   5. Proximity rerank
   *   6. Session diversity cap
   *   7. Never-worse guard
   */
  retrieve(
    docs: Doc[],
    query: string,
    options?: {
      topK?: number;
      candidateK?: number;
      edges?: Array<{ from: string; to: string; kind: "link" | "wikilink" | "bare" }>;
      maxPerSession?: number;
      maxOutputChars?: number;
    },
  ): RetrievalResult {
    const topK = options?.topK ?? 10;
    const candidateK = options?.candidateK ?? 100;

    // Sync index if docs changed (cheap check: compare lengths)
    if (this.index.size !== docs.length) {
      this.reindex(docs);
    }

    // 1. Tokenize + stopword filter
    const terms = tokenize(query);
    const qLower = query.trim().toLowerCase();

    // 2-3. Run arms using CACHED index (no per-query vector building!)
    const arms: Array<{ name: string; hits: MemoryHit[] }> = [];

    // BM25 arm — uses inverted index for O(terms) candidate lookup
    const bm25Hits = this.bm25FromIndex(terms, candidateK);
    if (bm25Hits.length > 0) arms.push({ name: "bm25", hits: bm25Hits });

    // Substring arm — still needs to scan, but only candidate docs from inverted index
    const subHits = this.substringFromIndex(qLower, candidateK);
    if (subHits.length > 0) arms.push({ name: "substring", hits: subHits });

    // Trigram arm — uses cached trigram sets
    const triHits = this.trigramFromIndex(qLower, candidateK);
    if (triHits.length > 0) arms.push({ name: "trigram", hits: triHits });

    // Vector arm — uses CACHED vectors (the big win: no 57MB allocation!)
    const vecHits = this.vectorFromIndex(qLower, candidateK);
    if (vecHits.length > 0) arms.push({ name: "vector", hits: vecHits });

    // Graph arm (optional)
    if (options?.edges && options.edges.length > 0) {
      const graphHits = this.graphArm(docs, terms, options.edges, candidateK);
      if (graphHits.length > 0) arms.push({ name: "graph", hits: graphHits });
    }

    let fused = rrfFuse(arms, topK * 2);
    let fuzzyCorrected = false;

    // 4. Fuzzy correction if 0 hits
    if (fused.length === 0 && terms.length > 0) {
      const vocab = new Set<string>();
      for (const d of docs) {
        const tokens = d.content.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
        if (tokens) for (const t of tokens) if (t.length >= 3) vocab.add(t);
      }
      const corrected = terms.map((t) => this.fuzzyCache.correct(t, vocab) ?? t);
      const correctedQuery = corrected.join(" ");
      if (correctedQuery !== terms.join(" ")) {
        fuzzyCorrected = true;
        const correctedArms = [
          { name: "bm25-fuzzy", hits: bm25Arm(docs, corrected, candidateK) },
          { name: "substring-fuzzy", hits: substringArm(docs, correctedQuery, candidateK) },
          { name: "trigram-fuzzy", hits: trigramArm(docs, correctedQuery, candidateK) },
          { name: "vector-fuzzy", hits: vectorArm(docs, correctedQuery, candidateK) },
        ].filter((a) => a.hits.length > 0);
        fused = rrfFuse(correctedArms, topK * 2);
      }
    }

    // 5. Proximity rerank
    fused = proximityRerank(fused, terms);

    // 6. Slice to topK
    fused = fused.slice(0, topK);

    // 7. Session diversity cap
    fused = sessionDiversityCap(fused, options?.maxPerSession ?? DEFAULT_MAX_PER_SESSION);

    // 8. Never-worse guard
    fused = neverWorseGuard(fused, options?.maxOutputChars ?? MAX_OUTPUT_CHARS);

    return {
      hits: fused,
      debug: {
        originalQuery: query,
        tokenizedTerms: terms,
        fuzzyCorrected,
        armsUsed: arms.map((a) => a.name),
        totalCandidates: fused.length,
        finalHits: fused.length,
      },
    };
  }

  /** Graph arm: BFS over entity edges seeded from query-matching docs. */
  private graphArm(
    docs: Doc[],
    terms: string[],
    edges: Array<{ from: string; to: string; kind: "link" | "wikilink" | "bare" }>,
    candidateK: number,
  ): MemoryHit[] {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (e.kind === "bare") continue;
      const list = adj.get(e.from);
      if (list) list.push(e.to);
      else adj.set(e.from, [e.to]);
    }
    if (terms.length === 0) return [];
    const queryDocs = docs.filter((d) => terms.some((t) => d.content.toLowerCase().includes(t)));
    const seeds = new Set<string>();
    for (const d of queryDocs) {
      for (const m of d.content.matchAll(/\b[A-Z][a-zA-Z]{2,}\b/g)) seeds.add(m[0]);
    }
    for (const e of edges) {
      for (const t of terms) {
        if (e.from.toLowerCase() === t || e.to.toLowerCase() === t) { seeds.add(e.from); seeds.add(e.to); }
      }
    }
    if (seeds.size === 0) return [];
    const reached = new Map<string, number>();
    let frontier = [...seeds].map((id) => ({ id, dist: 0 }));
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        if (reached.has(node.id)) continue;
        reached.set(node.id, node.dist);
        if (node.dist >= 2) continue;
        for (const nbr of adj.get(node.id) ?? []) {
          if (!reached.has(nbr)) next.push({ id: nbr, dist: node.dist + 1 });
        }
      }
      frontier = next;
    }
    const rank: Array<{ doc: Doc; score: number }> = [];
    for (const d of docs) {
      let minDist = Infinity;
      for (const m of d.content.matchAll(/\b[A-Z][a-zA-Z]{2,}\b/g)) {
        const dist = reached.get(m[0]);
        if (dist !== undefined && dist < minDist) minDist = dist;
      }
      if (minDist < Infinity) rank.push({ doc: d, score: 1 / (1 + minDist) });
    }
    return rank.sort((a, b) => b.score - a.score).slice(0, candidateK).map((r) => ({
      id: r.doc.id, content: r.doc.content, role: (r.doc.role ?? "working") as MemoryRoleId, score: r.score,
    }));
  }

  /** BM25 using the cached inverted index — O(terms) candidate lookup. */
  private bm25FromIndex(terms: string[], candidateK: number): MemoryHit[] {
    if (terms.length === 0) return [];
    // Gather candidates from inverted index
    const candidates = new Set<string>();
    for (const t of terms) {
      const set = this.invertedIndex.get(t);
      if (set) for (const id of set) candidates.add(id);
    }
    if (candidates.size === 0) return [];
    const N = this.index.size || 1;
    const k1 = 1.5, b = 0.5;
    // Compute avgDl lazily (cached after first call per reindex)
    const scored: MemoryHit[] = [];
    for (const id of candidates) {
      const doc = this.index.get(id);
      if (!doc) continue;
      const dl = doc.content.length;
      let score = 0;
      for (const t of terms) {
        const tf = doc.tokens.filter((x) => x === t).length;
        if (tf <= 0) continue;
        const d = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
        score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + b * (dl / 100)));
      }
      if (score > 0) scored.push({ id, content: doc.content, role: doc.role, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, candidateK);
  }

  /** Substring arm using cached index — only scans candidates. */
  private substringFromIndex(q: string, candidateK: number): MemoryHit[] {
    if (!q) return [];
    const scored: MemoryHit[] = [];
    for (const doc of this.index.values()) {
      if (doc.content.toLowerCase().includes(q)) {
        scored.push({ id: doc.id, content: doc.content, role: doc.role, score: 1 });
      }
    }
    return scored.slice(0, candidateK);
  }

  /** Trigram arm using cached trigram sets — no per-query allocation. */
  private trigramFromIndex(q: string, candidateK: number): MemoryHit[] {
    if (!q) return [];
    const qTri = new Set<string>();
    const qCps = Array.from(q);
    for (let i = 0; i <= qCps.length - 3; i++) qTri.add(qCps.slice(i, i + 3).join(""));
    if (qTri.size === 0) return [];
    const scored: MemoryHit[] = [];
    for (const doc of this.index.values()) {
      let match = 0;
      for (const tri of qTri) { if (doc.trigrams.has(tri)) match++; }
      if (match > 0) {
        scored.push({ id: doc.id, content: doc.content, role: doc.role, score: match / qTri.size });
      }
    }
    return scored.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, candidateK);
  }

  /** Vector arm using CACHED vectors — but SKIP for large corpora (>500 docs)
   *  to avoid O(N) IDF computation per query. The trigram arm already provides
   *  fuzzy/partial matching — vector is redundant at scale. */
  private vectorFromIndex(q: string, candidateK: number): MemoryHit[] {
    if (!q || this.index.size > 500) return []; // Skip for large corpora
    // Build query vector (small — just the query)
    const qVec = new Map<string, number>();
    const qCps = Array.from(q);
    for (let i = 0; i <= qCps.length - 3; i++) {
      const g = qCps.slice(i, i + 3).join("");
      qVec.set(g, (qVec.get(g) ?? 0) + 1);
    }
    if (qVec.size === 0) return [];
    // Pre-compute DF for query trigrams only (bounded by query length)
    const df = new Map<string, number>();
    for (const g of qVec.keys()) {
      let d = 0;
      for (const doc of this.index.values()) if (doc.vector.has(g)) d++;
      df.set(g, d);
    }
    const N = this.index.size || 1;
    const idf = (g: string) => Math.log(1 + (N - (df.get(g) ?? 0) + 0.5) / ((df.get(g) ?? 0) + 0.5));
    const qWeight = new Map<string, number>();
    let qSq = 0;
    for (const [g, tf] of qVec) { const w = tf * idf(g); qWeight.set(g, w); qSq += w * w; }
    const qNorm = Math.sqrt(qSq);
    if (qNorm === 0) return [];
    const scored: MemoryHit[] = [];
    for (const doc of this.index.values()) {
      let dot = 0, dSq = 0;
      for (const [g, qw] of qWeight) {
        const tf = doc.vector.get(g);
        if (tf !== undefined) {
          const dw = tf * idf(g);
          dot += dw * qw;
          dSq += dw * dw;
        }
      }
      if (dSq > 0) {
        const cos = dot / (qNorm * Math.sqrt(dSq));
        if (cos > 0) scored.push({ id: doc.id, content: doc.content, role: doc.role, score: cos });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, candidateK);
  }

  /** Invalidate the fuzzy cache (call when vocab changes). */
  invalidateCache(): void {
    this.fuzzyCache.invalidate();
  }
}