/**
 * hashline-edit — hash-anchored multi-line edit engine (§7 edit-hash).
 *
 * Pure, synchronous line-hashing + multi-edit application. Each line gets a
 * UNIQUE 4-char hash (SHA-256 per line → first 3 digest bytes → base64url,
 * 24 bits). Byte-identical lines get DIFFERENT hashes via `:R{retry}` salt —
 * perfect hashing so every line is an unambiguous anchor.
 *
 * `applyEdits` references a hash RANGE [startHash, endHash] inclusive.
 * Pipeline: validate anchors (reject stale/ambiguous) → build char-offset
 * spans (detect noops, dedupe identical edits) → assert no overlap → sort
 * right-to-left (descending by end) → assemble by slicing.
 *
 * This is a standalone module distinct from `hashline.ts` (which uses FNV-1a
 * / 3-char). Source algorithm: pi-hashline-edit-pro, adapted to SHA-256.
 */
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HASH_LEN = 4;
export const HASH_SEP = "│";
export const MAX_HASH_LINES = 1_000_000;
export const MAX_HASH_RETRIES = 262_144;

/** Regex matching a well-formed 4-char base64url anchor. */
export const HASH_RE = /^[A-Za-z0-9_-]{4}$/;

// ---------------------------------------------------------------------------
// canon + raw hash
// ---------------------------------------------------------------------------

/**
 * Canonical form for hashing: strip CR (`\r`) and trailing whitespace.
 * Two lines that differ only in trailing whitespace hash identically.
 */
export function canon(line: string): string {
  return line.replace(/\r/g, "").trimEnd();
}

/**
 * SHA-256 of `line`, take first 3 digest bytes → 4-char base64url (24 bits,
 * no padding needed since 3 bytes = 24 bits is divisible by 6).
 */
function rawHash(line: string): string {
  return createHash("sha256")
    .update(line)
    .digest()
    .subarray(0, 3)
    .toString("base64url");
}

// ---------------------------------------------------------------------------
// computeLineHashes
// ---------------------------------------------------------------------------

/**
 * Compute a perfect hash per line (collision-resolved). Byte-identical lines
 * get different hashes via the `:R{retry}` salt. Returns hashes aligned to
 * `content.split("\n")`.
 *
 * @throws if the file exceeds `MAX_HASH_LINES`.
 */
export function computeLineHashes(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > MAX_HASH_LINES) {
    throw new Error(
      `[E_TOO_LARGE] File has ${lines.length} lines; max is ${MAX_HASH_LINES}.`,
    );
  }
  const hashes = new Array<string>(lines.length);
  const assigned = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const c = canon(lines[i]!);
    let hash = rawHash(c);
    let retry = 0;
    while (assigned.has(hash)) {
      retry++;
      if (retry > MAX_HASH_RETRIES) {
        throw new Error("Hash space exhausted");
      }
      hash = rawHash(`${c}:R${retry}`);
    }
    assigned.add(hash);
    hashes[i] = hash;
  }
  return hashes;
}

// ---------------------------------------------------------------------------
// mapStableHashes
// ---------------------------------------------------------------------------

/**
 * Map old line hashes onto new content, preserving unchanged-line hashes.
 *
 * Matches new lines to old lines by **exact content equality** (the raw line
 * string, not the canonicalised form). Matched lines reuse their old hash;
 * new/modified lines get fresh collision-resolved hashes.
 *
 * `removedHashes` biases candidate selection: when a new line's content
 * matches multiple old lines, the first old line whose hash is NOT in
 * `removedHashes` is preferred. This prevents a just-removed line's hash
 * from being reassigned to a surviving identical line.
 *
 * @returns hash array aligned to `newContent.split("\n")`, guaranteed unique.
 */
export function mapStableHashes(
  oldContent: string,
  oldHashes: string[],
  newContent: string,
  removedHashes?: Set<string>,
): string[] {
  const newLines = newContent.split("\n");
  const newHashes = new Array<string>(newLines.length);
  const used = new Set<string>();

  // Build content → old-line candidate lists (exact raw line match).
  const contentMap = new Map<string, { index: number; hash: string }[]>();
  const oldLines = oldContent.split("\n");
  for (let i = 0; i < oldLines.length; i++) {
    const entry = { index: i, hash: oldHashes[i]! };
    const list = contentMap.get(oldLines[i]!);
    if (list) {
      list.push(entry);
    } else {
      contentMap.set(oldLines[i]!, [entry]);
    }
  }

  // First pass: match new lines to old lines by content equality.
  for (let i = 0; i < newLines.length; i++) {
    const candidates = contentMap.get(newLines[i]!);
    if (!candidates || candidates.length === 0) continue;

    let bestIdx = 0;
    if (removedHashes && removedHashes.size > 0) {
      for (let j = 0; j < candidates.length; j++) {
        if (!removedHashes.has(candidates[j]!.hash)) {
          bestIdx = j;
          break;
        }
      }
    }

    const match = candidates.splice(bestIdx, 1)[0]!;
    newHashes[i] = match.hash;
    used.add(match.hash);
  }

  // Second pass: compute fresh hashes for unmatched (new/modified) lines.
  for (let i = 0; i < newLines.length; i++) {
    if (newHashes[i]) continue;
    const c = canon(newLines[i]!);
    let retry = 0;
    let hash = rawHash(c);
    while (used.has(hash)) {
      retry++;
      if (retry > MAX_HASH_RETRIES) {
        throw new Error("Hash space exhausted");
      }
      hash = rawHash(`${c}:R${retry}`);
    }
    used.add(hash);
    newHashes[i] = hash;
  }
  return newHashes;
}

