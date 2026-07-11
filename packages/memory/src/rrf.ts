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

/** Fuse multiple ranked arms via Reciprocal-Rank-Fusion (k=60). */
export function reciprocalRankFuse(arms: RetrievalArm[], topK = 10): MemoryHit[] {
  const scores = new Map<string, { hit: MemoryHit; score: number }>();
  for (const arm of arms) {
    arm.hits.forEach((hit, i) => {
      const rank = i + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = scores.get(hit.id);
      if (existing) existing.score += contribution;
      else scores.set(hit.id, { hit, score: contribution });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, topK).map((e) => ({
    ...e.hit,
    // surface the fused score (overwrites the arm-local score)
    score: Math.round(e.score * 1e6) / 1e6,
  }));
}

// ── Arm implementations (zero-dep; a vector arm drops in when available) ─────

/** BM25-ish keyword arm: rank by term-frequency saturation over the query terms. */
export function bm25Arm(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, topK = 50): MemoryHit[] {
  const terms = query.text.toLowerCase().split(/\s+/).filter(Boolean);
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
  return scored.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Substring arm (case-insensitive containment) — a weak signal that catches exact phrases BM25 might dilute. */
export function substringArm(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, topK = 50): MemoryHit[] {
  const q = query.text.toLowerCase();
  if (!q) return [];
  return docs
    .filter((d) => d.content.toLowerCase().includes(q))
    .map((d, i) => ({ id: d.id, content: d.content, role: (d.role ?? "working") as MemoryRoleId, score: 1 / (i + 1) } as MemoryHit))
    .slice(0, topK);
}

/**
 * Fuse the BM25 + substring arms (the two zero-dep arms). A vector/graph arm
 * drops in by passing more RetrievalArms to reciprocalRankFuse.
 */
export function rrfRetrieve(docs: { id: string; content: string; role?: MemoryRoleId }[], query: MemoryQuery, topK = 10): MemoryHit[] {
  return reciprocalRankFuse([
    { name: "bm25", hits: bm25Arm(docs, query) },
    { name: "substring", hits: substringArm(docs, query) },
  ], topK);
}
