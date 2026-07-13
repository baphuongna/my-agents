/**
 * Path-safety resolver (§7 completeness — MyAgents path_safety.rs).
 *
 * Two resolution modes:
 *   - resolveInsideWorkspace (WRITE): LEXICAL only — never touches the disk, so
 *     a TOCTOU symlink swap can't bypass it. Rejects `..` traversal + absolute
 *     escapes. Used by write/edit/replace.
 *   - resolveExistingInsideWorkspace (READ): CANONICALIZES (realpath) then checks
 *     the canonical path is inside the workspace — blocks symlink escapes to
 *     files outside the workspace on READ. Used by read/glob/grep.
 *
 * The asymmetry is deliberate: writes use lexical (no disk trust), reads use
 * canonical (resolve symlinks to existing files but stay bounded).
 *
 * Source: §7 Tools completeness; MyAgents workspace_files/path_safety.rs.
 */
import { resolve, normalize, sep, isAbsolute, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";

export type ResolveMode = "write" | "read";

export type ResolveResult =
  | { ok: true; abs: string }
  | { ok: false; reason: "traversal" | "absolute-escape" | "symlink-escape" | "outside-workspace"; detail: string };

function posixNormalize(p: string): string {
  // normalize collapses `..`/`.` lexically; we then check no `..` remains after
  // normalization against the workspace root.
  return normalize(p).split(sep).join("/");
}

/** Lexical write resolver: never touches disk. Rejects `..` traversal + escapes. */
export function resolveInsideWorkspace(path: string, workspace: string): ResolveResult {
  const ws = resolve(workspace);
  const abs = resolve(ws, path);
  const rel = posixNormalize(abs.slice(ws.length));
  if (isAbsolute(path) && !abs.startsWith(ws)) {
    return { ok: false, reason: "absolute-escape", detail: `absolute path escapes workspace: ${path}` };
  }
  if (rel.startsWith("../") || rel === ".." || rel.includes("/../") || rel.startsWith("..")) {
    return { ok: false, reason: "traversal", detail: `path traverses outside workspace: ${path}` };
  }
  // final belt: the resolved abs must be within ws
  if (abs !== ws && !abs.startsWith(ws + sep) && !abs.startsWith(ws + "/")) {
    return { ok: false, reason: "outside-workspace", detail: `resolved outside workspace: ${abs}` };
  }
  // F5 (security review): a pre-existing symlinked DIRECTORY inside the
  // workspace (e.g. ws/evil -> /etc) would let a write escape via the lexical
  // check above. Canonicalize the parent dir (which must exist) + re-bound.
  // Skip when abs IS the workspace root (parent is naturally outside ws).
  if (abs !== ws) {
    try {
      const parent = dirname(abs);
      if (existsSync(parent)) {
        const realParent = realpathSync(parent);
        const wsReal = existsSync(ws) ? realpathSync(ws) : ws;
        if (realParent !== wsReal && !realParent.startsWith(wsReal + sep) && !realParent.startsWith(wsReal + "/")) {
          return { ok: false, reason: "symlink-escape", detail: `parent dir symlink escapes workspace: ${path} → ${realParent}` };
        }
      }
    } catch {
      // parent doesn't exist yet (new file in a new dir) — the lexical check stands.
    }
  }
  return { ok: true, abs };
}

/** Canonical read resolver: realpaths then bounds. Blocks symlink escapes. */
export function resolveExistingInsideWorkspace(path: string, workspace: string): ResolveResult {
  const ws = resolve(workspace);
  // first lexically bound the input (cheap pre-check)
  const lex = resolveInsideWorkspace(path, workspace);
  if (!lex.ok) return lex;
  // then canonicalize the resolved path (file must exist for realpath)
  let real: string;
  try {
    real = realpathSync(lex.abs);
  } catch {
    // file doesn't exist yet (read before write) — fall back to the lexical result
    return lex;
  }
  // the canonical path must still be inside the canonical workspace
  let wsReal: string;
  try {
    wsReal = realpathSync(ws);
  } catch {
    wsReal = ws;
  }
  if (real !== wsReal && !real.startsWith(wsReal + sep) && !real.startsWith(wsReal + "/")) {
    return { ok: false, reason: "symlink-escape", detail: `symlink escapes workspace: ${path} → ${real}` };
  }
  return { ok: true, abs: real };
}

/** Convenience: is `path` safely inside `workspace` for the given mode? */
export function isInsideWorkspace(path: string, workspace: string, mode: ResolveMode = "write"): boolean {
  const r = mode === "write" ? resolveInsideWorkspace(path, workspace) : resolveExistingInsideWorkspace(path, workspace);
  return r.ok;
}
