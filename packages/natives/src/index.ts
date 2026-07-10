/**
 * @my-agent/natives — TS bridge to the Rust engine, with graceful JS fallback.
 *
 * Pit-of-success: the agent works whether or not the prebuilt `.node` binary is
 * present. If the native loads, callers get BLAKE3 (trust boundary) + native
 * glob/grep (hot loop). If not, a pure-JS fallback keeps everything functional
 * (SHA-256 via node:crypto instead of BLAKE3; a tiny walker instead of the
 * Rust walkdir). Consumers should NOT branch on `isNativeAvailable` — just call
 * `nativeHash`/`nativeGlob`/`nativeGrep`/`nativeMac` and get correct results
 * either way.
 *
 * Rust-gate justification lives in crates/natives/src/lib.rs (AGENTS.md §2).
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const requireFrom = createRequire(import.meta.url);

// ─── native binary resolution ───────────────────────────────────────────────

/** Compute the napi-rs platform triple (e.g. "linux-x64-gnu"). */
function platformTriple(): string {
  const p = process.platform;
  const arch = process.arch;
  if (p === "win32") return `win32-${arch}-msvc`;
  if (p === "darwin") return `darwin-${arch}`;
  // linux: detect libc (gnu vs musl) via a heuristic
  const libc = (() => {
    try {
      // musl systems: process.report or a known check. Cheap heuristic: if
      // /lib/ld-musl-* exists it's musl, else gnu.
      if (existsSync("/lib") && readdirSync("/lib").some((f) => f.startsWith("ld-musl"))) {
        return "musl";
      }
    } catch {
      /* ignore */
    }
    return "gnu";
  })();
  return `linux-${arch}-${libc}`;
}

/** The compiled native module (or null if unavailable). */
type NativeModule = {
  hashContent: (input: Buffer) => string;
  blake3Mac: (key: Buffer, message: Buffer) => string;
  glob: (pattern: string, root: string, options?: object) => string[];
  grep: (pattern: string, root: string, options?: object) => GrepHit[];
  compressLog: (input: string, options?: object) => CompressLogResult;
  approxTokens: (input: string) => number;
  nowMonotonicNanos: () => number;
  nowWallclockNanos: () => number;
  nativesVersion: () => string;
};

