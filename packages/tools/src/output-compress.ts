/**
 * Output compression — reduce verbose command output before feeding it to an LLM
 * (source: hypa `Hypa.Infrastructure/Compression/*` + `Reducers/*`).
 *
 * A 5-stage generic pipeline (ANSI strip → blank collapse → progress filter →
 * dedup → truncation) plus structured "tool reducers" (git/tsc/npm/cargo) that
 * understand the shape of a specific command's output. `compressCommandOutput`
 * selects the first reducer that claims the command, else falls back to the
 * generic pipeline.
 *
 * Token estimate = max(1, len/4) (source: `CharDivTokenCounter.cs`).
 *
 * Faithful port note: the C# `Compress` API takes a parsed `CommandInvocation`
 * + separate stdout/stderr. This module exposes a flat `compressCommandOutput`
 * (cmd string, combined output, exitCode) and parses `cmd` into
 * { executable, args } internally.
 */

// ---------------------------------------------------------------------------
// Token counter — CJK-aware (source: Hermes agent/model_metadata.py)
// ---------------------------------------------------------------------------

// CJK codepoint ranges where each character ≈ 1 token under common tokenizers.
// Mirrors Hermes _CJK_DENSE_RE (13 ranges from native/fts5_cjk/fts5_cjk.c).
const _CJK_DENSE_RE =
  /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/**
 * CJK-aware rough token estimate for pre-flight / display.
 *
 * - Pure ASCII fast path: `(len + 3) >> 2` (~4 chars/token). O(n) but no
 *   regex — the vast majority of tool output is ASCII.
 * - CJK-dense characters (Hangul, Han, Kana, fullwidth) count as ~1
 *   token each because common LLM tokenizers fragment them more finely.
 * - Remaining non-CJK characters use the ~4 chars/token rule.
 *
 * Ported from Hermes `estimate_tokens_rough()` (deep-dive-r2.md §1.8).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Fast path: pure ASCII (no CJK, no regex scan needed).
  if (/^[\x00-\x7f]*$/.test(text)) {
    return Math.max(1, (text.length + 3) >> 2);
  }
  const matches = text.match(_CJK_DENSE_RE);
  const dense = matches ? matches.length : 0;
  if (!dense) {
    // Non-ASCII but no CJK (accents, Cyrillic, emoji): keep ~4 chars/token.
    return Math.max(1, (text.length + 3) >> 2);
  }
  const sparse = text.length - dense;
  return dense + ((sparse + 3) >> 2);
}

// ---------------------------------------------------------------------------
// Options & result — source: CompressionOptions.cs / CompressionResult.cs
// ---------------------------------------------------------------------------

export interface CompressionOptions {
  /** Lines kept from the top when truncating (default 80). */
  maxHeadLines: number;
  /** Lines kept from the bottom when truncating (default 80). */
  maxTailLines: number;
  /** Total lines above which truncation kicks in (default 500). */
  maxTotalLines: number;
  /** Output ≤ this many tokens + exit 0 skips reduction for pkg managers (default 50). */
  smallOutputThreshold: number;
}

export const DEFAULT_COMPRESSION_OPTIONS: CompressionOptions = {
  maxHeadLines: 80,
  maxTailLines: 80,
  maxTotalLines: 500,
  smallOutputThreshold: 50,
};

export interface CompressionResult {
  text: string;
  originalTokens: number;
  compressedTokens: number;
  reducerId: string;
  stagesApplied: string[];
  wasTruncated: boolean;
}

// ---------------------------------------------------------------------------
// ImportantLineClassifier — source: ImportantLineClassifier.cs (5 regexes)
// ---------------------------------------------------------------------------

// Note: the Kubernetes "Warning" matcher is intentionally case-SENSITIVE
// (matches the C# `\bWarning\b` without IgnoreCase), while the error keyword
// matcher is case-insensitive.
const RE_ERROR = /\b(error|failed|exception|warning|fatal|panic)\b/i;
const RE_FILE_DIAG = /\w+\.\w+:\d+:/;
const RE_HTTP_4XX5XX = /\b[45]\d{2}\b/;
const RE_K8S_WARN = /\bWarning\b/;
const RE_COMPILER_ID = /\b[A-Z]{2,4}\d{3,5}\b/;

