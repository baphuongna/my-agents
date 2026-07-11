/**
 * 4-arm retrieval via Reciprocal-Rank-Fusion (§8 R35). Fuses multiple ranked
 * lists (BM25 keyword, substring, fuzzy, relational/graph) into one ranking
 * using RRF (k=60): score(d) = Σ 1 / (k + rank_arm(d)). The highest-quality
 * signal we have without a vector index; a vector arm drops in when one exists.
 *
 * Source: §8 4-arm RRF; gbrain search/hybrid.ts.
 */
import type { MemoryHit, MemoryQuery, MemoryRoleId } from "@my-agent/core";

const RRF_K = 60;

/** One ranked list (an arm). Ranks are 1-indexed within each arm. */
export interface RetrievalArm {
  name: string;
  hits: MemoryHit[];
}

/** Fuse multiple ranked arms via Reciprocal-Rank-Fusion (k=60).
 * Review-driven: dedup hits within a single arm so the same doc id gets at
 * most one contribution per arm (LOW-7). */
export function reciprocalRankFuse(arms: RetrievalArm[], topK = 10): MemoryHit[] {
  const scores = new Map<string, { hit: MemoryHit; score: number }>();
  for (const arm of arms) {
    const seenInArm = new Set<string>();
    arm.hits.forEach((hit, i) => {
      if (seenInArm.has(hit.id)) return; // dedup within this arm
      seenInArm.add(hit.id);
      const rank = i + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = scores.get(hit.id);
      if (existing) existing.score += contribution;
      else scores.set(hit.id, { hit, score: contribution });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, topK).map((e) => ({
    ...e.hit,
    score: Math.round(e.score * 1e6) / 1e6,
  }));
}

// ── Arm implementations (zero-dep; a vector arm drops in when available) ─────

/** BM25-ish keyword arm: rank by term-frequency saturation over the query terms. */
export function bm25Arm(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, candidateK = 100): MemoryHit[] {
  // Review HIGH-1 / MED-5: defend against undefined/null query.text + trim.
  const q = (query.text ?? "").trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const N = docs.length || 1;
  const avgDl = docs.reduce((s, d) => s + d.content.length, 0) / N || 1;
  // document frequency per term
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, docs.filter((d) => d.content.toLowerCase().includes(t)).length);
  const k1 = 1.5, b = 0.5;
  const scored = docs.map((d) => {
    const dl = d.content.length;
    const tfNorm = (term: string) => {
      const tf = d.content.toLowerCase().split(term).length - 1;
      if (tf <= 0) return 0;
      const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      return idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
    };
    const score = terms.reduce((s, t) => s + tfNorm(t), 0);
    return { id: d.id, content: d.content, role: (d.role ?? "working") as MemoryRoleId, score } as MemoryHit;
  });
  const ranked = scored.filter((h) => h.score > 0).sort((a, b) => b.score - a.score);
  return ranked.slice(0, candidateK);
}

/** Substring arm (case-insensitive containment) — a weak signal that catches exact phrases BM25 might dilute. */
export function substringArm(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, candidateK = 100): MemoryHit[] {
  // MED-5 (review): whitespace-only queries → [].
  const q = (query.text ?? "").trim().toLowerCase();
  if (!q) return [];
  return docs
    .filter((d) => d.content.toLowerCase().includes(q))
    .map((d, i) => ({ id: d.id, content: d.content, role: (d.role ?? "working") as MemoryRoleId, score: 1 / (i + 1) } as MemoryHit))
    .slice(0, candidateK);
}

/**
 * Vector arm (Phase 8, zero-dep surrogate for an HNSW/embedding arm). Builds a
 * char-n-gram TF-IDF vector for the query and each doc, ranks by cosine similarity.
 * This is a SURROGATE for a real embedding model — it gives vector-like behaviour
 * (handles partial/typo overlap, character-level semantic sharing) without any
 * external dependency. A real HNSW arm drops in by passing a different RetrievalArm.
 *
 * Review fixes:
 *   HIGH-2: code-point iteration (Array.from) avoids splitting UTF-16 surrogate
 *     pairs (emoji + CJK ext-B+ now work).
 *   MEDIUM-1/2: dropped the leading/trailing-2 padding trigrams that produced a
 *     spurious near-perfect cosine for very short queries/docs.
 *   MEDIUM-4: sparse intersection (only iterate the doc's grams present in qVec)
 *     for the dot product — drops cost from O(N×G) to O(matched).
 */
export function vectorArm(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, candidateK = 100): MemoryHit[] {
  // MED-5 (review): trim + empty → []
  const q = (query.text ?? "").trim().toLowerCase();
  if (!q) return [];
  const N = docs.length || 1;
  // Tokenize into code points (review HIGH-2) → shingle as 3-grams.
  const shingles = (s: string): string[] => {
    const cps = Array.from(s.toLowerCase());
    if (cps.length < 3) return [];
    const out: string[] = [];
    for (let i = 0; i <= cps.length - 3; i++) out.push(cps.slice(i, i + 3).join(""));
    return out;
  };
  const docVecs = docs.map((d) => ({ id: d.id, role: d.role, content: d.content, terms: shingles(d.content) }))
    // compute term-frequency map
    .map((dv) => {
      const m = new Map<string, number>();
      for (const g of dv.terms) m.set(g, (m.get(g) ?? 0) + 1);
      return { id: dv.id, role: dv.role, content: dv.content, vec: m };
    });
  const qTokens = shingles(q);
  if (qTokens.length === 0) return [];
  // document frequency per char-n-gram (only counting grams the query cares about — sparse)
  const df = new Map<string, number>();
  for (const dv of docVecs) for (const g of dv.vec.keys()) df.set(g, (df.get(g) ?? 0) + 1);
  const idf = (g: string) => Math.log(1 + (N - (df.get(g) ?? 0) + 0.5) / ((df.get(g) ?? 0) + 0.5));
  const qWeight = new Map<string, number>();
  for (const t of qTokens) {
    const tf = (() => { let n = 0; for (const s of qTokens) if (s === t) n++; return n; })();
    qWeight.set(t, tf * idf(t));
  }
  let qSq = 0;
  for (const w of qWeight.values()) qSq += w * w;
  const qNorm = Math.sqrt(qSq);
  // MEDIUM-4 sparse intersection: only iterate grams present in BOTH sides.
  const scored: MemoryHit[] = [];
  for (const dv of docVecs) {
    let dot = 0, dSq = 0;
    for (const [g, tf] of dv.vec) {
      const qw = qWeight.get(g);
      if (qw !== undefined) {
        const dw = tf * idf(g);
        dot += dw * qw;
        dSq += dw * dw;
      }
    }
    const dNorm = Math.sqrt(dSq);
    const cos = (qNorm > 0 && dNorm > 0) ? dot / (qNorm * dNorm) : 0;
    if (cos > 0) scored.push({ id: dv.id, content: dv.content, role: (dv.role ?? "working") as MemoryRoleId, score: cos });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, candidateK);
}

/**
 * Typed-graph arm (Phase 9 — the 4th arm of the §8 R35 4-arm RRF spec).
 *
 * Walks a typed edge graph seeded from `docs` (the graph is the zero-LLM
 * backlinks + an operator-declared KG). Rank by hop-distance from entities
 * matching the query: distance 0 = query itself; distance 1 = direct neighbor;
 * score = 1 / (1 + dist). Entities not reachable within `maxDepth` hops are
 * absent from the hits.
 */
export function graphArm(
  edges: { from: string; fromFactId?: string; to: string; kind: "link" | "wikilink" | "bare" }[],
  docs: { id: string; content: string; role?: MemoryRoleId }[],
  query: MemoryQuery,
  candidateK = 50,
  maxDepth = 2,
): MemoryHit[] {
  // CRITICAL-1 (review): build ENTITY→ENTITY adjacency (key by e.from = the
  // fact's entity, not the fact id). The old code keyed by fromFactId (a UUID)
  // while traversal targets were entity names → disjoint namespaces → the walk
  // dead-ended at 1 hop. Now from/to are both entity slugs.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    // typed walk: only "wikilink" + "link" edges form the graph; "bare" edges
    // are ambiguous (would inflate the walk with substring coincidences).
    if (e.kind === "bare") continue;
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const q = (query.text ?? "").trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  // Seeds = entities (capitalized tokens) mentioned in docs whose content
  // matches the query. We extract capitalized words (the entity form) from
  // query-matching docs, then walk the entity graph from them.
  const queryDocs = docs.filter((d) => terms.some((t) => d.content.toLowerCase().includes(t)));
  const seeds = new Set<string>();
  for (const d of queryDocs) {
    for (const m of d.content.matchAll(/\b[A-Z][a-zA-Z]{2,}\b/g)) seeds.add(m[0]);
  }
  // also seed from any entity that IS a query term (e.g. query "Alice" seeds "Alice")
  for (const e of edges) for (const t of terms) if (e.from.toLowerCase() === t || e.to.toLowerCase() === t) { seeds.add(e.from); seeds.add(e.to); }
  if (seeds.size === 0) return [];
  // BFS hop-distance over the entity graph.
  const reached = new Map<string, number>(); // entity → min hop-distance
  let frontier: { id: string; dist: number }[] = [...seeds].map((id) => ({ id, dist: 0 }));
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      if (reached.has(node.id)) continue;
      reached.set(node.id, node.dist);
      if (node.dist >= maxDepth) continue;
      for (const nbr of adj.get(node.id) ?? []) {
        if (!reached.has(nbr)) next.push({ id: nbr, dist: node.dist + 1 });
      }
    }
    frontier = next;
  }
  // Map reached entities back to docs: a doc ranks by the MIN hop-distance of
  // any entity it mentions. (A doc mentioning a dist-0 seed entity scores 1;
  // a doc mentioning only a dist-2 neighbor scores 1/3.)
  const rank: Array<{ doc: { id: string; content: string; role?: MemoryRoleId }; score: number }> = [];
  for (const d of docs) {
    let minDist = Infinity;
    for (const m of d.content.matchAll(/\b[A-Z][a-zA-Z]{2,}\b/g)) {
      const dist = reached.get(m[0]);
      if (dist !== undefined && dist < minDist) minDist = dist;
    }
    if (minDist < Infinity) rank.push({ doc: d, score: 1 / (1 + minDist) });
  }
  return rank
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateK)
    .map((r) => ({
      id: r.doc.id,
      content: r.doc.content,
      role: (r.doc.role ?? "working") as MemoryRoleId,
      score: r.score,
    }));
}

/**
 * Fuse the BM25 + substring + vector + graph arms (all four spec-required arms).
 * Respects `query.topK` (MED-3 review). Uses a generous candidate window so a
 * doc ranked #51 in two arms can still outrank a rank-1 single-arm doc.
 */
export function rrfRetrieve(
  docs: { id: string; content: string; role?: MemoryRoleId }[],
  query: MemoryQuery,
  edges?: { from: string; fromFactId?: string; to: string; kind: "link" | "wikilink" | "bare" }[],
  topK?: number,
  candidateK = 100,
): MemoryHit[] {
  const outerTopK = topK ?? query.topK ?? 10;
  return reciprocalRankFuse([
    { name: "bm25", hits: bm25Arm(docs, query, candidateK) },
    { name: "substring", hits: substringArm(docs, query, candidateK) },
    { name: "vector", hits: vectorArm(docs, query, candidateK) },
    { name: "graph", hits: edges ? graphArm(edges, docs, query, candidateK) : [] },
  ], outerTopK);
}
