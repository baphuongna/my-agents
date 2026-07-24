/**
 * Runtime package resolution (§17) — resolve an extension package by name from
 * `node_modules`, read its manifest (`agent-package.json`), enforce an optional
 * version pin, and dynamically import its main entry.
 *
 * This bridges the gap between `PackageHost.register(manifest, loader)` (which
 * takes an opaque loader) and the filesystem: `readExtension("foo")` finds
 * `node_modules/foo`, reads its manifest + entry, and hands them to the host.
 *
 * Trust model (R30): the loaded module runs IN-PROCESS — same trust as any npm
 * dependency. There is no OS sandbox. `readExtension` is READ + LOAD only; it
 * never executes install scripts or mutates the filesystem, so it is
 * non-destructive without extra confirmation.
 *
 * Source: §17 Extension Model; PLAN-REMAINING Item 3 (pi-crew runtime resolution).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { PackageManifest } from "./index.js";

/** Options controlling package resolution. */
export interface ResolvePackageOptions {
  /** Base directory whose `node_modules` is searched. Defaults to `process.cwd()`. */
  baseDir?: string;
  /**
   * Optional version pin. Accepts:
   *  - exact: "1.2.3"
   *  - caret: "^1.2.3" (same major)
   *  - tilde: "~1.2.3" (same major+minor)
   *  - any/missing: "*"
   * A mismatch throws (refuses-load) rather than silently picking another copy.
   */
  versionRange?: string;
  /** Require an `agent-package.json` manifest (default: false). When false, a
   * plain npm package without a manifest still resolves (manifest = null). */
  requireManifest?: boolean;
  /** Injectable import function (for tests / custom loaders). */
  importer?: (entryPath: string) => Promise<unknown>;
}

/** A resolved package on disk (manifest + entry path, pre-import). */
export interface ResolvedPackage {
  name: string;
  /** Installed version (from package.json). */
  version: string;
  /** The §17 manifest, or null when the package ships no `agent-package.json`. */
  manifest: PackageManifest | null;
  /** Absolute path to the package main entry. */
  entryPath: string;
  /** Absolute path to the package directory. */
  packageDir: string;
}

/** A package loaded into memory (resolved + imported module). */
export interface LoadedExtension {
  resolved: ResolvedPackage;
  /** The imported module namespace (in-process, trusted). */
  module: unknown;
}

/** Locate a package directory under `<baseDir>/node_modules/<name>`. Returns
 * the absolute directory or null when not found. */
export function findPackageDir(packageName: string, baseDir = process.cwd()): string | null {
  const dir = resolvePath(baseDir, "node_modules", packageName);
  return existsSync(join(dir, "package.json")) ? dir : null;
}

/** Read + parse a package.json from a directory. Throws on missing/corrupt. */
export function readPackageJson(packageDir: string): {
  name: string;
  version: string;
  main?: string;
  exports?: Record<string, unknown> | string;
  type?: string;
} {
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) throw new Error(`package.json not found in ${packageDir}`);
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch (e) {
    throw new Error(`cannot read package.json: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid package.json: ${(e as Error).message}`);
  }
}

/** Read an `agent-package.json` manifest from a directory, or null if absent. */
export function readAgentManifest(packageDir: string): PackageManifest | null {
  const manifestPath = join(packageDir, "agent-package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  } catch {
    return null; // corrupt manifest → treat as absent (conservative)
  }
}

/** Resolve the main entry file for a package, honouring `main`/`exports`. */
export function resolveEntry(packageDir: string, pkg: { main?: string; exports?: unknown }): string {
  // Prefer an explicit `main`; otherwise fall back to exports["."].import / ".".
  if (typeof pkg.main === "string" && pkg.main.length > 0) {
    return resolvePath(packageDir, pkg.main);
  }
  if (pkg.exports && typeof pkg.exports === "object") {
    const exp = pkg.exports as Record<string, unknown>;
    const dot = exp["."];
    if (typeof dot === "string") return resolvePath(packageDir, dot);
    if (dot && typeof dot === "object") {
      const d = dot as Record<string, unknown>;
      const candidate = d.import ?? d.default;
      if (typeof candidate === "string") return resolvePath(packageDir, candidate);
    }
  } else if (typeof pkg.exports === "string") {
    return resolvePath(packageDir, pkg.exports);
  }
  // Common default fallbacks.
  for (const candidate of ["index.js", "index.mjs", "index.cjs"]) {
    const p = join(packageDir, candidate);
    if (existsSync(p)) return p;
  }
  throw new Error(`no entry point found for package in ${packageDir}`);
}

