/**
 * CoW overlay isolation (§10) — tier-2 file-copy fallback.
 *
 * The SPEC names 5 backends (overlayfs / reflink_apfs / btrfs / zfs / git_worktree).
 * Real overlay/reflink requires kernel/filesystem support; this Tier ships a
 * portable FILE-COPY fallback that gives the same ISOLATION semantics
 * (changes happen in a sandbox dir, changedPaths diff + 3-way merge-back).
 *
 * Production deployments on Linux can swap to overlayfs via a Rust native
 * (out of scope here). The interface stays the same so the swap is a drop-in.
 *
 * Source: §10 CoW-overlay-isolated subagents, oh-my-pi task.
 */
import { mkdtempSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, basename, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export type IsoBackend = "file_copy" | "overlayfs" | "reflink_apfs" | "btrfs" | "zfs" | "git_worktree";

export interface ConflictError {
  path: string;
  baseContent: string | null;
  childContent: string;
  parentContent: string | null;
}
export type MergeResult =
  | { ok: true; merged: string[]; added: string[] }
  | { ok: false; conflicts: ConflictError[]; merged: string[] };

export interface IsolatedWorkspace {
  /** The sandboxed root (changes happen here). */
  readonly root: string;
  /** The base (read-only) the sandbox was copied from. */
  readonly base: string;
  /** The backend in use. */
  readonly backend: IsoBackend;
  /** List of files changed (relative to base). Filled by `diff()`. */
  changedPaths(): string[];
  /** Compute changed files (paths whose content differs from base). */
  diff(): string[];
  /** §10.2: 3-way merge the sandbox changes into `parentRoot`, using `base` as
   * the common ancestor. Returns {ok, merged} or {ok:false, conflicts}. A path
   * changed on BOTH sides (and differing) is a ConflictError (never silently
   * clobbers). New child files are added; deletions are not propagated (Tier-1). */
  mergeBack(parentRoot: string): MergeResult;
  /** Apply a child edit (writes to sandbox root). */
  write(relPath: string, content: string): void;
  /** Read a file (from sandbox if changed, else base). */
  read(relPath: string): string | null;
  /** Cleanup the sandbox (always run, even on crash). */
  cleanup(): void;
}

/**
 * Create an isolated workspace. Tier 2 ships `file_copy` (portable); the
 * other backends are reserved for future native swap-in.
 */
export function createIsolatedWorkspace(
  base: string,
  opts: { backend?: IsoBackend; tmpRoot?: string } = {},
): IsolatedWorkspace {
  const backend: IsoBackend = opts.backend ?? "file_copy";
  const tmpRoot = opts.tmpRoot ?? tmpdir();
  const sandboxRoot = mkdtempSync(join(tmpRoot, `iso-${basename(base) || "root"}-`));

  if (backend === "file_copy") {
    // Copy every file under base into the sandbox. Subdirs recursively.
    copyTree(base, sandboxRoot);
  } else {
    // overlayfs / reflink / btrfs / zfs / git_worktree — left to a native bridge.
    // For now, fall back to file_copy so the surface is consistent.
    copyTree(base, sandboxRoot);
  }

const writes = new Map<string, string>(); // relPath → content

    // CRITICAL-2 (security review): contain all relPaths to sandboxRoot/base.
    // path.join normalizes '..', so an unvalidated relPath escapes the sandbox.
    const assertContained = (root: string, rel: string): string => {
      const resolved = resolve(root, rel);
      const rootResolved = resolve(root);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep) && !resolved.startsWith(rootResolved + "/")) {
        throw new Error(`path escapes sandbox root: ${rel} (→ ${resolved})`);
      }
      return resolved;
    };

    return {
    root: sandboxRoot,
    base,
    backend,
    changedPaths: () => [...writes.keys()],
    diff(): string[] {
      const out: string[] = [];
      for (const rel of writes.keys()) {
        // CRITICAL-2: validate before join (writes keys were already validated
        // at write() time, but defend in depth).
        assertContained(sandboxRoot, rel); assertContained(base, rel);
        const sandboxFile = join(sandboxRoot, rel);
        const baseFile = join(base, rel);
        if (!existsSync(baseFile)) { out.push(rel); continue; }
        const sandboxContent = readFileSync(sandboxFile, "utf8");
        const baseContent = readFileSync(baseFile, "utf8");
        if (sandboxContent !== baseContent) out.push(rel);
      }
      return out;
    },
    mergeBack(parentRoot: string): MergeResult {
      const merged: string[] = [];
      const added: string[] = [];
      const conflicts: ConflictError[] = [];
      // Scan the WHOLE sandbox root (not just ws.write() callers — the child's
      // tools write via fs directly to sandboxRoot). Compare each file to base.
      for (const rel of walkFiles(sandboxRoot)) {
        assertContained(sandboxRoot, rel); assertContained(base, rel); assertContained(parentRoot, rel);
        const sandboxFile = join(sandboxRoot, rel);
        const baseFile = join(base, rel);
        const parentFile = join(parentRoot, rel);
        const childContent = readFileSync(sandboxFile, "utf8");
        const baseContent = existsSync(baseFile) ? readFileSync(baseFile, "utf8") : null;
        const parentContent = existsSync(parentFile) ? readFileSync(parentFile, "utf8") : null;
        // New file in child (not in base/parent) → add to parent.
        if (baseContent === null && parentContent === null) {
          mkdirSync(dirname(parentFile), { recursive: true });
          writeFileSync(parentFile, childContent, "utf8");
          added.push(rel);
          continue;
        }
        // Child unchanged from base → parent wins (parent moved, child idle).
        if (childContent === baseContent) continue;
        // Parent unchanged from base → fast-forward child's version.
        if (parentContent === baseContent) {
          mkdirSync(dirname(parentFile), { recursive: true });
          writeFileSync(parentFile, childContent, "utf8");
          merged.push(rel);
          continue;
        }
        // BOTH changed + differ → conflict (never silently clobber).
        if (childContent !== parentContent) {
          conflicts.push({ path: rel, baseContent, childContent, parentContent });
        }
      }
      return conflicts.length === 0 ? { ok: true, merged, added } : { ok: false, conflicts, merged };
    },
    write(relPath: string, content: string): void {
      assertContained(sandboxRoot, relPath);
      writes.set(relPath, content);
      const full = join(sandboxRoot, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    },
    read(relPath: string): string | null {
      const sandboxFile = assertContained(sandboxRoot, relPath);
      if (existsSync(sandboxFile)) return readFileSync(sandboxFile, "utf8");
      const baseFile = assertContained(base, relPath);
      if (existsSync(baseFile)) return readFileSync(baseFile, "utf8");
      return null;
    },
    cleanup(): void {
      // R42: actually remove the temp dir (was a no-op → temp dirs accumulated).
      try { rmSync(sandboxRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

function copyTree(src: string, dst: string): void {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(src, { withFileTypes: true }); }
  catch { return; }
  mkdirSync(dst, { recursive: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".git") || ent.name === "node_modules") continue;
    const s = join(src, ent.name);
    const d = join(dst, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else if (ent.isFile()) {
      mkdirSync(dirname(d), { recursive: true });
      copyFileSync(s, d);
    }
  }
}

/** Recursively list all FILES under `root`, as paths relative to `root`. */
function walkFiles(root: string, dir = ""): string[] {
  const out: string[] = [];
  const abs = dir ? join(root, dir) : root;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(abs, { withFileTypes: true }); }
  catch { return out; }
  for (const ent of entries) {
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walkFiles(root, rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}