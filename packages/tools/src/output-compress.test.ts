/**
 * Output compression tests (8 tests) — covers the 5 generic pipeline stages,
 * ImportantLineClassifier (5 regexes), truncation, and the git/npm reducers.
 *
 * Source of truth: hypa `Hypa.Infrastructure/Compression/*` + `Reducers/*`.
 */

import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  collapseBlankLines,
  filterProgress,
  deduplicate,
  truncate,
  isImportantLine,
  compressCommandOutput,
  estimateTokens,
  DEFAULT_COMPRESSION_OPTIONS,
} from "./output-compress.js";

describe("output-compress: stripAnsi", () => {
  it("removes color and OSC escape sequences", () => {
    const input = "\x1B[32mgreen\x1B[0m \x1B]0;title\x07text";
    expect(stripAnsi(input)).toBe("green text");
    // no residual ESC bytes
    expect(stripAnsi(input)).not.toContain("\x1B");
  });
});

describe("output-compress: collapseBlankLines", () => {
  it("collapses 3+ consecutive newlines to exactly two", () => {
    const input = "a\n\n\n\n\nb";
    expect(collapseBlankLines(input)).toBe("a\n\nb");
    // CRLF variants collapse too
    expect(collapseBlankLines("x\r\n\r\n\r\ny")).toBe("x\n\ny");
  });
});

describe("output-compress: filterProgress", () => {
  it("removes progress bars / spinners but keeps normal text", () => {
    const input = [
      "Building...",
      "[==========>          ] 50%",
      "⠋",
      "done",
    ].join("\n");
    const out = filterProgress(input);
    expect(out).toContain("Building...");
    expect(out).toContain("done");
    expect(out).not.toContain("50%");
    expect(out).not.toContain("⠋");
  });
});

describe("output-compress: deduplicate", () => {
  it("collapses runs >=3 to a repeated marker, keeps pairs verbatim", () => {
    const input = ["same", "same", "same", "same", "same"].join("\n");
    const out = deduplicate(input);
    // 5-run → 1 line + marker
    expect(out).toBe("same\n[... repeated 4 times]");
    // a run of exactly 2 keeps both lines
    expect(deduplicate(["a", "a"].join("\n"))).toBe("a\na");
  });
});

describe("output-compress: isImportantLine (5 regexes)", () => {
  it("flags error keywords, file:line, HTTP 4xx/5xx, Warning, compiler ids", () => {
    expect(isImportantLine("something failed here")).toBe(true);
    expect(isImportantLine("src/app.ts:42: cannot find name")).toBe(true);
    expect(isImportantLine("request returned 503")).toBe(true);
    expect(isImportantLine("Warning: eviction pressure")).toBe(true);
    expect(isImportantLine("error TS2307: Cannot find module")).toBe(true);
    // non-important lines are not flagged
    expect(isImportantLine("everything looks fine here")).toBe(false);
    expect(isImportantLine("running normally 123")).toBe(false);
  });
});

describe("output-compress: truncate", () => {
  it("keeps head+tail and preserves important middle lines with a marker", () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) lines.push(`line ${i}`);
    // plant a safety-relevant line deep in the dropped middle
    lines[300] = "error TS9999: boom";
    const input = lines.join("\n");
    const opts = { ...DEFAULT_COMPRESSION_OPTIONS, maxHeadLines: 10, maxTailLines: 10, maxTotalLines: 500 };
    const res = truncate(input, opts);
    expect(res.wasTruncated).toBe(true);
    expect(res.text).toContain("line 0");
    expect(res.text).toContain("line 599");
    expect(res.text).toContain("lines omitted");
    expect(res.text).toContain("safety-relevant lines preserved");
    // the important line from the middle survives
    expect(res.text).toContain("error TS9999: boom");
  });

  it("leaves short output untouched", () => {
    const res = truncate("a\nb\nc", DEFAULT_COMPRESSION_OPTIONS);
    expect(res.wasTruncated).toBe(false);
    expect(res.text).toBe("a\nb\nc");
  });
});