/**
 * Minimal semver satisfaction check: supports exact, `^`, `~`, and `*`.
 * Returns true when `version` satisfies `range`. Exported for unit testing.
 */
export function satisfiesVersion(version: string, range: string): boolean {
  if (range === "*" || range === "" || range === "latest") return true;
  const v = parseSemver(version);
  if (!v) return false;
  if (range.startsWith("^")) {
    const r = parseSemver(range.slice(1));
    return r !== null && v.major === r.major && cmp(v, r) >= 0;
  }
  if (range.startsWith("~")) {
    const r = parseSemver(range.slice(1));
    return r !== null && v.major === r.major && v.minor === r.minor && cmp(v, r) >= 0;
  }
  if (range.startsWith(">=")) {
    const r = parseSemver(range.slice(2).trim());
    return r !== null && cmp(v, r) >= 0;
  }
  // exact match (ignore build/prerelease for simplicity)
  const r = parseSemver(range);
  return r !== null && v.major === r.major && v.minor === r.minor && v.patch === r.patch;
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(s: string): SemverParts | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

function cmp(a: SemverParts, b: SemverParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Resolve a package by name from `<baseDir>/node_modules/<name>` WITHOUT
 * importing it. Enforces the optional version pin. Throws when the package is
 * missing, the version pin is unmet, or (when required) the manifest is absent.
 */
export function resolvePackage(
  packageName: string,
  opts: ResolvePackageOptions = {},
): ResolvedPackage {
  const baseDir = opts.baseDir ?? process.cwd();
  const packageDir = findPackageDir(packageName, baseDir);
  if (!packageDir) {
    throw new Error(`package not found: ${packageName} (looked in ${resolvePath(baseDir, "node_modules", packageName)})`);
  }
  const pkg = readPackageJson(packageDir);
  const version = pkg.version ?? "0.0.0";
  if (opts.versionRange && !satisfiesVersion(version, opts.versionRange)) {
    throw new Error(
      `version pin unmet: ${packageName}@${version} does not satisfy ${opts.versionRange}`,
    );
  }
  const manifest = readAgentManifest(packageDir);
  if (opts.requireManifest && !manifest) {
    throw new Error(`required manifest missing: ${packageName} has no agent-package.json`);
  }
  const entryPath = resolveEntry(packageDir, pkg);
  return { name: pkg.name ?? packageName, version, manifest, entryPath, packageDir };
}

/** Default importer: dynamic ESM import of the resolved entry path. */
async function defaultImporter(entryPath: string): Promise<unknown> {
  // Convert to a file:// URL so Windows + ESM dynamic import work uniformly.
  const url = isAbsolute(entryPath) ? pathToFileURL(entryPath).href : entryPath;
  return import(url);
}

/**
 * Read (resolve + import) an extension package by name. This is the runtime
 * entry point for pi-crew package resolution: given a package name, find it in
 * `node_modules`, enforce the version pin, and return the imported module.
 *
 * Non-destructive: only reads + imports; never runs install scripts or mutates
 * the filesystem, so no user confirmation is needed for the read itself.
 */
export async function readExtension(
  packageName: string,
  opts: ResolvePackageOptions = {},
): Promise<LoadedExtension> {
  const resolved = resolvePackage(packageName, opts);
  const importer = opts.importer ?? defaultImporter;
  let module: unknown;
  try {
    module = await importer(resolved.entryPath);
  } catch (e) {
    throw new Error(`failed to import ${packageName} from ${resolved.entryPath}: ${(e as Error).message}`);
  }
  return { resolved, module };
}

/** Resolve a package from a specific require/import starting point using Node's
 * module resolution (createRequire). Useful when the package is nested deeper
 * than the cwd's node_modules. */
export function resolvePackageFrom(
  packageName: string,
  fromFile: string,
): string {
  const req = createRequire(resolvePath(fromFile));
  try {
    return req.resolve(packageName);
  } catch {
    throw new Error(`cannot resolve ${packageName} from ${fromFile}`);
  }
}