function resolveNative(): NativeModule | null {
  const triple = platformTriple();
  const binaryName = `natives.${triple}.node`;
  // Candidate locations (dev build output + production node_modules layouts).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: packages/natives/dist → ../../../crates/natives/<binary> (repo root)
    join(here, "..", "..", "..", "crates", "natives", binaryName),
    // dev fallback: resolved from process cwd
    join(process.cwd(), "crates", "natives", binaryName),
    // production: @my-agent/natives package ships the binary next to the loader
    join(here, binaryName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        // createRequire lets ESM load a CommonJS .node addon.
        const loaded = requireFrom(candidate) as NativeModule;
        if (loaded && typeof loaded.hashContent === "function") {
          return loaded;
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

const NATIVE = (() => {
  try {
    return resolveNative();
  } catch {
    return null;
  }
})();

/** Whether the Rust native is loaded (for diagnostics/logging only). */
export const isNativeAvailable = NATIVE !== null;

/** The natives semver stamp (or "js-fallback"). */
export function nativesVersion(): string {
  return NATIVE ? NATIVE.nativesVersion() : "js-fallback";
}

// ─── public API ─────────────────────────────────────────────────────────────

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface CompressLogOptions {
  maxLineLen?: number;
  collapseRun?: number;
}
export interface CompressLogResult {
  text: string;
  originalLines: number;
  compressedLines: number;
}

export interface GlobOptions {
  maxResults?: number;
  includeHidden?: boolean;
}
export interface GrepOptions {
  maxResults?: number;
  caseInsensitive?: boolean;
  includeHidden?: boolean;
}

/**
 * Byte-faithful content hash.
 * Native: BLAKE3 (64 hex). Fallback: SHA-256 (64 hex).
 * Both are 64-hex; consumers should treat the value as opaque + stable per build.
 */
export function nativeHash(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  if (NATIVE) return NATIVE.hashContent(buf);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Keyed MAC for signing.
 * Native: keyed BLAKE3. Fallback: HMAC-SHA256.
 * Same key+message → same MAC within a build; do NOT compare across native/fallback.
 */
export function nativeMac(key: Buffer | string, message: Buffer | string): string {
  const k = typeof key === "string" ? Buffer.from(key) : key;
  const m = typeof message === "string" ? Buffer.from(message) : message;
  // Empty key → unkeyed hash (degenerate but safe). Native + fallback agree.
  if (k.length === 0) return nativeHash(m);
  if (NATIVE) return NATIVE.blake3Mac(k, m);
  return createHmac("sha256", k).update(m).digest("hex");
}

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", ".next", ".crew"]);

/** Glob match files in `root`. Returns [] on any failure (invalid pattern,
 * missing dir, native error) — consistent with nativeGrep. */
export function nativeGlob(pattern: string, root: string, options: GlobOptions = {}): string[] {
  if (NATIVE) {
    try {
      return NATIVE.glob(pattern, root, options);
    } catch {
      return [];
    }
  }
  return jsGlob(pattern, root, options);
}

/** Grep file contents for a regex. Returns [] on invalid regex (consistent
 * across native + JS fallback). */
export function nativeGrep(
  pattern: string,
  root: string,
  options: GrepOptions = {},
): GrepHit[] {
  if (NATIVE) {
    try {
      return NATIVE.grep(pattern, root, options);
    } catch {
      return [];
    }
  }
  return jsGrep(pattern, root, options);
}

/** Content-aware log/tool-output compactor (§5/§2 Rust gate). Native = Rust
 * (deterministic); fallback = a JS impl with identical semantics. */
export function nativeCompressLog(input: string, options: CompressLogOptions = {}): CompressLogResult {
  if (NATIVE) {
    try {
      return NATIVE.compressLog(input, options);
    } catch {
      // fall through to JS
    }
  }
  return jsCompressLog(input, options);
}

/** Approximate token count (chars/4). Native = Rust; fallback = JS. */
export function nativeApproxTokens(input: string): number {
  if (NATIVE) {
    try {
      return NATIVE.approxTokens(input);
    } catch {
      // fall through
    }
  }
  return Math.floor([...input].length / 4);
}

// ─── third-party native verification (§14b / §17 / invariant #6-resolution) ────

/** A declared third-party napi binary's expected identity (from the package
 * manifest `native` field, §17). */
export interface NativeDeclaration {
  /** Path to the `.node` file. */
  path: string;
  /** Expected SHA-256 (hex) of the file bytes — pinned in the release lockfile. */
  contentHash: string;
  /** sigstore bundle present? (the signature itself is verified by sigstore
   * tooling at release time; here we assert its presence + that content matches.) */
  sigstore: boolean;
  /** Optional napi ABI stamp (compatibility guard, NOT security per §14b). */
  abiStamp?: string;
}

export type NativeVerifyResult =
  | { ok: true; contentHash: string }
  | { ok: false; reason: "file-missing" | "hash-mismatch" | "sigstore-required"; detail: string };

/** Verify a third-party `.node` BEFORE dlopen (§14b RELEASE-BLOCKER for
 * third-party native). Real checks: file exists + SHA-256 content-hash matches.
 * sigstore: asserted REQUIRED (the cryptographic signature verification itself
 * is performed by release-time sigstore tooling; this gate refuses any native
 * that does not declare sigstore:true). First-party natives (our own) are
 * exempt — they ship from the trusted release pipeline. */
export function verifyNativeDeclaration(decl: NativeDeclaration): NativeVerifyResult {
  let bytes: Buffer;
  try {
    bytes = readFileSync(decl.path);
  } catch {
    return { ok: false, reason: "file-missing", detail: `cannot read ${decl.path}` };
  }
  if (!decl.sigstore) {
    return {
      ok: false,
      reason: "sigstore-required",
      detail: "third-party native must declare sigstore:true (§14b release-blocker)",
    };
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== decl.contentHash.toLowerCase()) {
    return {
      ok: false,
      reason: "hash-mismatch",
      detail: `expected ${decl.contentHash}, got ${actual}`,
    };
  }
  return { ok: true, contentHash: actual };
}

// ─── JS fallbacks (used only when the .node is missing) ─────────────────────

function* walk(
  root: string,
  includeHidden: boolean,
): Generator<string> {
  let stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (!includeHidden && name.startsWith(".") && name !== "." && name !== "..") continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        stack.push(join(dir, name));
      } else if (ent.isFile()) {
        yield relative(root, join(dir, name)).split(sep).join("/");
      }
    }
  }
}

/** Convert a glob pattern (with `*`/`**`) to a RegExp. Minimal but correct. */
function globToRegex(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      // ** = any path (incl /), * = any non-/
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++; // consume the trailing /
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.+?()[]{}|".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

function jsGlob(pattern: string, root: string, options: GlobOptions): string[] {
  const max = options.maxResults ?? 10_000;
  const includeHidden = options.includeHidden ?? false;
  const re = globToRegex(pattern);
  const out: string[] = [];
  for (const rel of walk(root, includeHidden)) {
    if (re.test(rel)) {
      out.push(rel);
      if (out.length >= max) break;
    }
  }
  out.sort();
  return out;
}

function jsGrep(pattern: string, root: string, options: GrepOptions): GrepHit[] {
  const max = options.maxResults ?? 1000;
  const includeHidden = options.includeHidden ?? false;
  let re: RegExp;
  try {
    re = new RegExp(pattern, options.caseInsensitive ? "i" : "");
  } catch {
    return [];
  }
  const out: GrepHit[] = [];
  for (const rel of walk(root, includeHidden)) {
    if (out.length >= max) break;
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, rel));
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue; // skip binary
    const text = bytes.toString("utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        out.push({ path: rel, line: i + 1, text: lines[i]! });
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

/** JS fallback for compress_log — mirrors the Rust semantics (truncate long lines
 * + collapse runs of identical consecutive lines). Deterministic. */
function jsCompressLog(input: string, options: CompressLogOptions): CompressLogResult {
  const maxLineLen = options.maxLineLen ?? 200;
  const collapseRun = options.collapseRun ?? 3;
  const lines = input.split("\n");
  const originalLines = lines.length;
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i]!;
    let run = 1;
    while (i + run < lines.length && lines[i + run] === cur) run++;
    const truncated = cur.length > maxLineLen ? cur.slice(0, maxLineLen) + "…" : cur;
    if (run >= collapseRun) {
      out.push(truncated);
      out.push(`… (${run} repeated)`);
    } else {
      for (let k = 0; k < run; k++) out.push(truncated);
    }
    i += run;
  }
  return { text: out.join("\n"), originalLines, compressedLines: out.length };
}
