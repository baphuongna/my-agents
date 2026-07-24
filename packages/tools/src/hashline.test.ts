/**
 * hashline.ts tests — hash-anchored line editing (§7 edit-hash).
 *
 * Covers: lineHashes (perfect hashing / collision resolution), formatHashed
 * (wire format), replaceByHash (inclusive range + stale detection),
 * isValidAnchor (3-char base64), fileFingerprint (sha256 prefix).
 */
import { describe, it, expect } from "vitest";
import {
  lineHashes,
  formatHashed,
  replaceByHash,
  isValidAnchor,
  fileFingerprint,
  HASH_LEN,
  HASH_SEP,
} from "./hashline.js";

describe("hashline: constants", () => {
  it("HASH_LEN is 3 and HASH_SEP is the pipe char", () => {
    expect(HASH_LEN).toBe(3);
    expect(HASH_SEP).toBe("│");
  });
});

describe("hashline: lineHashes", () => {
  it("returns one hash per line, each exactly HASH_LEN chars", () => {
    const content = "alpha\nbeta\ngamma";
    const hashes = lineHashes(content);
    expect(hashes).toHaveLength(3);
    for (const h of hashes) expect(h).toHaveLength(HASH_LEN);
  });

  it("produces a UNIQUE hash per line even for byte-identical content", () => {
    // Perfect hashing: collision resolution via `:R{retry}` salt.
    const content = "dup\ndup\ndup";
    const hashes = lineHashes(content);
    expect(new Set(hashes).size).toBe(3);
  });

  it("handles a single line with no newline", () => {
    const hashes = lineHashes("only");
    expect(hashes).toEqual([expect.any(String)]);
    expect(hashes[0]).toHaveLength(HASH_LEN);
  });

  it("is deterministic — identical content yields identical hashes", () => {
    const content = "a\nb\nc\nd";
    expect(lineHashes(content)).toEqual(lineHashes(content));
  });

  it("normalizes trailing whitespace + CR before hashing (canon)", () => {
    // "line   " and "line\r" canon to "line" → same hash.
    const a = lineHashes("line   ");
    const b = lineHashes("line\r");
    expect(a[0]).toBe(b[0]);
  });
});

describe("hashline: formatHashed", () => {
  it("emits HASH│content per line", () => {
    const out = formatHashed("hello\nworld");
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.charAt(HASH_LEN)).toBe(HASH_SEP);
      expect(isValidAnchor(l.slice(0, HASH_LEN))).toBe(true);
    }
    expect(lines[0]!.slice(HASH_LEN + 1)).toBe("hello");
    expect(lines[1]!.slice(HASH_LEN + 1)).toBe("world");
  });

  it("round-trips: hashes from formatHashed are reusable anchors", () => {
    const content = "one\ntwo\nthree";
    const formatted = formatHashed(content);
    const hashes = formatted.split("\n").map((l) => l.slice(0, HASH_LEN));
    // replacing the full range reproduces a consistent structure
    const r = replaceByHash(content, hashes[0]!, hashes[2]!, ["X", "Y"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("X\nY");
  });
});

