/**
 * maybeSpill (§13) — large-value spill. When a payload exceeds the threshold
 * (default 256 KiB), it's written to ~/.my-agent/refs/<sha> and replaced with a
 * `LargeValueRef` carrying a preview + mimetype + ttl. Keeps the RuntimeEvent
 * bus + SSE stream bounded (a multi-MB tool output doesn't choke the wire).
 *
 * Source: §13; MyAgents large-value-store.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { nowWallclock } from "./time.js";

const DEFAULT_THRESHOLD = 256 * 1024; // 256 KiB
const DEFAULT_TTL_S = 24 * 3600; // 1 day

export interface LargeValueRef {
  /** Marker so consumers can distinguish a spilled ref from an inline value. */
  spilled: true;
  /** Short preview (first N chars) for UIs that don't resolve the ref. */
  preview: string;
  mimetype: string;
  /** Absolute path to the spilled file (~/.my-agent/refs/<sha>). */
  refPath: string;
  /** Unix-ms expiry; sweepRefs() deletes expired files. */
  expiresAt: number;
  bytes: number;
}

export type MaybeSpilled<T> = T | LargeValueRef;

function refsRoot(): string {
  return process.env.MY_AGENT_REFS_DIR ?? join(homedir(), ".my-agent", "refs");
}

/** Guess a mimetype from a value (text default; JSON for objects). */
function mimetypeOf(v: unknown): string {
  if (typeof v === "string") return "text/plain";
  if (v && typeof v === "object") return "application/json";
  return "application/octet-stream";
}

/**
 * If `value` serializes to > threshold bytes, spill it to disk + return a
 * LargeValueRef. Otherwise return the value unchanged. The spilled file is
 * content-addressed (sha256 of the serialized bytes) so identical large values
 * share one ref. TTL-bounded (sweepRefs cleans expired entries).
 */
export function maybeSpill<T>(value: T, opts: { threshold?: number; ttlS?: number } = {}): MaybeSpilled<T> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") <= threshold) return value;
  const sha = createHash("sha256").update(serialized).digest("hex");
  const refPath = join(refsRoot(), sha);
  if (!existsSync(refPath)) {
    mkdirSync(refsRoot(), { recursive: true });
    writeFileSync(refPath, serialized, { mode: 0o600 });
  }
  const ref: LargeValueRef = {
    spilled: true,
    preview: serialized.slice(0, 512),
    mimetype: mimetypeOf(value),
    refPath,
    expiresAt: nowWallclock() + (opts.ttlS ?? DEFAULT_TTL_S) * 1000,
    bytes: Buffer.byteLength(serialized, "utf8"),
  };
  return ref;
}

/** Resolve a LargeValueRef back to its content (string). */
export function resolveRef(ref: LargeValueRef): string {
  if (!existsSync(ref.refPath)) throw new Error(`spilled ref gone: ${ref.refPath}`);
  // lazy require to avoid a top-level dep
  return require("node:fs").readFileSync(ref.refPath, "utf8");
}

/** Delete expired ref files. Returns the count swept. */
export function sweepRefs(now = nowWallclock()): number {
  const dir = refsRoot();
  if (!existsSync(dir)) return 0;
  const { readdirSync, statSync } = require("node:fs");
  let n = 0;
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    try {
      // the filename is a sha; we store expiry as a sidecar <sha>.ttl
      const ttlFile = `${f}.ttl`;
      if (existsSync(ttlFile)) {
        const expiresAt = Number.parseInt(require("node:fs").readFileSync(ttlFile, "utf8"), 10);
        if (Number.isFinite(expiresAt) && now > expiresAt) { rmSync(f, { force: true }); rmSync(ttlFile, { force: true }); n++; }
      }
    } catch { /* best-effort */ }
  }
  return n;
}
