/**
 * @my-agent/memory/cjk-tokenizer — CJK bigram tokenizer (pure TypeScript).
 *
 * Mirrors the Hermes native/fts5_cjk/fts5_cjk.c algorithm: overlapping
 * character bigrams for CJK text (Lucene CJKAnalyzer semantics), zero-overhead
 * fast path for pure-ASCII, lone CJK char as unigram.
 *
 * Used to pre-process queries before FTS5 MATCH so that CJK terms are
 * searchable as substrings via the bigram-phrase trick:
 *   캘린더 → [캘린][린더]  →  FTS5 treats consecutive tokens as a phrase
 */
// ── Types ─────────────────────────────────────────────────────────────────

export interface Token {
  token: string;
  /** Start offset in UTF-8 bytes. */
  start: number;
  /** End offset in UTF-8 bytes (exclusive). */
  end: number;
}

// ── CJK codepoint ranges (mirrors Hermes native/fts5_cjk/fts5_cjk.c) ──────

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xac00, 0xd7a3], // Hangul syllables
  [0x1100, 0x11ff], // Hangul Jamo
  [0x3130, 0x318f], // Hangul compat Jamo
  [0xa960, 0xa97f], // Hangul Jamo ext-A
  [0xd7b0, 0xd7ff], // Hangul Jamo ext-B
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0x3400, 0x4dbf], // CJK ext A
  [0xf900, 0xfaff], // CJK compat ideographs
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x31f0, 0x31ff], // Katakana phonetic ext
];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Check if a codepoint falls within any CJK range. */
export function isCjk(cp: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** UTF-8 byte length of a single codepoint. */
function utf8ByteLen(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/** Quick check: is the string pure ASCII? */
function isPureAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Tokenize text into CJK bigrams + non-CJK segments.
 *
 * Algorithm (mirrors Hermes fts5_cjk.c rolling-window):
 *   1. Fast path: pure ASCII → single token (zero per-char overhead)
 *   2. Walk codepoint by codepoint
 *   3. For maximal CJK runs (length ≥ 2), emit overlapping bigrams
 *      (N-1 bigrams for N-char run)
 *   4. For non-CJK segments, emit as a single token
 *   5. Lone CJK char (run length 1) → emit as unigram
 *
 * Offsets are UTF-8 byte positions (matching the C implementation's semantics).
 *
 * @example tokenize("캘린더") → [{token:"캘린",start:0,end:6},{token:"린더",start:3,end:9}]
 * @example tokenize("hello")  → [{token:"hello",start:0,end:5}]
 */
export function tokenize(text: string): Token[] {
  // Fast path: pure ASCII → return as single token
  if (isPureAscii(text)) {
    return [{ token: text, start: 0, end: text.length }];
  }

  // First pass: extract codepoints with their string indices and byte offsets
  const cps: number[] = [];
  const strIdx: number[] = [];
  const byteOff: number[] = [];
  let bp = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    cps.push(cp);
    strIdx.push(i);
    byteOff.push(bp);
    bp += utf8ByteLen(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  const totalBytes = bp;

  const tokens: Token[] = [];
  let j = 0;
  while (j < cps.length) {
    const cpJ = cps[j]!;
    if (isCjk(cpJ)) {
      // ── CJK run: collect maximal consecutive CJK codepoints ────────────
      const runStart = j;
      while (j < cps.length && isCjk(cps[j]!)) j++;
      const runEnd = j; // exclusive
      const runLen = runEnd - runStart;

      if (runLen === 1) {
        // Lone CJK char → unigram
        const idx = runStart;
        const cp = cps[idx]!;
        const si = strIdx[idx]!;
        tokens.push({
          token: text.slice(si, si + (cp > 0xffff ? 2 : 1)),
          start: byteOff[idx]!,
          end: byteOff[idx]! + utf8ByteLen(cp),
        });
      } else {
        // Overlapping bigrams (N-1 bigrams for N-char run)
        for (let m = runStart; m < runEnd - 1; m++) {
          const m2 = m + 1;
          const cp2 = cps[m2]!;
          const si1 = strIdx[m]!;
          const si2 = strIdx[m2]!;
          tokens.push({
            token: text.slice(si1, si2 + (cp2 > 0xffff ? 2 : 1)),
            start: byteOff[m]!,
            end: byteOff[m2]! + utf8ByteLen(cp2),
          });
        }
      }
    } else {
      // ── Non-CJK segment: emit as a single token ───────────────────────
      const segStart = j;
      while (j < cps.length && !isCjk(cps[j]!)) j++;
      const segEnd = j; // exclusive

      const startByte = byteOff[segStart]!;
      const endByte = segEnd < cps.length ? byteOff[segEnd]! : totalBytes;
      const startIdx = strIdx[segStart]!;
      const endIdx = segEnd < cps.length ? strIdx[segEnd]! : text.length;
      tokens.push({ token: text.slice(startIdx, endIdx), start: startByte, end: endByte });
    }
  }

  return tokens;
}

/**
 * Check if text contains any CJK characters.
 * Short-circuits on the first CJK codepoint found.
 */
export function containsCjk(text: string): boolean {
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    if (isCjk(cp)) return true;
    i += cp > 0xffff ? 2 : 1;
  }
  return false;
}