// ---------------------------------------------------------------------------
// resolveAnchor
// ---------------------------------------------------------------------------

export type AnchorResult =
  | { line: number; matched: true }
  | { error: "not_found" }
  | { error: "ambiguous"; candidates: number[] };

/**
 * Resolve a hash anchor to a 1-based line number.
 *
 * @returns `{ line, matched: true }` if the hash appears exactly once,
 *          `{ error: "not_found" }` if zero times,
 *          `{ error: "ambiguous", candidates }` if more than once.
 */
export function resolveAnchor(hash: string, hashes: string[]): AnchorResult {
  const candidates: number[] = [];
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i] === hash) {
      candidates.push(i + 1);
    }
  }
  if (candidates.length === 0) return { error: "not_found" };
  if (candidates.length === 1) return { line: candidates[0]!, matched: true };
  return { error: "ambiguous", candidates };
}

// ---------------------------------------------------------------------------
// applyEdits types
// ---------------------------------------------------------------------------

/**
 * A single hash-anchored edit. `hash_range_inclusive` is `[startHash, endHash]`
 * — the inclusive range of lines to replace. `content_lines` is the replacement
 * (use `[]` to delete).
 */
export interface HashEdit {
  content_lines: string[];
  hash_range_inclusive: [string, string];
}

/** An edit whose replacement is identical to the existing content (skipped). */
export interface NoopEdit {
  editIndex: number;
  loc: string;
  currentContent: string;
}

export interface ApplyResult {
  content: string;
  firstChangedLine: number | undefined;
  lastChangedLine: number | undefined;
  noopEdits?: NoopEdit[];
}

// ---------------------------------------------------------------------------
// applyEdits — private helpers
// ---------------------------------------------------------------------------

/** Count visible lines (a trailing newline does not create an extra line). */
function cntLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

interface Mismatch {
  hash: string;
  kind: "not_found" | "ambiguous";
  candidates?: number[];
}

/** Format anchor mismatches into a human-readable error message. */
function fmtMismatch(
  mismatches: Mismatch[],
  fileLines: string[],
  fileHashes: string[],
): string {
  const out: string[] = [];
  const notFound = mismatches.filter((m) => m.kind === "not_found");
  const ambiguous = mismatches.filter((m) => m.kind === "ambiguous");

  if (notFound.length > 0) {
    const refList = notFound.map((m) => `"${m.hash}"`).join(", ");
    out.push(
      `[E_STALE_ANCHOR] ${notFound.length} stale anchor${notFound.length > 1 ? "s" : ""}: ${refList}. Call read() to get fresh anchors, then copy the ${HASH_LEN}-char HASH of the start and end of the range you are replacing into hash_range_inclusive of your next replace call.`,
    );
  }
  if (ambiguous.length > 0) {
    if (out.length > 0) out.push("");
    out.push(
      `[E_AMBIGUOUS_ANCHOR] ${ambiguous.length} ambiguous anchor${ambiguous.length > 1 ? "s" : ""}. Call read() to get fresh anchors, then copy the ${HASH_LEN}-char HASH of the start and end of the range you are replacing into hash_range_inclusive of your next replace call.`,
    );
    for (const m of ambiguous) {
      const sample = (m.candidates ?? []).slice(0, 5);
      const remaining = (m.candidates?.length ?? 0) - sample.length;
      const more = remaining > 0 ? `, ... (+${remaining} more)` : "";
      const lines = sample
        .map((line) => {
          const content = fileLines[line - 1] ?? "";
          return `    ${line}: ${fileHashes[line - 1] ?? ""}${HASH_SEP}${content}`;
        })
        .join("\n");
      out.push(
        `  Hash "${m.hash}" matches lines ${sample.join(", ")}${more}.\n${lines}`,
      );
    }
  }
  return out.join("\n");
}

interface CharSpan {
  start: number;
  end: number;
  replacement: string;
  index: number;
}

interface LineIndex {
  fileLines: string[];
  lineStarts: number[];
}

