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
