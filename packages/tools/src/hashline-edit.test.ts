import { describe, it, expect, beforeEach } from "vitest";
import {
  computeLineHashes,
  canon,
  mapStableHashes,
  resolveAnchor,
  applyEdits,
  saveUndo,
  getUndo,
  clearUndo,
  HASH_LEN,
  type HashEdit,
  type UndoEntry,
} from "./hashline-edit.js";

/** Helper: get the hash for a 1-based line number. */
function hashOf(content: string, line: number): string {
  return computeLineHashes(content)[line - 1]!;
}

describe("hashline-edit — computeLineHashes", () => {
  it("produces unique 4-char base64url hashes for every line, including duplicates", () => {
    const content = "const x = 1;\nconst y = 2;\nconst x = 1;";
    const hashes = computeLineHashes(content);

    expect(hashes).toHaveLength(3);
    // All match the 4-char base64url format.
    for (const h of hashes) {
      expect(h).toMatch(/^[A-Za-z0-9_-]{4}$/);
    }
    // Identical content at different positions gets different hashes.
    expect(hashes[0]).not.toBe(hashes[2]);
    expect(new Set(hashes).size).toBe(3);
  });

  it("respects canon: trailing whitespace and CR are stripped before hashing", () => {
    // canon strips \r and trailing spaces.
    expect(canon("hello\r")).toBe("hello");
    expect(canon("hello   ")).toBe("hello");

    // Lines that differ only in trailing whitespace hash identically.
    const h1 = computeLineHashes("value  ");
    const h2 = computeLineHashes("value");
    expect(h1[0]).toBe(h2[0]);

    // Internal spaces are preserved.
    const ha = computeLineHashes("a b");
    const hb = computeLineHashes("ab");
    expect(ha[0]).not.toBe(hb[0]);
  });
});

describe("hashline-edit — mapStableHashes", () => {
  it("preserves old hashes for unchanged lines and assigns fresh hashes for new/modified lines", () => {
    const oldContent = "a\nb\ne\nf";
    const oldHashes = computeLineHashes(oldContent);
    const newContent = "a\nb\nc\nd\ne\nf";

    const result = mapStableHashes(oldContent, oldHashes, newContent);

    expect(result).toHaveLength(6);
    // Unchanged lines keep their old hashes.
    expect(result[0]).toBe(oldHashes[0]);
    expect(result[1]).toBe(oldHashes[1]);
    expect(result[4]).toBe(oldHashes[2]);
    expect(result[5]).toBe(oldHashes[3]);
    // New lines get fresh 4-char hashes.
    expect(result[2]).toMatch(/^[A-Za-z0-9_-]{4}$/);
    expect(result[3]).toMatch(/^[A-Za-z0-9_-]{4}$/);
    // Result is globally unique.
    expect(new Set(result).size).toBe(6);
  });

  it("biases duplicate-line candidate selection via removedHashes", () => {
    const oldContent = "a\nb\nb\nc";
    const oldHashes = computeLineHashes(oldContent);
    const firstBHash = oldHashes[1]!;
    const secondBHash = oldHashes[2]!;
    expect(firstBHash).not.toBe(secondBHash);

    // New content has only one "b" line.
    const newContent = "a\nb\nc";

    // Without removedHashes: first candidate (index 1) wins.
    const noBias = mapStableHashes(oldContent, oldHashes, newContent);
    expect(noBias[1]).toBe(firstBHash);

    // With removedHashes={firstBHash}: second candidate (index 2) wins.
    const biased = mapStableHashes(oldContent, oldHashes, newContent, new Set([firstBHash]));
    expect(biased[1]).toBe(secondBHash);
  });
});

describe("hashline-edit — resolveAnchor", () => {
  it("returns the line for a unique hash, not_found for missing, ambiguous for duplicates", () => {
    const content = "alpha\nbeta\ngamma";
    const hashes = computeLineHashes(content);

    // Unique match → line number.
    const res = resolveAnchor(hashes[1]!, hashes);
    expect(res).toEqual({ line: 2, matched: true });

    // Missing hash → not_found.
    expect(resolveAnchor("ZZZZ", hashes)).toEqual({ error: "not_found" });

    // Forged duplicate → ambiguous.
    const forged = [...hashes];
    forged[2] = hashes[0]!;
    const amb = resolveAnchor(hashes[0]!, forged);
    expect(amb).toEqual({ error: "ambiguous", candidates: [1, 3] });
  });
});

