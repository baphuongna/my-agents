/**
 * Phase 26: path containment helpers for slash commands (security review fix).
 *
 * Three slash commands can produce I/O on user-controlled paths:
 *   /export  writes a transcript file
 *   /import  reads a transcript file
 *   /tree    walks a directory
 * /config writes to ~/.my-agent/config.toml.
 *
 * To prevent path traversal (security findings F3+F4), every path-touching
 * command resolves the user-supplied path with realpath() and verifies that
 * the resolved absolute path is a prefix-match inside the allowed root
 * (the session cwd for /export and /tree; cwd OR ~/.my-agent for /import).
 * Symlinks are resolved by realpath; the check is on the resolved path.
 */
import { realpath, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Contain `candidate` (relative or absolute) inside `root`. Returns the resolved
 * absolute path string, or null if it escapes.
 *
 * The candidate may reference the root itself (`/export .` → root). Traversal
 * (`/export ../../etc/passwd`) is rejected by the strict-prefix check.
 *
 * If the directory does not yet exist, the parent's realpath is used
 * (a/b/c where b doesn't exist → resolve a/b and verify).
 */
export async function containPath(candidate: string, root: string): Promise<string | null> {
  if (!candidate) return null;
  // Reject shell metacharacters that would change resolution semantics.
  if (/[\x00\n\r]/.test(candidate)) return null;
  // Resolve symlinks + canonicalize both root and candidate.
  const absRoot = await resolveDir(root);
  if (!absRoot) return null;
  const absCandidate = await resolveDir(join(absRoot, candidate));
  if (!absCandidate) return null;
  // Strict prefix: the candidate must START WITH root + "/", or equal root.
  const rootWithSep = absRoot.endsWith("/") ? absRoot : absRoot + "/";
  if (absCandidate === absRoot) return absCandidate;
  if (absCandidate.startsWith(rootWithSep)) return absCandidate;
  return null;
}

/**
 * Read containment: candidate must already exist (it must be a file we want
 * to read) and resolve inside one of the allowed roots.
 */
export async function containExistingPath(
  candidate: string,
  allowedRoots: string[],
): Promise<string | null> {
  if (!candidate || /\x00/.test(candidate)) return null;
  const absCandidate = await realpath(candidate).catch(() => null);
  if (!absCandidate) return null;
  // Must be an existing regular file (not a directory).
  const s = await stat(absCandidate).catch(() => null);
  if (!s || !s.isFile()) return null;
  for (const root of allowedRoots) {
    const absRoot = await resolveDir(root).catch(() => null);
    if (!absRoot) continue;
    if (absCandidate === absRoot) return absCandidate;
    const rootWithSep = absRoot.endsWith("/") ? absRoot : absRoot + "/";
    if (absCandidate.startsWith(rootWithSep)) return absCandidate;
  }
  return null;
}

/** Compute an absolute, symlink-resolved directory path. */
async function resolveDir(p: string): Promise<string | null> {
  if (!p) return null;
  // For new directories: stat() throws ENOENT; realpath() requires existence.
  // We walk parent-by-parent until we find an ancestor that exists.
  let cur = p;
  if (!cur.startsWith("/")) cur = join(process.cwd(), cur);
  if (!cur.startsWith("/")) return null; // path-relative to a non-existent cwd is rejectable
  // Try realpath on the full path first.
  const r = await realpath(cur).catch(async () => {
    // Path doesn't exist — resolve the deepest existing ancestor and append.
    const parent = dirname(cur);
    if (parent === cur) return null; // at filesystem root, nothing left to resolve
    const rp = await resolveDir(parent);
    return rp ? join(rp, cur.substring(parent.length + 1)) : null;
  });
  return r;
}

/** The default allow-list for read-side paths: cwd + ~/.my-agent. */
export function defaultReadRoots(cwd: string): string[] {
  return [cwd, join(homedir(), ".my-agent")];
}
