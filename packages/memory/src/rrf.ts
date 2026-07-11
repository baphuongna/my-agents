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
  // MED-5 (review): trim and drop empty-only queries.
  const terms = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
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
 */
export function vectorArm(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, topK = 20): MemoryHit[] {
  // MED-5 (review): trim + empty → []
  const q = (query.text ?? "").trim().toLowerCase();
  if (!q) return [];
  const N = docs.length || 1;
  const grams = (s: string) => {
    // 3-gram char shingles over the lowercased content.
    const pad = `  ${s}  `;
    const out = new Map<string, number>();
    for (let i = 0; i < pad.length - 2; i++) {
      const g = pad.slice(i, i + 3);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const docVecs = docs.map((d) => ({ id: d.id, role: d.role, content: d.content, vec: grams(d.content.toLowerCase()) }));
  const qVec = grams(q);
  // document frequency per char-n-gram
  const df = new Map<string, number>();
  for (const dv of docVecs) for (const g of dv.vec.keys()) df.set(g, (df.get(g) ?? 0) + 1);
  const idf = (g: string) => Math.log(1 + (N - (df.get(g) ?? 0) + 0.5) / ((df.get(g) ?? 0) + 0.5));
  const qWeight = new Map<string, number>();
  for (const [g, tf] of qVec) qWeight.set(g, tf * idf(g));
  let qNorm = 0;
  for (const w of qWeight.values()) qNorm += w * w;
  qNorm = Math.sqrt(qNorm) || 1;
  const scored = docVecs.map((dv) => {
    let dot = 0, dNorm = 0;
    const dWeight = new Map<string, number>();
    for (const [g, tf] of dv.vec) {
      const w = tf * idf(g);
      dWeight.set(g, w);
      dNorm += w * w;
      const qw = qWeight.get(g);
      if (qw) dot += w * qw;
    }
    const cos = dot / (qNorm * (Math.sqrt(dNorm) || 1));
    return { id: dv.id, content: dv.content, role: (dv.role ?? "working") as MemoryRoleId, score: cos };
  });
  return scored.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Fuse the BM25 + substring + vector arms (all zero-dep). A real HNSW/graph arm
 * drops in by passing more RetrievalArms to reciprocalRankFuse. Respects
 * `query.topK` (MED-3 review). Uses a generous candidate window so a doc
 * ranked #51 in two arms can still outrank a rank-1 single-arm doc.
 */
export function rrfRetrieve(
  docs: { id: string; content: string; role?: MemoryRoleId }[],
  query: MemoryQuery,
  topK?: number,
  candidateK = 100,
): MemoryHit[] {
  const outerTopK = topK ?? query.topK ?? 10;
  return reciprocalRankFuse([
    { name: "bm25", hits: bm25Arm(docs, query, candidateK) },
    { name: "substring", hits: substringArm(docs, query, candidateK) },
    { name: "vector", hits: vectorArm(docs, query, candidateK) },
  ], outerTopK);
}
