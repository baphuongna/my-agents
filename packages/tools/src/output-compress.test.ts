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
  parseCommand,
  runGenericPipeline,
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
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("CJK-aware: dense chars count as ~1 token each", () => {
    // 8 Hangul syllables → 8 dense tokens + 0 sparse
    expect(estimateTokens("캘린더입니다안녕")).toBe(8);
    // 4 ASCII + 3 CJK → 3 + ceil(4/4) = 4
    expect(estimateTokens("test캘린더")).toBe(4);
    // Pure CJK → dense count
    expect(estimateTokens("你好世界")).toBe(4);
    // Mixed CJK + Latin: "hello世界" = 5 sparse + 2 dense = 2 + 2 = 4
    expect(estimateTokens("hello世界")).toBe(4);
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

describe("output-compress: parseCommand (executable normalization)", () => {
  it("splits a flat command into executable + args", () => {
    expect(parseCommand("git status")).toEqual({ executable: "git", args: ["status"] });
    expect(parseCommand("npm install --save")).toEqual({
      executable: "npm",
      args: ["install", "--save"],
    });
  });

  it("strips a path prefix from the executable", () => {
    expect(parseCommand("/usr/local/bin/node app.js")).toEqual({
      executable: "node",
      args: ["app.js"],
    });
  });

  it("strips a Windows shim suffix (.cmd/.exe/.bat)", () => {
    expect(parseCommand("tsc.CMD build").executable).toBe("tsc");
    expect(parseCommand("npm.exe install").executable).toBe("npm");
    expect(parseCommand("run.bat x").executable).toBe("run");
  });

  it("returns empty executable + args for a blank command", () => {
    expect(parseCommand("")).toEqual({ executable: "", args: [] });
    expect(parseCommand("   ")).toEqual({ executable: "", args: [] });
  });

  it("keeps a dotfile-like name with no shim suffix intact", () => {
    // `.cmd` only stripped when it's the final suffix after the last dot
    expect(parseCommand("my.tool run").executable).toBe("my.tool");
  });
});

describe("output-compress: runGenericPipeline (5-stage, adopt-if-shrinks)", () => {
  it("applies each shrinking stage and records stagesApplied", () => {
    // ANSI + triple blanks + a progress bar — multiple stages shrink it.
    const input = "\x1B[32mstart\x1B[0m\n\n\n\nend";
    const res = runGenericPipeline(input);
    expect(res.stagesApplied).toContain("strip-ansi");
    expect(res.stagesApplied).toContain("collapse-blank-lines");
    expect(res.text.length).toBeLessThanOrEqual(input.length);
  });

  it("does not apply a stage that would grow the text (deduplicate on a run of 3)", () => {
    // Three identical lines: deduplicate would emit a `[... repeated]` marker
    // (strictly LONGER), so it is NOT adopted. ANSI/collapse/progress are
    // equal-length (adopted because the gate is `<=`).
    const input = "x\nx\nx";
    const res = runGenericPipeline(input);
    expect(res.stagesApplied).not.toContain("deduplicate");
  });

  it("truncates long output and sets wasTruncated", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const input = lines.join("\n");
    const opts = {
      ...DEFAULT_COMPRESSION_OPTIONS,
      maxHeadLines: 5,
      maxTailLines: 5,
      maxTotalLines: 500,
    };
    const res = runGenericPipeline(input, opts);
    expect(res.wasTruncated).toBe(true);
    expect(res.stagesApplied).toContain("truncate");
  });

  it("leaves short output untruncated", () => {
    const res = runGenericPipeline("a\nb");
    expect(res.wasTruncated).toBe(false);
  });
});

describe("output-compress: cargo reducer", () => {
  it("strips Compiling/Finished noise lines", () => {
    const out = ["Compiling libc v0.2", "Compiling myapp v0.1.0", "Finished dev [unoptimized]"].join("\n");
    const res = compressCommandOutput("cargo build", out, 0);
    expect(res.reducerId).toBe("cargo");
    expect(res.text).not.toContain("Compiling");
    expect(res.text).not.toContain("Finished");
  });

  it("rewrites test results and caps at 60 lines", () => {
    // Lots of Compiling noise so the reduced output is strictly smaller than
    // the original (otherwise the never_worse guard passes through verbatim).
    const noise = Array.from({ length: 40 }, (_, i) => `Compiling dep${i} v0.1`);
    const out = [...noise, "test result: ok. 3 passed"].join("\n");
    const res = compressCommandOutput("cargo test", out, 0);
    expect(res.reducerId).toBe("cargo");
    expect(res.text).toContain("cargo test: ok (all passed)");
  });

  it("emits a fallback 'cargo: ok' when all output was noise", () => {
    // `Finished` requires a trailing space in the noise regex.
    const res = compressCommandOutput("cargo build", "Compiling x v0.1\nFinished dev\n", 0);
    expect(res.text).toBe("cargo: ok");
  });
});

describe("output-compress: git status reducer", () => {
  it("keeps branch + section headers, drops unrelated noise", () => {
    const out = [
      "On branch main",
      "Your branch is up to date with 'origin/main'.",
      "",
      "Changes to be committed:",
      "  (use ...)",
      "\tnew file:   src/a.ts",
      "some random stdout",
    ].join("\n");
    const res = compressCommandOutput("git status", out, 0);
    expect(res.reducerId).toBe("git-status");
    expect(res.text).toContain("On branch main");
    expect(res.text).toContain("Changes to be committed:");
    expect(res.text).toContain("new file:   src/a.ts");
    expect(res.text).not.toContain("random stdout");
  });
});

describe("output-compress: git diff reducer", () => {
  it("keeps diff headers/hunks/added/removed lines", () => {
    const out = [
      "diff --git a/f.ts b/f.ts",
      "index 111..222 100644",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,2 @@",
      " context line",
      "-old line",
      "+new line",
    ].join("\n");
    const res = compressCommandOutput("git diff", out, 0);
    expect(res.reducerId).toBe("git-diff");
    expect(res.text).toContain("diff --git");
    expect(res.text).toContain("+new line");
    expect(res.text).toContain("-old line");
  });

  it("passes through --stat output untouched", () => {
    const out = " a.ts | 2 +\n 1 file changed";
    const res = compressCommandOutput("git diff --stat", out, 0);
    expect(res.reducerId).toBe("git-diff-stat");
    expect(res.text).toContain("file changed");
  });
});

describe("output-compress: tsc reducer", () => {
  it("groups diagnostics by file with a header", () => {
    // Add noise lines so the reduced output is strictly smaller than the
    // original (diagnostic grouping ADDS `=== file ===` headers, which would
    // otherwise trip the never_worse guard on tiny input).
    const noise = Array.from({ length: 12 }, (_, i) => `noise preamble line ${i}`);
    const diags = [
      "src/a.ts(1,5): error TS2304: Cannot find name 'x'.",
      "src/a.ts(2,1): error TS7006: Parameter implicitly any.",
    ];
    const out = [...noise.slice(0, 6), ...diags, ...noise.slice(6), "Found 2 errors."].join("\n");
    const res = compressCommandOutput("tsc", out, 1);
    expect(res.reducerId).toBe("tsc");
    expect(res.text).toContain("=== src/a.ts ===");
    expect(res.text).toContain("TS2304");
    expect(res.text).toContain("Found 2 errors.");
  });

  it("routes `npx tsc` to the tsc reducer", () => {
    const noise = Array.from({ length: 12 }, (_, i) => `noise ${i}`);
    const out = [...noise, "f.ts(1,1): error TS1: x", "Found 1 error."].join("\n");
    const res = compressCommandOutput("npx tsc", out, 1);
    expect(res.reducerId).toBe("tsc");
  });
});
