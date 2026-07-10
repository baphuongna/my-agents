/**
 * Hashline — hash-anchored line editing (§7 edit-hash, source: pi-hashline-edit-pro).
 *
 * Every line gets a UNIQUE 3-char content hash (URL-safe base64, 64-char alphabet
 * = 18 bits). Byte-identical lines get DIFFERENT hashes via collision resolution
 * (`:R{retry}` salt) — perfect hashing, so every line is an unambiguous anchor.
 *
 * `read` returns `HASH│content` lines. `replace` references a hash RANGE
 * [startHash, endHash] inclusive — if the file changed since read, the anchor
 * won't match → stale edit rejected before it reaches the file.
 *
 * Hash: FNV-1a 32-bit (zero-dependency; deterministic). The pi source uses
 * xxh32; the collision-resolution + uniqueness is the correctness property,
 * not the specific algo. h2s takes the top 18 bits → 3 base64 chars.
 */
import { createHash } from "node:crypto";

export const HASH_LEN = 3;
export const HASH_SEP = "│";
const ALPH =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ALPH_BITS = 6;
const ALPH_MASK = (1 << ALPH_BITS) - 1;

/** Encode the top (HASH_LEN*6=18) bits of a 32-bit int as 3 base64 chars. */
function h2s(h: number): string {
  const totalBits = HASH_LEN * ALPH_BITS;
  const shift = 32 - totalBits;
  let n = h >>> shift;
  let out = "";
  for (let j = 0; j < HASH_LEN; j++) {
    out += ALPH[(n >>> ((HASH_LEN - 1 - j) * ALPH_BITS)) & ALPH_MASK]!;
  }
  return out;
}

/** FNV-1a 32-bit (zero-dependency deterministic hash). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Normalize a line for hashing: strip CR + trim trailing whitespace. */
function canon(line: string): string {
  return line.replace(/\r/g, "").trimEnd();
}

/**
 * Compute a perfect hash per line (collision-resolved). Byte-identical lines
 * get different hashes via the `:R{retry}` salt. Returns hashes aligned to
 * content.split("\n").
 */
export function lineHashes(content: string): string[] {
  const lines = content.split("\n");
  const hashes = new Array<string>(lines.length);
  const assigned = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const c = canon(lines[i]!);
    let hash = h2s(fnv1a(c));
    let retry = 0;
    while (assigned.has(hash)) {
      retry++;
      hash = h2s(fnv1a(`${c}:R${retry}`));
    }
    assigned.add(hash);
    hashes[i] = hash;
  }
  return hashes;
}

/** Format content as `HASH│content` per line (the read-tool wire format). */
export function formatHashed(content: string): string {
  const lines = content.split("\n");
  const hashes = lineHashes(content);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(`${hashes[i]}${HASH_SEP}${lines[i]}`);
  }
  return out.join("\n");
}

export interface HashRangeReplace {
  ok: boolean;
  content?: string;
  error?: string;
  /** How many lines were replaced. */
  replacedCount?: number;
}

/**
 * Replace an inclusive hash range [startHash, endHash] with newLines.
 * Validates: both anchors exist, are in order, and the hashes match the
 * CURRENT file content (stale detection — rejects edits against an outdated
 * read). startHash === endHash replaces a single line.
 */
export function replaceByHash(
  currentContent: string,
  startHash: string,
  endHash: string,
  newLines: string[],
): HashRangeReplace {
  const lines = currentContent.split("\n");
  const hashes = lineHashes(currentContent);
  const startIdx = hashes.indexOf(startHash);
  if (startIdx === -1) {
    return {
      ok: false,
      error: `stale or unknown anchor: "${startHash}" not in current file (re-read the file)`,
    };
  }
  // endHash search from startIdx onward (handles startHash===endHash + repeats).
  let endIdx = -1;
  for (let i = startIdx; i < hashes.length; i++) {
    if (hashes[i] === endHash) endIdx = i;
  }
  if (endIdx === -1) {
    return {
      ok: false,
      error: `stale or unknown anchor: "${endHash}" not in current file after "${startHash}"`,
    };
  }
  const replaced = lines.slice(startIdx, endIdx + 1);
  const next = [
    ...lines.slice(0, startIdx),
    ...newLines,
    ...lines.slice(endIdx + 1),
  ];
  return {
    ok: true,
    content: next.join("\n"),
    replacedCount: replaced.length,
  };
}

/** Validate a string is a well-formed 3-char base64 anchor. */
export function isValidAnchor(s: string): boolean {
  if (s.length !== HASH_LEN) return false;
  for (const ch of s) if (!ALPH.includes(ch)) return false;
  return true;
}

/** SHA-256 content hash (for the edit-tool's whole-file fingerprint). */
export function fileFingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
