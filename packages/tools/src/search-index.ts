/**
 * @my-agent/search — persistent file-search index (§11 R35 fff patterns).
 *
 * A per-root index: file table + frecency + a bigram content prefilter. Glob-only
 * fast path + fuzzy filename match + frecency ranking. Long-running + incremental
 * (watcher tombstoning is Tier-2+; this ships the index + query path).
 *
 * Source: §11 Code Nav completeness (R35); fff file_picker/score/bigram_filter.
 */
import { nativeGlob } from "@my-agent/natives";
import { basename } from "node:path";
import { nowWallclock } from "@my-agent/core";

/** A frecency DB: access timestamps → frequency+recency score. */
export class FrecencyDB {
  private readonly hits = new Map<string, { count: number; lastAt: number }>();
  /** Halflife in ms for the recency decay (default 7d). */
  constructor(private halflifeMs = 7 * 24 * 3600 * 1000) {}

  bump(path: string, now = nowWallclock()): void {
    const e = this.hits.get(path) ?? { count: 0, lastAt: 0 };
    e.count += 1;
    e.lastAt = now;
    this.hits.set(path, e);
  }

  /** Frecency score: count × decay(lastAt), where decay halves every `halflifeMs`. */
  score(path: string, now = nowWallclock()): number {
    const e = this.hits.get(path);
    if (!e) return 0;
    const age = Math.max(0, now - e.lastAt);
    const decay = Math.pow(0.5, age / this.halflifeMs);
    return e.count * decay;
  }

  snapshot(): ReadonlyMap<string, { count: number; lastAt: number }> {
    return this.hits;
  }
}

/** A bigram bitset prefilter: build an inverted index of 2-grams (with skip-1)
 * from a query; a path is a candidate iff all query bigrams are present. */
export class BigramFilter {
  private readonly index = new Map<string, Set<string>>(); // path → set of bigrams

  /** Index a path's filename (cheap, zero-token). */
  add(path: string): void {
    const name = basename(path).toLowerCase();
    const bigrams = new Set<string>();
    for (let i = 0; i < name.length - 1; i++) {
      bigrams.add(name.slice(i, i + 2)); // adjacent bigram
      // S1: real skip-1 bigram (chars at i and i+2) for typo/gap tolerance.
      if (i + 2 < name.length) bigrams.add(name[i]! + name[i + 2]!);
    }
    this.index.set(path, bigrams);
  }

  remove(path: string): void {
    this.index.delete(path);
  }

  /** Candidate paths whose bigram-set ⊇ the query's bigrams (prefilter). */
  candidates(query: string): Set<string> {
    const q = query.toLowerCase();
    const need = new Set<string>();
    for (let i = 0; i < q.length - 1; i++) need.add(q.slice(i, i + 2));
    if (need.size === 0) return new Set(this.index.keys());
    const out = new Set<string>();
    for (const [path, bigrams] of this.index) {
      let ok = true;
      for (const b of need) {
        if (!bigrams.has(b)) {
          ok = false;
          break;
        }
      }
      if (ok) out.add(path);
    }
    return out;
  }
}

export interface ScoredPath {
  path: string;
  score: number;
  breakdown: { fuzzy: number; frecency: number; filenameBonus: number };
}

/** A per-root search index: file table + frecency + bigram prefilter. */
export class SearchIndex {
  readonly frecency = new FrecencyDB();
  readonly bigram = new BigramFilter();
  private files = new Set<string>();
  private health: "Healthy" | "Degraded" = "Healthy";

  constructor(private root: string) {}

  /** Scan the root once (glob all files, build the bigram index). */
  async scan(): Promise<{ indexed: number }> {
    const all = nativeGlob("**/*", this.root, { maxResults: 100_000 });
    this.files = new Set(all);
    for (const f of all) this.bigram.add(f);
    return { indexed: all.length };
  }

  /** Record a file access (drives frecency). */
  access(path: string): void {
    this.frecency.bump(path);
  }

  /** Glob-only fast path: one glob constraint + frecency ranking. */
  globOnly(pattern: string, limit = 50): ScoredPath[] {
    const matched = nativeGlob(pattern, this.root, { maxResults: limit * 4 });
    return this.rank(matched, "").slice(0, limit);
  }

  /** Fuzzy filename query with frecency ranking + bigram prefilter. */
  query(q: string, limit = 50): ScoredPath[] {
    if (!q.trim()) return [];
    const candidates = this.bigram.candidates(q);
    // fallback: if bigram filter yields nothing, scan all (weak-fuzzy fallback)
    const pool = candidates.size > 0 ? [...candidates] : [...this.files];
    return this.rank(pool, q).slice(0, limit);
  }

  private rank(paths: string[], q: string): ScoredPath[] {
    const ql = q.toLowerCase();
    return paths
      .map((path) => {
        const name = basename(path).toLowerCase();
        const fuzzy = ql ? fuzzyScore(name, ql) : 1;
        const frecency = this.frecency.score(path);
        const filenameBonus = ql && name.includes(ql) ? 5 : 0;
        return {
          path,
          score: fuzzy + frecency + filenameBonus,
          breakdown: { fuzzy, frecency, filenameBonus },
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  getHealth(): "Healthy" | "Degraded" {
    return this.health;
  }

  get size(): number {
    return this.files.size;
  }
}

/** Cheap subsequence fuzzy score: how well `q` matches as a subsequence of `name`,
 * preferring contiguous + early matches. */
export function fuzzyScore(name: string, q: string): number {
  if (name.includes(q)) return 10 + (q.length / name.length) * 5; // substring bonus
  let ni = 0;
  let qi = 0;
  let contiguous = 0;
  let maxContiguous = 0;
  let firstMatch = -1;
  while (ni < name.length && qi < q.length) {
    if (name[ni] === q[qi]) {
      if (firstMatch < 0) firstMatch = ni;
      contiguous++;
      maxContiguous = Math.max(maxContiguous, contiguous);
      qi++;
    } else {
      contiguous = 0;
    }
    ni++;
  }
  if (qi < q.length) return 0; // not a full subsequence
  const earlyBonus = firstMatch >= 0 ? Math.max(0, 5 - firstMatch) : 0;
  return 1 + maxContiguous + earlyBonus;
}
