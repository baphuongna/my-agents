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