/** True if a line is safety-relevant (error / file:line / HTTP 4xx-5xx / Warning / compiler id). */
export function isImportantLine(line: string): boolean {
  return (
    RE_ERROR.test(line) ||
    RE_FILE_DIAG.test(line) ||
    RE_HTTP_4XX5XX.test(line) ||
    RE_K8S_WARN.test(line) ||
    RE_COMPILER_ID.test(line)
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — AnsiStrip (source: AnsiStripStage.cs)
// ---------------------------------------------------------------------------

const RE_ANSI =
  /\x1B\[[0-9;]*[mGKHFJABCDEFfnsuhl]|\x1B\][^\x07]*\x07|\x1B[()][\w)]/g;

/** Strip ANSI escape sequences (colors, cursor moves, OSC titles). */
export function stripAnsi(text: string): string {
  return text.replace(RE_ANSI, "");
}

// ---------------------------------------------------------------------------
// Stage 2 — BlankLineCollapse (source: BlankLineCollapseStage.cs)
// ---------------------------------------------------------------------------

const RE_BLANK_RUN = /(\r?\n){3,}/g;

/** Collapse 3+ consecutive newlines down to exactly two (one blank line). */
export function collapseBlankLines(text: string): string {
  return text.replace(RE_BLANK_RUN, "\n\n");
}

// ---------------------------------------------------------------------------
// Stage 3 — ProgressFilter (source: ProgressFilterStage.cs)
// ---------------------------------------------------------------------------

const RE_PROGRESS_BAR = /^[^\S\r\n]*[\[=\->\] %#|.]+[0-9]*[%]?[^\S\r\n]*$/;
// Braille spinner glyphs U+2800–U+28FF plus the explicit set used by hypa.
const RE_SPINNER_ONLY = /^[⠀-⣿⠏⠋⠙⠹⠸⠼⠴⠦⠧⠇\s]*$/;

function isProgressBarLine(line: string): boolean {
  if (!RE_PROGRESS_BAR.test(line)) return false;
  const trimmed = line.trim();
  if (trimmed.length < 5) return false;
  return (
    trimmed.includes("%") ||
    trimmed.includes("=") ||
    trimmed.includes(">") ||
    trimmed.includes("#") ||
    trimmed.includes("|")
  );
}

/**
 * Remove progress bars and spinner frames. Lines terminated with `\r` (terminal
 * carriage-return overwrites) are dropped when their content is a progress/spinner
 * frame, otherwise kept verbatim with the trailing `\r`.
 */
export function filterProgress(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.endsWith("\r")) {
      const content = line.replace(/\r+$/, "");
      if (isProgressBarLine(content) || (RE_SPINNER_ONLY.test(content) && content.trim().length > 0)) {
        continue;
      }
      out.push(line);
      continue;
    }
    if (isProgressBarLine(line)) continue;
    if (RE_SPINNER_ONLY.test(line) && line.trim().length > 0) continue;
    out.push(line);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 4 — Deduplicate (source: DeduplicateStage.cs)
// ---------------------------------------------------------------------------

/**
 * Run-length encode consecutive identical lines. A run of ≥3 collapses to one
 * line + `[... repeated {n-1} times]`; a run of 2 keeps both lines verbatim.
 */
export function deduplicate(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = lines[i]!;
    let run = 1;
    while (i + run < lines.length && lines[i + run] === current) run++;
    out.push(current);
    if (run >= 3) {
      out.push(`[... repeated ${run - 1} times]`);
    } else if (run === 2) {
      out.push(current);
    }
    i += run;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 5 — Truncation (source: TruncationStage.cs)
// ---------------------------------------------------------------------------

export interface TruncationResult {
  text: string;
  wasTruncated: boolean;
}

/**
 * If output exceeds `maxTotalLines`, keep the head + tail verbatim and preserve
 * any `isImportantLine` matches from the omitted middle, separated by a marker.
 */
export function truncate(
  text: string,
  options: CompressionOptions = DEFAULT_COMPRESSION_OPTIONS,
): TruncationResult {
  const lines = text.split("\n");
  if (lines.length <= options.maxTotalLines) {
    return { text, wasTruncated: false };
  }
  const head = lines.slice(0, options.maxHeadLines);
  const tail = lines.slice(Math.max(0, lines.length - options.maxTailLines));
  const middleStart = options.maxHeadLines;
  const middleEnd = lines.length - options.maxTailLines;
  const important: string[] = [];
  for (let i = middleStart; i < middleEnd; i++) {
    const line = lines[i]!;
    if (isImportantLine(line)) important.push(line);
  }
  const omitted = Math.max(0, middleEnd - middleStart - important.length);
  const marker = `[${omitted} lines omitted, ${important.length} safety-relevant lines preserved]`;
  return {
    text: [...head, marker, ...important, ...tail].join("\n"),
    wasTruncated: true,
  };
}

// ---------------------------------------------------------------------------
// Generic pipeline — source: GenericOutputCompressor.cs
// ---------------------------------------------------------------------------

/** A named, pure stage used by the generic pipeline. */
interface Stage {
  id: string;
  apply: (text: string) => string;
}

const GENERIC_STAGES: readonly Stage[] = [
  { id: "strip-ansi", apply: stripAnsi },
  { id: "collapse-blank-lines", apply: collapseBlankLines },
  { id: "filter-progress", apply: filterProgress },
  { id: "deduplicate", apply: deduplicate },
];

/** Run the 5-stage generic pipeline (each stage only adopted if it shrinks). */
export function runGenericPipeline(
  text: string,
  options: CompressionOptions = DEFAULT_COMPRESSION_OPTIONS,
): { text: string; stagesApplied: string[]; wasTruncated: boolean } {
  let cur = text;
  const stagesApplied: string[] = [];
  for (const stage of GENERIC_STAGES) {
    const next = stage.apply(cur);
    if (next.length <= cur.length) {
      cur = next;
      stagesApplied.push(stage.id);
    }
  }
  const trunc = truncate(cur, options);
  if (trunc.text.length <= cur.length) {
    cur = trunc.text;
    stagesApplied.push("truncate");
  }
  return { text: cur, stagesApplied, wasTruncated: trunc.wasTruncated };
}

// ---------------------------------------------------------------------------
// Command parsing — derives { executable, args } from the flat cmd string
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  executable: string;
  args: string[];
}

/**
 * Parse a flat command string into a normalized executable + args. The
 * executable has its path prefix and Windows shim suffix (`.cmd/.exe/.bat`)
 * stripped, mirroring the C# `PackageManagerOutputCompressor.CanHandle`
 * normalization.
 */
export function parseCommand(cmd: string): ParsedCommand {
  const parts = cmd.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return { executable: "", args: [] };
  const raw = parts[0]!;
  const args = parts.slice(1);
  let executable = raw;
  const sep = Math.max(executable.lastIndexOf("/"), executable.lastIndexOf("\\"));
  if (sep >= 0) executable = executable.slice(sep + 1);
  const dot = executable.lastIndexOf(".");
  if (dot > 0 && /\.(cmd|exe|bat)$/i.test(executable.slice(dot))) {
    executable = executable.slice(0, dot);
  }
  return { executable, args };
}

// ---------------------------------------------------------------------------
// Reducer: git — source: GitOutputCompressor.cs (status / diff / log)
// ---------------------------------------------------------------------------

const GIT_STATUS_PATTERNS = [
  /^On branch |^HEAD detached/,
  /^Your branch (is ahead|is behind|and .* have diverged)/,
  /^You have unmerged paths|^both modified:/,
  /^\t\S/,
  /^(Changes to be committed:|Changes not staged for commit:|Untracked files:)/,
];

const RE_GIT_DIFF_HEADER = /^diff --git /;
const RE_GIT_FILE_LINE = /^(--- a\/|\+\+\+ b\/)/;
const RE_GIT_HUNK = /^@@/;
const RE_GIT_ADDED = /^\+/;
const RE_GIT_REMOVED = /^-/;
const RE_GIT_COMMIT = /^commit [0-9a-f]{7,40}/;
const RE_GIT_AUTHOR = /^Author:/;
const RE_GIT_DATE = /^Date:/;

function compressGitStatus(combined: string): CompressionResult {
  const originalTokens = estimateTokens(combined);
  const kept: string[] = [];
  for (const line of combined.split("\n")) {
    if (GIT_STATUS_PATTERNS.some((re) => re.test(line))) kept.push(line);
  }
  let text = kept.join("\n").trimEnd();
  if (text.length === 0) text = combined.trimEnd();
  return {
    text,
    originalTokens,
    compressedTokens: estimateTokens(text),
    reducerId: "git-status",
    stagesApplied: ["parse-status"],
    wasTruncated: false,
  };
}

function compressGitDiff(combined: string, args: string[]): CompressionResult {
  const originalTokens = estimateTokens(combined);
  if (args.includes("--stat")) {
    return {
      text: combined.trimEnd(),
      originalTokens,
      compressedTokens: estimateTokens(combined.trimEnd()),
      reducerId: "git-diff-stat",
      stagesApplied: [],
      wasTruncated: false,
    };
  }
  const lines = combined.split("\n");
  const dropContext = lines.length > 150;
  const kept: string[] = [];
  for (const line of lines) {
    if (
      RE_GIT_DIFF_HEADER.test(line) ||
      RE_GIT_FILE_LINE.test(line) ||
      RE_GIT_HUNK.test(line) ||
      RE_GIT_ADDED.test(line) ||
      RE_GIT_REMOVED.test(line)
    ) {
      kept.push(line);
    } else if (!dropContext) {
      kept.push(line);
    }
  }
  const text = kept.join("\n").trimEnd();
  return {
    text,
    originalTokens,
    compressedTokens: estimateTokens(text),
    reducerId: "git-diff",
    stagesApplied: ["parse-diff"],
    wasTruncated: dropContext,
  };
}

function compressGitLog(combined: string): CompressionResult {
  const originalTokens = estimateTokens(combined);
  const lines = combined.split("\n");
  const kept: string[] = [];
  let inHeader = false;
  let seenBlankAfterDate = false;
  let subjectCaptured = false;
  for (const line of lines) {
    if (RE_GIT_COMMIT.test(line)) {
      kept.push(line);
      inHeader = true;
      seenBlankAfterDate = false;
      subjectCaptured = false;
      continue;
    }
    if (!inHeader) continue;
    if (RE_GIT_AUTHOR.test(line) || RE_GIT_DATE.test(line)) {
      kept.push(line);
      continue;
    }
    if (line.trim().length === 0 && !seenBlankAfterDate) {
      seenBlankAfterDate = true;
      continue;
    }
    if (seenBlankAfterDate && !subjectCaptured && line.trim().length > 0) {
      kept.push(line);
      subjectCaptured = true;
      continue;
    }
  }
  let text = kept.join("\n").trimEnd();
  if (text.length === 0) text = combined.trimEnd();
  return {
    text,
    originalTokens,
    compressedTokens: estimateTokens(text),
    reducerId: "git-log",
    stagesApplied: ["parse-log"],
    wasTruncated: false,
  };
}

function compressGit(combined: string, args: string[]): CompressionResult {
  const sub = args[0] ?? "";
  if (sub === "status") return compressGitStatus(combined);
  if (sub === "diff") return compressGitDiff(combined, args);
  if (sub === "log") return compressGitLog(combined);
  // Should not happen (CanHandle gates subcommands), but stay safe.
  return compressGitStatus(combined);
}

// ---------------------------------------------------------------------------
// Reducer: tsc — source: TscOutputCompressor.cs
// ---------------------------------------------------------------------------

const RE_TSC_DIAG = /^(.+)\(\d+,\d+\):\s+(error|warning)\s+TS\d+:/i;
const RE_TSC_SUMMARY = /^Found \d+ error/i;
const RE_TSC_CONTINUATION = /^\s{2,}/;

function compressTsc(combined: string): CompressionResult {
  const originalTokens = estimateTokens(combined);
  const lines = combined.split("\n");
  const kept: string[] = [];
  let lastFile: string | null = null;
  let prevWasDiagnostic = false;
  for (const line of lines) {
    const m = RE_TSC_DIAG.exec(line);
    if (m) {
      const file = m[1]!;
      if (file !== lastFile) {
        kept.push(`=== ${file} ===`);
        lastFile = file;
      }
      kept.push(line);
      prevWasDiagnostic = true;
      continue;
    }
    if (RE_TSC_SUMMARY.test(line)) {
      kept.push(line);
      prevWasDiagnostic = false;
      continue;
    }
    if (prevWasDiagnostic && RE_TSC_CONTINUATION.test(line)) {
      kept.push(line);
      continue;
    }
    prevWasDiagnostic = false;
  }
  let text = kept.join("\n").trimEnd();
  if (text.length === 0) text = combined.trimEnd();
  return {
    text,
    originalTokens,
    compressedTokens: estimateTokens(text),
    reducerId: "tsc",
    stagesApplied: ["parse-diagnostics"],
    wasTruncated: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer: package manager — source: PackageManagerOutputCompressor.cs
// ---------------------------------------------------------------------------

const RE_PKG_ERROR =
  /(^|\s)(npm (ERR!|error|warn)|ERR_PNPM|pnpm ERR!|Error:|error |warning |hint:)/i;
const RE_PKG_PEER = /\bpeer\b.*(conflict|unmet|incompatible)/i;
const RE_PKG_SUMMARY = /(packages|dependencies).*(added|removed|updated|installed)/i;

function compressPackageManager(
  combined: string,
  exitCode: number,
  options: CompressionOptions,
): CompressionResult {
  const originalTokens = estimateTokens(combined);
  if (exitCode === 0 && originalTokens <= options.smallOutputThreshold) {
    const text = combined.trimEnd();
    return {
      text,
      originalTokens,
      compressedTokens: originalTokens,
      reducerId: "passthrough",
      stagesApplied: [],
      wasTruncated: false,
    };
  }
  const kept: string[] = [];
  for (const line of combined.split("\n")) {
    if (RE_PKG_ERROR.test(line) || RE_PKG_PEER.test(line) || RE_PKG_SUMMARY.test(line)) {
      kept.push(line);
    }
  }
  let text = kept.join("\n").trimEnd();
  if (text.length === 0) text = combined.trimEnd();
  return {
    text,
    originalTokens,
    compressedTokens: estimateTokens(text),
    reducerId: "pkg-manager",
    stagesApplied: ["parse-errors"],
    wasTruncated: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer: cargo — derived from BuiltInFilters.cs "cargo" filter DSL
// (hypa has no CargoOutputCompressor; this ports the filter stages.)
// ---------------------------------------------------------------------------

const RE_CARGO_NOISE =
  /^\s*Compiling |^\s*Downloading |^\s*Fetching |^\s*Updating |^\s*Blocking |^\s*Finished |^\s*Fresh |^\s*Locking |^\s*$/;
const CARGO_MAX_LINES = 60;

function compressCargo(combined: string): CompressionResult {
  const originalTokens = estimateTokens(combined);
  // Stage: strip-ansi
  let text = stripAnsi(combined);
  const stagesApplied = ["strip-ansi"];
  // Stage: strip-noise lines
  const kept = text.split("\n").filter((line) => !RE_CARGO_NOISE.test(line));
  stagesApplied.push("strip-noise");
  // Stage: replace test result
  const replaced = kept.map((line) =>
    line.replace("test result: ok", "cargo test: ok (all passed)"),
  );
  stagesApplied.push("replace-test-result");
  // Stage: max-lines
  let wasTruncated = false;
  let finalLines = replaced;
  if (finalLines.length > CARGO_MAX_LINES) {
    finalLines = finalLines.slice(0, CARGO_MAX_LINES);
    wasTruncated = true;
  }
  stagesApplied.push("max-lines");
  // Stage: on-empty
  let result = finalLines.join("\n").trimEnd();
  if (result.length === 0) result = "cargo: ok";
  return {
    text: result,
    originalTokens,
    compressedTokens: estimateTokens(result),
    reducerId: "cargo",
    stagesApplied,
    wasTruncated,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher — source: CompressService.cs (first CanHandle() wins, else generic)
// ---------------------------------------------------------------------------

/**
 * Compress command output. Selects the first tool reducer that claims `cmd`
 * (git/tsc/npm-pnpm-yarn/cargo); otherwise runs the 5-stage generic pipeline.
 */
export function compressCommandOutput(
  cmd: string,
  output: string,
  exitCode: number,
 options?: Partial<CompressionOptions>,
): CompressionResult {
  const opts: CompressionOptions = { ...DEFAULT_COMPRESSION_OPTIONS, ...options };
  const originalTokens = estimateTokens(output);
  const { executable, args } = parseCommand(cmd);
  const exe = executable.toLowerCase();

  let result: CompressionResult;
  // git status|diff|log
  if (exe === "git" && ["status", "diff", "log"].includes(args[0] ?? "")) {
    result = compressGit(output, args);
  } else if (exe === "tsc" || (exe === "npx" && (args[0] ?? "") === "tsc")) {
    // tsc / npx tsc
    result = compressTsc(output);
  } else if (exe === "npm" || exe === "pnpm" || exe === "yarn") {
    // npm / pnpm / yarn (case-insensitive, per CanHandle)
    result = compressPackageManager(output, exitCode, opts);
  } else if (exe === "cargo") {
    result = compressCargo(output);
  } else {
    // generic fallback — 5-stage pipeline
    const pipeline = runGenericPipeline(output, opts);
    result = {
      text: pipeline.text,
      originalTokens,
      compressedTokens: estimateTokens(pipeline.text),
      reducerId: "generic",
      stagesApplied: pipeline.stagesApplied,
      wasTruncated: pipeline.wasTruncated,
    };
  }

  // S3 never_worse guard (rtk pattern): only apply compression if it actually
  // SAVES tokens; if a reducer's output is STRICTLY larger (it added overhead),
  // passthrough the original verbatim. Equal-token output (e.g. an intentional
  // small-output passthrough, or a same-length reformat) is left as-is — not worse.
  if (result.compressedTokens > originalTokens) {
    return {
      text: output,
      originalTokens,
      compressedTokens: originalTokens,
      reducerId: "never_worse_passthrough",
      stagesApplied: [],
      wasTruncated: false,
    };
  }
  return result;
}
