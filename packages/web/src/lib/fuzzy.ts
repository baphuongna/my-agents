/**
 * Lightweight fuzzy subsequence scorer for picker filtering — port of Hermes
 * `lib/fuzzy.ts`.
 *
 * Matches a query as an ordered subsequence of the target (so `g4o` matches
 * `gpt-4o`) and scores by match quality so callers can rank results. Higher
 * score is a better match. Returns the matched character indices so callers
 * can highlight them.
 *
 * The scoring favours, in rough order: exact full match, prefix match, matches
 * that start on a word boundary (after `-`, `_`, `/`, `.`, space, or a
 * lower→upper case transition), contiguous runs, and earlier matches. This is
 * intentionally simple — no external dependency — but good enough to make
 * `son4` rank `claude-sonnet-4` above an incidental scattered hit.
 *
 * Pure functions — no React/DOM dependencies.
 */

export interface FuzzyMatch {
  /** Total score; higher is better. */
  score: number;
  /** Indices into the original (non-lowercased) target that were matched. */
  positions: number[];
}

/** Scoring constants, exported so tests can assert against fixed magnitudes. */
export const SCORE_EXACT = 20;
export const SCORE_PREFIX = 8;
export const SCORE_CONTIGUOUS = 5;
export const SCORE_WORD_BOUNDARY = 3;
export const SCORE_FIRST_CHAR = 5;

const WORD_BOUNDARY = /[-_/.\s]/;

function isBoundary(target: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  const prev = target[index - 1];

  if (prev !== undefined && WORD_BOUNDARY.test(prev)) {
    return true;
  }

  const cur = target[index];

  // camelCase / lower→upper transition (e.g. the `O` in `gptO`).
  return (
    prev !== undefined &&
    cur !== undefined &&
    prev === prev.toLowerCase() &&
    cur !== cur.toLowerCase() &&
    cur === cur.toUpperCase()
  );
}

/**
 * Score a single query token against a target. Returns null when the token is
 * not a subsequence of the target. An empty query scores 0 with no positions.
 */
export function fuzzyScore(target: string, query: string): FuzzyMatch | null {
  if (!query) {
    return { score: 0, positions: [] };
  }

  const lowerTarget = target.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let prevIndex = -1;
  let searchFrom = 0;

  for (const ch of lowerQuery) {
    const idx = lowerTarget.indexOf(ch, searchFrom);

    if (idx < 0) {
      return null;
    }

    positions.push(idx);

    // Base point for the matched character.
    score += 1;

    // Contiguous with the previous match → strong bonus.
    if (prevIndex >= 0 && idx === prevIndex + 1) {
      score += SCORE_CONTIGUOUS;
    } else if (prevIndex >= 0) {
      // Penalise the gap we had to skip (capped), so contiguous beats scattered.
      score -= Math.min(idx - prevIndex - 1, 3);
    }

    // Word-boundary / start-of-string matches are meaningful.
    if (isBoundary(target, idx)) {
      score += SCORE_WORD_BOUNDARY;
    }

    // Matching the very first character of the target is the strongest signal.
    if (idx === 0) {
      score += SCORE_FIRST_CHAR;
    }

    prevIndex = idx;
    searchFrom = idx + 1;
  }

  // Prefix bonus: the query matched a contiguous prefix of the target.
  const firstPos = positions[0];
  const lastPos = positions[positions.length - 1];
  if (
    firstPos !== undefined &&
    lastPos !== undefined &&
    firstPos === 0 &&
    lastPos === positions.length - 1
  ) {
    score += SCORE_PREFIX;
  }

  // Exact full match dominates everything else.
  if (lowerTarget === lowerQuery) {
    score += SCORE_EXACT;
  }

  // Slightly prefer shorter targets when scores are otherwise close, so a
  // query that fully prefixes a short id beats the same prefix on a long one.
  score -= lowerTarget.length * 0.01;

  return { score, positions };
}

/**
 * Score a target against a whitespace-separated, multi-token query. Every token
 * must match (AND semantics); the result aggregates per-token scores and the
 * union of matched positions. Returns null if any token fails to match.
 */
export function fuzzyScoreMulti(target: string, query: string): FuzzyMatch | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    return { score: 0, positions: [] };
  }

  let score = 0;
  const positionSet = new Set<number>();

  for (const token of tokens) {
    const match = fuzzyScore(target, token);

    if (!match) {
      return null;
    }

    score += match.score;

    for (const pos of match.positions) {
      positionSet.add(pos);
    }
  }

  return { score, positions: [...positionSet].sort((a, b) => a - b) };
}

export interface RankedItem<T> {
  item: T;
  score: number;
  positions: number[];
}

/**
 * Filter + rank a list by a fuzzy query against a derived text key. Non-matching
 * items are dropped; matches are sorted by score (descending), ties broken by
 * the original index so ordering is stable for equal scores. An empty query
 * returns every item in original order with no positions.
 */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
): RankedItem<T>[] {
  const trimmed = query.trim();

  if (!trimmed) {
    return items.map((item) => ({ item, score: 0, positions: [] }));
  }

  const ranked: Array<RankedItem<T> & { index: number }> = [];

  items.forEach((item, index) => {
    const match = fuzzyScoreMulti(toText(item), trimmed);

    if (match) {
      ranked.push({ item, score: match.score, positions: match.positions, index });
    }
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);

  return ranked.map(({ item, score, positions }) => ({ item, score, positions }));
}