describe("output-compress: git log reducer", () => {
  it("keeps commit hash / author / date / subject, drops body", () => {
    const output = [
      "commit aabbccdd11223344 (HEAD -> main)",
      "Author: Alice <alice@example.com>",
      "Date:   Mon Jan 1 12:00:00 2024",
      "",
      "    fix: handle null in parser",
      "",
      "    Long body paragraph that should be dropped",
      "    because it is not the subject line.",
      "",
      "commit eeff001122334455",
      "Author: Bob <bob@example.com>",
      "Date:   Sun Dec 31 09:00:00 2023",
      "",
      "    feat: add output compression",
    ].join("\n");
    const res = compressCommandOutput("git log", output, 0);
    expect(res.reducerId).toBe("git-log");
    expect(res.text).toContain("commit aabbccdd11223344");
    expect(res.text).toContain("Author: Alice");
    expect(res.text).toContain("Date:");
    expect(res.text).toContain("fix: handle null in parser");
    expect(res.text).toContain("feat: add output compression");
    // body paragraphs are dropped
    expect(res.text).not.toContain("Long body paragraph");
  });
});

describe("output-compress: npm reducer", () => {
  it("passes through small successful output, reduces error output", () => {
    // exit 0 + tiny output → passthrough, untouched
    const ok = compressCommandOutput("npm test", "all good\n", 0);
    expect(ok.reducerId).toBe("passthrough");
    expect(ok.text).toBe("all good");

    // exit 1 + error lines → only errors/summary kept.
    // NOTE: the summary regex (packages|dependencies).*(added|...) requires
    // "packages" BEFORE "added", so we use that ordering here (faithful to
    // the C# IsInstallSummaryLine).
    const failing = [
      "3 packages added in 2s",
      "npm warn deprecated foo",
      "> mya@1.0.0 test",
      "> vitest run",
      "some random stdout line",
      "npm error something broke",
    ].join("\n");
    const res = compressCommandOutput("npm install", failing, 1);
    expect(res.reducerId).toBe("pkg-manager");
    expect(res.text).toContain("npm error something broke");
    expect(res.text).toContain("npm warn deprecated foo");
    expect(res.text).toContain("3 packages added in 2s");
    // noise stdout line is dropped
    expect(res.text).not.toContain("random stdout line");
    // tokens went down
    expect(res.compressedTokens).toBeLessThan(res.originalTokens);
  });

  it("estimates tokens as chars/4 (min 1)", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("output-compress: never_worse guard (S3)", () => {
  // The guard guarantees compression NEVER makes output larger. Verified as a
  // property across reducers: compressedTokens <= originalTokens always.
  it("compressedTokens never exceeds originalTokens", () => {
    const cases = [
      { cmd: "git status", out: "M file.ts\n", exit: 0 },
      { cmd: "git log", out: "commit abcdef\nAuthor: X\nDate: Y\n\n    msg\n", exit: 0 },
      { cmd: "npm test", out: "all good\n", exit: 0 },
      { cmd: "npm install", out: "added 1 package\n", exit: 0 },
      { cmd: "echo hi", out: "hi\n", exit: 0 },
      { cmd: "tsc", out: "file.ts(1,1): error TS1: x\n", exit: 1 },
      { cmd: "cargo build", out: "Compiling x v0.1\nFinished\n", exit: 0 },
      // already-minimal generic input (no blanks/ANSI/dups to strip)
      { cmd: "cat file", out: "unique line one\nunique line two\n", exit: 0 },
    ];
    for (const { cmd, out, exit } of cases) {
      const res = compressCommandOutput(cmd, out, exit);
      expect(
        res.compressedTokens,
        `${cmd} → ${res.reducerId}: ${res.compressedTokens} should be <= ${res.originalTokens}`,
      ).toBeLessThanOrEqual(res.originalTokens);
    }
  });
});
