/**
 * Phase 26: path containment helpers for slash commands (security review fix).
 * Phase 26 follow-up: hardening against symlink attacks.
 *
 * Three slash commands can produce I/O on user-controlled paths:
 *   /export  writes a transcript file
 *   /import  reads a transcript file
 *   /tree    walks a directory
 * /config writes to ~/.my-agent/config.toml.
 *
 * Threat model + defenses (all enforced via these helpers):
 *   - Path traversal: realpath the candidate (and root) then strict prefix check
 *     with separator. Reject embedded newlines / NUL / CR.
 *   - Final-component symlink: stat() the candidate's containing dir for any
 *     existing component and reject if any leaf is a symlink (dangles too).
 *     The caller writes through temp + rename for atomic, deny-symlink semantics.
 *   - Read-root escape: require allowed roots (cwd + ~/.my-agent) to be real
 *     directories, not symlinks (prevents `~/.my-agent → /etc` from bypassing
 *     the allow-list).
 */
import { realpath, stat, lstat } from "node:fs/promises";
import { join, dirname, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";

/** Strict contains: `inner` must be `outer` itself, or descend from `outer + sep`. */
function strictlyContains(outer: string, inner: string): boolean {
  if (inner === outer) return true;
  const outerWithSep = outer.endsWith(sep) ? outer : outer + sep;
  return inner.startsWith(outerWithSep);
}

/**
 * Contain `candidate` (relative or absolute) inside `root`. Returns the resolved
 * absolute path string, or null if it escapes.
 *
 *   /export ../../etc/passwd          → null  (traversal)
 *   /export secret.md                 → /cwd/secret.md
 *   /export /abs/path                  → rejected if not contained in root
 *
 * Any existing component in the final path must NOT be a symlink (Phase 26
 * hardening). If the path doesn't exist yet (target is a not-yet-created
 * file), we walk parent-by-parent and check components that DO exist.
 */
export async function containPath(candidate: string, root: string): Promise<string | null> {
  if (!candidate) return null;
  if (/[\x00\n\r]/.test(candidate)) return null;

  const absRoot = await resolveDir(root);
  if (!absRoot) return null;

  // F3-2 fix: if the candidate is absolute, use it directly (don't join() to root
  // — that would re-root it inside). The containment check still applies.
  const absCandidate = isAbsolute(candidate)
    ? await resolveDir(candidate)
    : await resolveDir(join(absRoot, candidate));
  if (!absCandidate) return null;
  if (!strictlyContains(absRoot, absCandidate)) return null;

  // F3-1 fix: reject any existing component of the candidate's parent that
  // is a symlink. The final leaf may be a not-yet-existing file (we have to
  // create it) — that's OK; the writer must not follow a pre-existing
  // symlink at the leaf either, so we check the leaf separately below.
  if (await pathHasSymlinkComponent(absCandidate)) return null;

  return absCandidate;
}

/**
 * Read containment: candidate must already exist (it must be a file we want
 * to read) and resolve inside one of the allowed roots. Symlinks must NOT
 * redirect outside the allowed root (the realpath check catches this).
 *
 * Also requires each allowed root to be a real directory (not a symlink)
 * — otherwise `~/.my-agent → /etc` would let `/etc/passwd` pass.
 */
export async function containExistingPath(
  candidate: string,
  allowedRoots: string[],
): Promise<string | null> {
  if (!candidate || /\x00/.test(candidate)) return null;
  const absCandidate = await realpath(candidate).catch(() => null);
  if (!absCandidate) return null;
  const s = await stat(absCandidate).catch(() => null);
  if (!s || !s.isFile()) return null;

  for (const root of allowedRoots) {
    const absRoot = await resolveRootNoSymlinks(root);
    if (!absRoot) continue;
    if (!strictlyContains(absRoot, absCandidate)) return null;
    return absCandidate;
  }
  return null;
}

/**
 * Resolve a root path (cwd or ~/.my-agent) so we can compare it to candidates.
 * Rejects symlinked roots — only real directories can act as policy roots.
 *
 * Returns null if the root is a symlink or otherwise unresolvable.
 */
async function resolveRootNoSymlinks(p: string): Promise<string | null> {
  // Resolve symlinks first.
  const real = await realpath(p).catch(() => null);
  if (!real) return null;
  // Then verify the resolved path is NOT itself a symlink (= same as its own lstat).
  const ls = await lstat(p).catch(() => null);
  if (!ls) return null;
  if (ls.isSymbolicLink()) return null; // caller passed a symlink → reject
  return real;
}

/** Compute an absolute, symlink-resolved directory path. Walks up if the path
 * doesn't exist yet (handles `a/b/c.txt` where `a/b` doesn't exist). */
async function resolveDir(p: string): Promise<string | null> {
  if (!p) return null;
  let cur = isAbsolute(p) ? p : join(process.cwd(), p);
  return await realpath(cur).catch(async () => {
    // Path doesn't exist — resolve the deepest existing ancestor and append.
    const parent = dirname(cur);
    if (parent === cur) return null;
    const rp = await resolveDir(parent);
    return rp ? join(rp, cur.substring(parent.length + 1)) : null;
  });
}

/** Return true if any existing component of `p` is a symlink. The final leaf
 * itself counts (a pre-existing symlink at the leaf is a write escape). */
async function pathHasSymlinkComponent(p: string): Promise<boolean> {
  // Walk parent-by-parent from the root until we find a component that
  // DOES exist; we know the deepest existing ancestor is contained. From
  // there, walk forward checking every existing component for a symlink.
  const parts = p.split(sep);
  let cur: string = sep; // start at filesystem root
  for (const part of parts) {
    if (!part) continue;
    cur = cur === sep ? `/${part}` : `${cur}${sep}${part}`;
    const ls = await lstat(cur).catch(() => null);
    if (ls && ls.isSymbolicLink()) return true;
  }
  return false;
}

/** The default allow-list for read-side paths: cwd + ~/.my-agent (real dirs only). */
export function defaultReadRoots(cwd: string): Promise<string[]> {
  return (async () => {
    const out: string[] = [];
    const realCwd = await resolveRootNoSymlinks(cwd);
    if (realCwd) out.push(realCwd);
    const realHome = await resolveRootNoSymlinks(join(homedir(), ".my-agent"));
    if (realHome) out.push(realHome);
    return out;
  })();
}