/** Precompute line strings and char-offset start positions. */
function buildLineIndex(content: string): LineIndex {
  const fileLines = content.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (let i = 0; i < fileLines.length; i++) {
    lineStarts.push(offset);
    offset += fileLines[i]!.length;
    if (i < fileLines.length - 1) {
      offset += 1; // newline
    }
  }
  return { fileLines, lineStarts };
}

/**
 * Resolve a validated edit (start/end line known) into a char-offset span.
 * Returns `null` for noops (identical replacement). Handles three deletion
 * cases (entire file, mid-file, end-of-file) by including the right newline.
 */
function editToSpan(
  content_lines: string[],
  startLine: number,
  endLine: number,
  editIndex: number,
  idx: LineIndex,
  fileHashes: string[],
  content: string,
  noopEdits: NoopEdit[],
): CharSpan | null {
  const { fileLines, lineStarts } = idx;

  // Noop detection: replacement is identical to existing content.
  const originalLines = fileLines.slice(startLine - 1, endLine);
  if (
    originalLines.length === content_lines.length &&
    originalLines.every((line, i) => line === content_lines[i])
  ) {
    noopEdits.push({
      editIndex,
      loc: fileHashes[startLine - 1] ?? "",
      currentContent: originalLines.join("\n"),
    });
    return null;
  }

  // Non-empty replacement → straightforward span.
  if (content_lines.length > 0) {
    return {
      start: lineStarts[startLine - 1]!,
      end: lineStarts[endLine - 1]! + fileLines[endLine - 1]!.length,
      replacement: content_lines.join("\n"),
      index: editIndex,
    };
  }

  // Deletion (content_lines empty):

  // Entire file → span the whole content.
  if (startLine === 1 && endLine === fileLines.length) {
    return { start: 0, end: content.length, replacement: "", index: editIndex };
  }

  // Mid-file → include the newline after the last deleted line.
  if (endLine < fileLines.length) {
    return {
      start: lineStarts[startLine - 1]!,
      end: lineStarts[endLine]!,
      replacement: "",
      index: editIndex,
    };
  }

  // End of file → include the newline before the first deleted line.
  return {
    start: Math.max(0, lineStarts[startLine - 1]! - 1),
    end: lineStarts[endLine - 1]! + fileLines[endLine - 1]!.length,
    replacement: "",
    index: editIndex,
  };
}

/** Reject overlapping spans. */
function assertNoConflict(spans: CharSpan[]): void {
  for (let i = 0; i < spans.length; i++) {
    const left = spans[i]!;
    for (let j = i + 1; j < spans.length; j++) {
      const right = spans[j]!;
      if (left.start < right.end && right.start < left.end) {
        throw new Error(
          `[E_EDIT_CONFLICT] Edit ${left.index} and edit ${right.index} overlap on the same original line range.`,
        );
      }
    }
  }
}

/** Find the first and last changed line (1-based) between original and result. */
function changedRange(
  original: string,
  result: string,
): { firstChangedLine: number; lastChangedLine: number } | null {
  if (original === result) return null;

  if (original.length === 0) {
    return { firstChangedLine: 1, lastChangedLine: cntLines(result) };
  }

  // Pure append after a newline.
  if (result.startsWith(original) && original.endsWith("\n")) {
    return {
      firstChangedLine: cntLines(original) + 1,
      lastChangedLine: cntLines(result),
    };
  }

  // Binary search from both ends.
  let firstDiff = 0;
  const minLen = Math.min(original.length, result.length);
  while (firstDiff < minLen && original[firstDiff] === result[firstDiff]) {
    firstDiff++;
  }
  if (firstDiff === minLen && original.length === result.length) return null;

  let lastOrig = original.length - 1;
  let lastRes = result.length - 1;
  while (
    lastOrig >= firstDiff &&
    lastRes >= firstDiff &&
    original[lastOrig] === result[lastRes]
  ) {
    lastOrig--;
    lastRes--;
  }

  function idxToLine(charIdx: number, text: string): number {
    let line = 1;
    for (let i = 0; i < charIdx && i < text.length; i++) {
      if (text[i] === "\n") line++;
    }
    return line;
  }

  const firstChangedLine = idxToLine(firstDiff + 1, result);

  let lastChangedLine: number;
  if (lastRes < firstDiff) {
    lastChangedLine = result.length === 0 ? 1 : cntLines(result);
  } else if (
    firstDiff === 0 &&
    original.length > 0 &&
    result.endsWith(original)
  ) {
    lastChangedLine = firstChangedLine;
  } else {
    lastChangedLine = idxToLine(lastRes + 1, result);
  }

  return { firstChangedLine, lastChangedLine };
}

// ---------------------------------------------------------------------------
// applyEdits
// ---------------------------------------------------------------------------

