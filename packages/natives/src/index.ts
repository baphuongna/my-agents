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
      // Native throws on invalid regex (guarded → napi Error). Normalize to []
      // so the contract matches the JS fallback. Callers grep defensively.
      return [];
    }
  }
  return jsGrep(pattern, root, options);
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
