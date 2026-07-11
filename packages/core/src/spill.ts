/**
 * maybeSpill (§13) — large-value spill. When a payload exceeds the threshold
 * (default 256 KiB), it's written to ~/.my-agent/refs/<sha> and replaced with a
 * `LargeValueRef` carrying a preview + mimetype + ttl. Keeps the RuntimeEvent
 * bus + SSE stream bounded (a multi-MB tool output doesn't choke the wire).
 *
 * Source: §13; MyAgents large-value-store.
 *
 * Review-driven hardening (Phase-7 round):
 *   - resolveRef: path containment via realpath + sha-equality + byte-hash check
 *     (CRITICAL-1 forged-ref arbitrary-file-read).
 *   - No bare require() (CRITICAL-2 ESM runtime crash); top-level imports only.
 *   - TTL sidecar (.ttl) actually written + swept (HIGH-1).
 *   - Preview is a SAFE length/hash hint, never raw bytes (HIGH-2 secret leak).
 *   - MAX_SPILL_BYTES cap + JSON.stringify try/catch (HIGH-3 OOM, MEDIUM-3 crash).
 *   - resolveRef verifies sha256(bytes) === sha-from-filename (HIGH-4 integrity).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nowWallclock } from "./time.js";

const DEFAULT_THRESHOLD = 256 * 1024; // 256 KiB (spec)
const MAX_SPILL_BYTES = 64 * 1024 * 1024; // 64 MiB hard cap (a value this big is a bug, not a spill)
const DEFAULT_TTL_S = 24 * 3600; // 1 day

export interface LargeValueRef {
  /** Marker so consumers can distinguish a spilled ref from an inline value. */
  readonly spilled: true;
  /** Safe hint: byte count + length of the textual head (never raw bytes — review HIGH-2). */
  readonly hint: string;
  readonly mimetype: string;
  /** Absolute path to the spilled file (~/.my-agent/refs/<sha>). */
  readonly refPath: string;
  /** Unix-ms expiry (drives sweepRefs). */
  readonly expiresAt: number;
  readonly bytes: number;
  /** The sha used to derive refPath; resolveRef verifies bytes still hash to it. */
  readonly sha: string;
}

export type MaybeSpilled<T> = T | LargeValueRef;

/** Where the spilled refs live. Defaults to ~/.my-agent/refs (user-owned). */
function refsRoot(): string {
  return process.env.MY_AGENT_REFS_DIR ?? join(homedir(), ".my-agent", "refs");
}

/** Guess a mimetype from a value (text default; JSON for objects). */
function mimetypeOf(v: unknown): string {
  if (typeof v === "string") return "text/plain";
  if (v && typeof v === "object") return "application/json";
  return "application/octet-stream";
}

/** Safely serialize a value to a string for spilling. Returns null on circulars
 * / BigInt / etc. Caller should treat null as "non-serializable; refuse to spill". */
function safeSerialize(v: unknown): string | null {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

/** Produce a SAFE preview hint: sha256-prefix of head bytes + length. */
function safeHint(head: string, totalBytes: number, mimetype: string): string {
  const sha = createHash("sha256").update(head, "utf8").digest("hex").slice(0, 12);
  return `<ref mimetype=${mimetype} bytes=${totalBytes} sha=${sha}…>`;
}

/**
 * If `value` serializes to > threshold bytes (and ≤ MAX_SPILL_BYTES), spill it
 * to disk + return a LargeValueRef. Identical values dedupe via the content-
 * derived sha. Above the cap, refuse and return a TRUNCATED value inline
 * (the wire-bound premise is already violated). On serialization failure
 * (circular/BigInt), also returns the raw value (the ref isn't useful for
 * non-serializable input).
 */
export function maybeSpill<T>(value: T, opts: { threshold?: number; ttlS?: number; max?: number } = {}): MaybeSpilled<T> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const maxBytes = opts.max ?? MAX_SPILL_BYTES;
  const serialized = safeSerialize(value);
  if (serialized === null) return value; // non-serializable → keep inline
  const byteLen = Buffer.byteLength(serialized, "utf8");
  if (byteLen <= threshold) return value;
  if (byteLen > maxBytes) {
    return `[TRUNCATED: original=${byteLen} bytes exceeds MAX_SPILL_BYTES ${maxBytes}]` as unknown as MaybeSpilled<T>;
  }
  const sha = createHash("sha256").update(serialized).digest("hex");
  const dir = refsRoot();
  const refPath = join(dir, sha);
  const ttlFile = `${refPath}.ttl`;
  if (!existsSync(refPath)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(refPath, serialized, { mode: 0o600 });
  }
  // TTL sidecar — sweepRefs actually sweeps now (review HIGH-1 fix).
  const expiresAt = nowWallclock() + (opts.ttlS ?? DEFAULT_TTL_S) * 1000;
  writeFileSync(ttlFile, String(expiresAt), { mode: 0o600 });
  // Safe hint — never the raw serialized head (review HIGH-2 fix: secrets leak).
  const ref: LargeValueRef = {
    spilled: true,
    hint: safeHint(serialized, byteLen, mimetypeOf(value)),
    mimetype: mimetypeOf(value),
    refPath,
    expiresAt,
    bytes: byteLen,
    sha,
  };
  return ref;
}

/** Resolve a LargeValueRef back to its content (string). Containment-checked:
 * the refPath must canonicalize to join(refsRoot(), sha) AND the bytes must
 * hash to sha. A forged ref (CRITICAL-1 attack: refPath="/etc/passwd") is
 * rejected: it can't canonicalize to the refsRoot path, and even if the
 * attacker symlinks it, the byte-hash check fails. */
export function resolveRef(ref: LargeValueRef): string {
  // Containment: refPath must canonicalize to inside refsRoot.
  const dir = process.env.MY_AGENT_REFS_DIR ?? join(homedir(), ".my-agent", "refs");
  const expected = join(dir, ref.sha);
  const canonRef = realpathSync(ref.refPath);
  const canonDir = realpathSync(dir);
  if (canonRef !== join(canonDir, ref.sha)) {
    throw new Error(`spill.resolveRef: path containment violated (ref escapes refsRoot)`);
  }
  if (!existsSync(canonRef)) throw new Error(`spill.resolveRef: file gone: ${canonRef}`);
  const stat = statSync(canonRef);
  if (!stat.isFile()) throw new Error(`spill.resolveRef: not a regular file: ${canonRef}`);
  const bytes = readFileSync(canonRef);
  // Integrity: bytes must hash to the expected sha (catches swap / truncation).
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== ref.sha) throw new Error(`spill.resolveRef: integrity check failed (hash mismatch)`);
  return bytes.toString("utf8");
}

/** Delete expired ref files (reads the <sha>.ttl sidecar). Returns count swept. */
export function sweepRefs(now = nowWallclock()): number {
  const dir = refsRoot();
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ttl")) continue;
    const ttlFile = join(dir, name);
    const refFile = join(dir, name.slice(0, -".ttl".length));
    try {
      const expires = Number.parseInt(readFileSync(ttlFile, "utf8"), 10);
      if (Number.isFinite(expires) && now > expires) {
        rmSync(refFile, { force: true });
        rmSync(ttlFile, { force: true });
        n++;
      }
    } catch { /* best-effort: skip unreadable sidecar */ }
  }
  return n;
}