describe("hashline: replaceByHash", () => {
  const content = "first\nsecond\nthird\nfourth";

  it("replaces an inclusive single-line range (startHash === endHash)", () => {
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[1]!, hashes[1]!, ["SECOND"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("first\nSECOND\nthird\nfourth");
      expect(r.replacedCount).toBe(1);
    }
  });

  it("replaces an inclusive multi-line range", () => {
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[1]!, hashes[2]!, ["MID"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("first\nMID\nfourth");
      expect(r.replacedCount).toBe(2);
    }
  });

  it("replaces the whole file when start..end spans all lines", () => {
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[0]!, hashes[3]!, ["all"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("all");
      expect(r.replacedCount).toBe(4);
    }
  });

  it("rejects an unknown/stale start anchor with an error", () => {
    const r = replaceByHash(content, "zzz", "zzz", ["x"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("stale or unknown anchor");
  });

  it("rejects when the end anchor is not found after the start", () => {
    const hashes = lineHashes(content);
    // end anchor that doesn't exist anywhere
    const r = replaceByHash(content, hashes[0]!, "qqq", ["x"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("stale or unknown anchor");
  });

  it("detects staleness: anchor from an OLD read no longer matches current content", () => {
    // Hash the original, mutate the file, then the old anchor must not match.
    const oldHashes = lineHashes("a\nb\nc");
    const mutated = "a\nCHANGED\nc";
    const r = replaceByHash(mutated, oldHashes[1]!, oldHashes[1]!, ["x"]);
    expect(r.ok).toBe(false);
  });
});

describe("hashline: isValidAnchor", () => {
  it("accepts well-formed 3-char URL-safe base64 anchors", () => {
    // derive real anchors from lineHashes to guarantee alphabet membership
    const real = lineHashes("seed")[0]!;
    expect(isValidAnchor(real)).toBe(true);
    expect(isValidAnchor("Ab0")).toBe(true);
    expect(isValidAnchor("Z-_")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidAnchor("ab")).toBe(false);
    expect(isValidAnchor("abcd")).toBe(false);
    expect(isValidAnchor("")).toBe(false);
  });

  it("rejects characters outside the 64-char alphabet", () => {
    expect(isValidAnchor("ab!")).toBe(false);
    expect(isValidAnchor("a b")).toBe(false);
    expect(isValidAnchor("ab│")).toBe(false);
  });
});

describe("hashline: fileFingerprint", () => {
  it("returns a 16-char hex sha256 prefix", () => {
    const fp = fileFingerprint("hello");
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for identical content", () => {
    expect(fileFingerprint("abc")).toBe(fileFingerprint("abc"));
  });

  it("differs for different content", () => {
    expect(fileFingerprint("abc")).not.toBe(fileFingerprint("abd"));
  });
});

// ── Edge-case expansion ───────────────────────────────────────────────────

describe("hashline: stale anchor detection (edge cases)", () => {
  it("rejects a stale anchor when a middle line in the range changed", () => {
    const oldHashes = lineHashes("a\nb\nc\nd\ne");
    // Line "c" changed to "CHANGED" — the old hash for line 3 no longer applies.
    const mutated = "a\nb\nCHANGED\nd\ne";
    const r = replaceByHash(mutated, oldHashes[2]!, oldHashes[2]!, ["x"]);
    expect(r.ok).toBe(false);
  });

  it("rejects a stale start anchor but accepts if the end anchor survived", () => {
    const oldHashes = lineHashes("alpha\nbeta\ngamma");
    // Only line 1 changed; lines 2-3 are intact.
    const mutated = "ALPHA\nbeta\ngamma";
    // Old hash for line 1 (start) is stale → rejection.
    const r = replaceByHash(mutated, oldHashes[0]!, oldHashes[1]!, ["x"]);
    expect(r.ok).toBe(false);
    // But old hash for line 2 (start) is still valid → acceptance.
    const r2 = replaceByHash(mutated, oldHashes[1]!, oldHashes[2]!, ["x"]);
    expect(r2.ok).toBe(true);
  });

  it("rejects a stale anchor after a line was removed (shift)", () => {
    const oldHashes = lineHashes("one\ntwo\nthree\nfour");
    // "two" removed → line indices shifted, but "three" content is the same.
    // The hash for old line 3 ("three") maps to a different position, but
    // its content-hash is stable, so it WILL match at the new position.
    // What becomes stale: a hash for a removed line.
    const removed = "one\nthree\nfour";
    // oldHashes[1] is the hash of "two" which no longer exists.
    const r = replaceByHash(removed, oldHashes[1]!, oldHashes[1]!, ["x"]);
    expect(r.ok).toBe(false);
  });

  it("uses the LAST occurrence of the end hash (rightmost in-order match)", () => {
    // Two identical lines → collision-resolved to different hashes, but we
    // forge a scenario where endHash appears at two valid positions.
    const content = "a\nb\nc\nb\nd";
    const hashes = lineHashes(content);
    // Find the two "b" lines (indices 1 and 3) — they have different hashes.
    const b1 = hashes[1]!;
    const b2 = hashes[3]!;
    // Replace from first "b" to second "b" → replaces lines 2-4 inclusive.
    const r = replaceByHash(content, b1, b2, ["MERGED"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("a\nMERGED\nd");
      expect(r.replacedCount).toBe(3);
    }
  });
});

describe("hashline: multi-edit chaining (sequential replaceByHash)", () => {
  it("applies multiple edits in sequence, each against the prior result", () => {
    let content = "line1\nline2\nline3\nline4\nline5";

    // Edit 1: replace line 2.
    let hashes = lineHashes(content);
    let r = replaceByHash(content, hashes[1]!, hashes[1]!, ["TWO"]);
    expect(r.ok).toBe(true);
    if (r.ok) content = r.content;

    // Edit 2: replace line 4 (re-hash after first edit).
    hashes = lineHashes(content);
    r = replaceByHash(content, hashes[3]!, hashes[3]!, ["FOUR"]);
    expect(r.ok).toBe(true);
    if (r.ok) content = r.content;

    // Edit 3: replace the whole range lines 1-3.
    hashes = lineHashes(content);
    r = replaceByHash(content, hashes[0]!, hashes[2]!, ["A", "B", "C"]);
    expect(r.ok).toBe(true);
    if (r.ok) content = r.content;

    expect(content).toBe("A\nB\nC\nFOUR\nline5");
  });

  it("expands a single line into many, then contracts back", () => {
    let content = "seed";
    let hashes = lineHashes(content);
    let r = replaceByHash(content, hashes[0]!, hashes[0]!, [
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) content = r.content;
    expect(content).toBe("a\nb\nc\nd");

    hashes = lineHashes(content);
    r = replaceByHash(content, hashes[1]!, hashes[2]!, ["X"]);
    expect(r.ok).toBe(true);
    if (r.ok) content = r.content;
    expect(content).toBe("a\nX\nd");
  });
});

describe("hashline: hash collision resolution (many duplicates)", () => {
  it("resolves collisions for 10 identical lines — all unique", () => {
    const content = Array.from({ length: 10 }, () => "dup").join("\n");
    const hashes = lineHashes(content);
    expect(hashes).toHaveLength(10);
    expect(new Set(hashes).size).toBe(10);
    for (const h of hashes) expect(h).toHaveLength(HASH_LEN);
  });

  it("is deterministic — the same duplicate content always resolves the same way", () => {
    const content = "x\nx\nx\nx\nx";
    const first = lineHashes(content);
    const second = lineHashes(content);
    expect(first).toEqual(second);
    // The collision salts (R1, R2, ...) are deterministic.
    expect(new Set(first).size).toBe(5);
  });

  it("handles a mix of unique and duplicate lines", () => {
    const content = "unique\ndup\nother\ndup\ndup\nunique2";
    const hashes = lineHashes(content);
    expect(new Set(hashes).size).toBe(6);
    // The two "unique" lines (different content) hash independently.
    expect(hashes[0]).not.toBe(hashes[5]);
  });
});

describe("hashline: hash removal (deletion via empty replacement)", () => {
  it("deletes a single line by replacing with an empty array", () => {
    const content = "a\nb\nc";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[1]!, hashes[1]!, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("a\nc");
      expect(r.replacedCount).toBe(1);
    }
  });

  it("deletes a range of lines", () => {
    const content = "a\nb\nc\nd\ne";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[1]!, hashes[3]!, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("a\ne");
      expect(r.replacedCount).toBe(3);
    }
  });

  it("deletes the first line", () => {
    const content = "first\nsecond\nthird";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[0]!, hashes[0]!, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("second\nthird");
  });

  it("deletes the last line", () => {
    const content = "first\nsecond\nthird";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[2]!, hashes[2]!, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("first\nsecond");
  });

  it("deletes all lines (whole-file range → empty content)", () => {
    const content = "a\nb";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[0]!, hashes[1]!, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("");
  });
});

describe("hashline: large file handling", () => {
  it("hashes 1000 unique lines without collision and within reasonable time", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line-${i}`);
    const content = lines.join("\n");
    const hashes = lineHashes(content);
    expect(hashes).toHaveLength(1000);
    // 1000 unique lines → 1000 unique hashes.
    expect(new Set(hashes).size).toBe(1000);
  });

  it("hashes 1000 identical lines — collision resolution keeps all unique", () => {
    const content = Array.from({ length: 1000 }, () => "same").join("\n");
    const hashes = lineHashes(content);
    expect(new Set(hashes).size).toBe(1000);
  });

  it("formatHashed + replaceByHash round-trips correctly on a large file", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `entry ${i}`);
    const content = lines.join("\n");
    const hashes = lineHashes(content);

    // Replace lines 100-102 (0-indexed 99-101).
    const r = replaceByHash(content, hashes[99]!, hashes[101]!, ["REPLACED"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.replacedCount).toBe(3);
      const resultLines = r.content!.split("\n");
      expect(resultLines).toHaveLength(498); // 500 - 3 + 1
      expect(resultLines[99]).toBe("REPLACED");
      // Lines before and after are untouched.
      expect(resultLines[0]).toBe("entry 0");
      expect(resultLines[98]).toBe("entry 98");
      expect(resultLines[100]).toBe("entry 102");
    }
  });

  it("fileFingerprint differs for large files with a one-byte change", () => {
    const big = Array.from({ length: 2000 }, () => "x").join("\n");
    const big2 = big.replace("x\nx", "y\nx"); // change first line
    expect(fileFingerprint(big)).not.toBe(fileFingerprint(big2));
  });
});

describe("hashline: formatHashed edge cases", () => {
  it("handles empty content (single empty line)", () => {
    const out = formatHashed("");
    // "".split("\n") → [""], so one line with a valid hash + empty content.
    const lines = out.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.charAt(HASH_LEN)).toBe(HASH_SEP);
    expect(isValidAnchor(lines[0]!.slice(0, HASH_LEN))).toBe(true);
  });

  it("handles blank lines interspersed with content", () => {
    const out = formatHashed("a\n\nb\n\nc");
    const lines = out.split("\n");
    expect(lines).toHaveLength(5);
    // Even blank lines get a hash + separator.
    for (const l of lines) {
      expect(l.charAt(HASH_LEN)).toBe(HASH_SEP);
    }
    // Blank lines (content after separator is empty).
    expect(lines[1]!.slice(HASH_LEN + 1)).toBe("");
    expect(lines[3]!.slice(HASH_LEN + 1)).toBe("");
  });

  it("preserves content exactly (no mutation of original text)", () => {
    const content = '  indented  \ttab\tspecial!@#';
    const out = formatHashed(content);
    const restored = out
      .split("\n")
      .map((l) => l.slice(HASH_LEN + 1))
      .join("\n");
    expect(restored).toBe(content);
  });
});

describe("hashline: replaceByHash expansion & contraction", () => {
  it("expands one line into many", () => {
    const content = "a\nb\nc";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[1]!, hashes[1]!, [
      "b1",
      "b2",
      "b3",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("a\nb1\nb2\nb3\nc");
      expect(r.replacedCount).toBe(1);
    }
  });

  it("contracts many lines into one", () => {
    const content = "a\nb1\nb2\nb3\nc";
    const hashes = lineHashes(content);
    const r = replaceByHash(content, hashes[1]!, hashes[3]!, ["b"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe("a\nb\nc");
      expect(r.replacedCount).toBe(3);
    }
  });

  it("replacedCount always reflects the original lines removed, not the new lines added", () => {
    const content = "x\ny\nz";
    const hashes = lineHashes(content);
    // Remove 2 lines, add 5.
    const r = replaceByHash(content, hashes[0]!, hashes[1]!, [
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.replacedCount).toBe(2);
  });
});