describe("hashline-edit — applyEdits", () => {
  it("replaces a single line, replaces a range, and applies multiple edits bottom-up", () => {
    // Single-line replace.
    const content = "aaa\nbbb\nccc";
    let edits: HashEdit[] = [
      { hash_range_inclusive: [hashOf(content, 2), hashOf(content, 2)], content_lines: ["BBB"] },
    ];
    let result = applyEdits(content, edits);
    expect(result.content).toBe("aaa\nBBB\nccc");
    expect(result.firstChangedLine).toBe(2);
    expect(result.lastChangedLine).toBe(2);

    // Range replace.
    const content2 = "aaa\nbbb\nccc\nddd";
    edits = [
      { hash_range_inclusive: [hashOf(content2, 2), hashOf(content2, 3)], content_lines: ["BBB", "CCC"] },
    ];
    result = applyEdits(content2, edits);
    expect(result.content).toBe("aaa\nBBB\nCCC\nddd");

    // Multiple edits bottom-up (lines 1 and 3).
    edits = [
      { hash_range_inclusive: [hashOf(content, 1), hashOf(content, 1)], content_lines: ["AAA"] },
      { hash_range_inclusive: [hashOf(content, 3), hashOf(content, 3)], content_lines: ["CCC"] },
    ];
    result = applyEdits(content, edits);
    expect(result.content).toBe("AAA\nbbb\nCCC");
  });

  it("detects noops, deduplicates identical edits, and rejects stale/ambiguous/overlap", () => {
    const content = "aaa\nbbb\nccc";

    // Noop: replacement equals existing content.
    let edits: HashEdit[] = [
      { hash_range_inclusive: [hashOf(content, 2), hashOf(content, 2)], content_lines: ["bbb"] },
    ];
    let result = applyEdits(content, edits);
    expect(result.noopEdits).toHaveLength(1);
    expect(result.noopEdits![0]!.editIndex).toBe(0);

    // Dedupe: two identical edits collapse to one.
    const pos = hashOf(content, 2);
    edits = [
      { hash_range_inclusive: [pos, pos], content_lines: ["BBB"] },
      { hash_range_inclusive: [pos, pos], content_lines: ["BBB"] },
    ];
    result = applyEdits(content, edits);
    expect(result.content).toBe("aaa\nBBB\nccc");

    // Stale anchor rejection.
    expect(() =>
      applyEdits(content, [
        { hash_range_inclusive: ["ZZZZ", "ZZZZ"], content_lines: ["X"] },
      ]),
    ).toThrow(/E_STALE_ANCHOR/);

    // Ambiguous anchor rejection (forged duplicate).
    const forgedHashes = computeLineHashes(content);
    forgedHashes[2] = forgedHashes[0]!;
    expect(() =>
      applyEdits(content, [
        { hash_range_inclusive: [forgedHashes[0]!, forgedHashes[0]!], content_lines: ["X"] },
      ], forgedHashes),
    ).toThrow(/E_AMBIGUOUS_ANCHOR/);

    // Overlap rejection: two edits on the same line range.
    edits = [
      { hash_range_inclusive: [hashOf(content, 1), hashOf(content, 3)], content_lines: ["X"] },
      { hash_range_inclusive: [hashOf(content, 2), hashOf(content, 2)], content_lines: ["Y"] },
    ];
    expect(() => applyEdits(content, edits)).toThrow(/E_EDIT_CONFLICT/);
  });

  it("deletes lines, rejects emptying a non-empty file, and preserves trailing newlines", () => {
    // Delete a mid-file line.
    const content = "aaa\nbbb\nccc\nddd";
    let edits: HashEdit[] = [
      { hash_range_inclusive: [hashOf(content, 2), hashOf(content, 3)], content_lines: [] },
    ];
    let result = applyEdits(content, edits);
    expect(result.content).toBe("aaa\nddd");

    // Reject emptying a non-empty file.
    expect(() =>
      applyEdits("aaa\nbbb", [
        { hash_range_inclusive: [hashOf("aaa\nbbb", 1), hashOf("aaa\nbbb", 2)], content_lines: [] },
      ]),
    ).toThrow(/E_WOULD_EMPTY/);

    // Preserve trailing newline when replacing the last line.
    const tn = "line1\n</br>\n";
    edits = [
      { hash_range_inclusive: [hashOf(tn, 2), hashOf(tn, 2)], content_lines: ["<br/>"] },
    ];
    result = applyEdits(tn, edits);
    expect(result.content).toBe("line1\n<br/>\n");
  });
});

describe("hashline-edit — undo store", () => {
  // Clear all undo entries before each test for isolation.
  beforeEach(() => {
    for (const path of ["/undo-a.ts", "/undo-b.ts", "/undo-ow.ts"]) {
      clearUndo(path);
    }
  });

  it("round-trips an entry, overwrites on re-save, and clears on demand", () => {
    // Round-trip.
    const entry: UndoEntry = { content: "hello\nworld", hashes: ["abcd", "efgh"] };
    saveUndo("/undo-a.ts", entry);
    const got = getUndo("/undo-a.ts");
    expect(got).toEqual(entry);

    // Overwrite.
    saveUndo("/undo-ow.ts", { content: "first", hashes: ["aaaa"] });
    saveUndo("/undo-ow.ts", { content: "second", hashes: ["bbbb"] });
    expect(getUndo("/undo-ow.ts")!.content).toBe("second");

    // Clear.
    saveUndo("/undo-b.ts", { content: "bbb", hashes: ["cccc"] });
    expect(getUndo("/undo-b.ts")).toBeDefined();
    clearUndo("/undo-b.ts");
    expect(getUndo("/undo-b.ts")).toBeUndefined();

    // Missing path.
    expect(getUndo("/nonexistent.ts")).toBeUndefined();
  });
});