/**
 * Apply multiple hash-anchored edits to content.
 *
 * Pipeline: validate anchors → resolve to line ranges → build char-offset
 * spans (detect noops, dedupe) → assert no overlap → sort right-to-left
 * (descending by end) → assemble by slicing.
 *
 * @param precomputedHashes — pass precomputed hashes to skip recomputation.
 * @throws `[E_STALE_ANCHOR]` if a hash doesn't match any line.
 * @throws `[E_AMBIGUOUS_ANCHOR]` if a hash matches multiple lines.
 * @throws `[E_BAD_OP]` if range start > end.
 * @throws `[E_EDIT_CONFLICT]` if edits overlap.
 * @throws `[E_WOULD_EMPTY]` if the result would empty a non-empty file.
 */
export function applyEdits(
  content: string,
  edits: HashEdit[],
  precomputedHashes?: string[],
): ApplyResult {
  if (edits.length === 0) {
    return { content, firstChangedLine: undefined, lastChangedLine: undefined };
  }

  const idx = buildLineIndex(content);
  const fileHashes = precomputedHashes ?? computeLineHashes(content);

  // --- Validate: resolve anchors to line numbers ---
  interface ResolvedEdit {
    content_lines: string[];
    startLine: number;
    endLine: number;
    editIndex: number;
  }
  const resolved: ResolvedEdit[] = [];
  const mismatches: Mismatch[] = [];

  for (const [editIndex, edit] of edits.entries()) {
    const [startHash, endHash] = edit.hash_range_inclusive;
    const startRes = resolveAnchor(startHash!, fileHashes);
    const endRes = resolveAnchor(endHash!, fileHashes);

    if ("error" in startRes) {
      mismatches.push({
        hash: startHash!,
        kind: startRes.error,
        ...(startRes.error === "ambiguous"
          ? { candidates: startRes.candidates }
          : {}),
      });
    }
    if ("error" in endRes) {
      mismatches.push({
        hash: endHash!,
        kind: endRes.error,
        ...(endRes.error === "ambiguous"
          ? { candidates: endRes.candidates }
          : {}),
      });
    }
    if ("error" in startRes || "error" in endRes) continue;

    if (startRes.line > endRes.line) {
      throw new Error(
        `[E_BAD_OP] Range start line ${startRes.line} must be <= end line ${endRes.line} (anchors ${startHash} and ${endHash}).`,
      );
    }
    resolved.push({
      content_lines: edit.content_lines,
      startLine: startRes.line,
      endLine: endRes.line,
      editIndex,
    });
  }

  if (mismatches.length) {
    throw new Error(fmtMismatch(mismatches, idx.fileLines, fileHashes));
  }

  // --- Build spans: convert to char offsets, detect noops, dedupe ---
  const noopEdits: NoopEdit[] = [];
  const seenSpanKeys = new Set<string>();
  const spans: CharSpan[] = [];

  for (const r of resolved) {
    const span = editToSpan(
      r.content_lines,
      r.startLine,
      r.endLine,
      r.editIndex,
      idx,
      fileHashes,
      content,
      noopEdits,
    );
    if (!span) continue;

    const spanKey = `replace:${span.start}:${span.end}:${span.replacement}`;
    if (seenSpanKeys.has(spanKey)) continue;
    seenSpanKeys.add(spanKey);
    spans.push(span);
  }

  assertNoConflict(spans);

  // --- Sort right-to-left (descending by end) and assemble ---
  spans.sort((a, b) =>
    b.end !== a.end ? b.end - a.end : a.index - b.index,
  );

  let result = content;
  for (const span of spans) {
    result =
      result.slice(0, span.start) + span.replacement + result.slice(span.end);
  }

  // Reject emptying a non-empty file.
  if (content.length > 0 && result.length === 0) {
    throw new Error("[E_WOULD_EMPTY] Cannot empty a non-empty file via edit.");
  }

  const range = changedRange(content, result);

  return {
    content: result,
    firstChangedLine: range?.firstChangedLine,
    lastChangedLine: range?.lastChangedLine,
    ...(noopEdits.length ? { noopEdits } : {}),
  };
}

// ---------------------------------------------------------------------------
// Undo store (in-memory, one entry per path)
// ---------------------------------------------------------------------------

export interface UndoEntry {
  content: string;
  hashes: string[];
}

const undoMap = new Map<string, UndoEntry>();

/** Save an undo snapshot for a path (latest wins). */
export function saveUndo(path: string, entry: UndoEntry): void {
  undoMap.set(path, entry);
}

/** Retrieve the undo snapshot for a path, or `undefined`. */
export function getUndo(path: string): UndoEntry | undefined {
  return undoMap.get(path);
}

/** Remove the undo snapshot for a path. */
export function clearUndo(path: string): void {
  undoMap.delete(path);
}
