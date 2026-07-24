/**
 * Runtime package resolution (§17) — tests.
 *
 * Coverage: local package resolution from node_modules, version pinning
 * (exact/^/~/>=/*), error on missing package, manifest reading, entry
 * resolution (main/exports/index fallback), readExtension dynamic import, and
 * non-destructiveness (read-only).
 *
 * Uses mkdtempSync + rmSync for temp node_modules trees. No network.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readExtension,
  resolvePackage,
  findPackageDir,
  readPackageJson,
  readAgentManifest,
  resolveEntry,
  satisfiesVersion,
  resolvePackageFrom,
} from "./package-resolver.js";
import type { PackageManifest } from "./index.js";

/** Create a fake node_modules package under baseDir. */
function makePkg(
  baseDir: string,
  name: string,
  opts: {
    version?: string;
    main?: string;
    manifest?: PackageManifest | null;
    exports?: unknown;
    entryName?: string;
    entryContent?: string;
  } = {},
): string {
  const dir = join(baseDir, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  const version = opts.version ?? "1.0.0";
  const entryName = opts.entryName ?? "index.js";
  const pkg: Record<string, unknown> = { name, version };
  if (opts.main) pkg["main"] = opts.main;
  else pkg["main"] = entryName;
  if (opts.exports !== undefined) pkg["exports"] = opts.exports;
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  if (opts.manifest !== undefined && opts.manifest !== null) {
    writeFileSync(join(dir, "agent-package.json"), JSON.stringify(opts.manifest));
  }
  // Ensure the entry's parent directory exists (e.g. dist/cli.js).
  const entryFullPath = join(dir, entryName);
  const sep = entryName.lastIndexOf("/");
  if (sep > 0) mkdirSync(join(dir, entryName.substring(0, sep)), { recursive: true });
  writeFileSync(entryFullPath, opts.entryContent ?? `export const name = "${name}";\n`);
  return dir;
}

describe("[unit] satisfiesVersion — semver pin check", () => {
  it("accepts any version for '*' or empty", () => {
    expect(satisfiesVersion("1.2.3", "*")).toBe(true);
    expect(satisfiesVersion("9.9.9", "")).toBe(true);
    expect(satisfiesVersion("0.0.1", "latest")).toBe(true);
  });
  it("exact match", () => {
    expect(satisfiesVersion("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesVersion("1.2.4", "1.2.3")).toBe(false);
  });
  it("caret ^ allows same-major >= range", () => {
    expect(satisfiesVersion("1.2.3", "^1.2.0")).toBe(true);
    expect(satisfiesVersion("1.9.0", "^1.0.0")).toBe(true);
    expect(satisfiesVersion("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesVersion("1.0.0", "^1.2.0")).toBe(false);
  });
  it("tilde ~ allows same major+minor", () => {
    expect(satisfiesVersion("1.2.5", "~1.2.0")).toBe(true);
    expect(satisfiesVersion("1.3.0", "~1.2.0")).toBe(false);
  });
  it("'>=' range", () => {
    expect(satisfiesVersion("1.5.0", ">=1.2.0")).toBe(true);
    expect(satisfiesVersion("1.1.0", ">=1.2.0")).toBe(false);
  });
  it("rejects malformed version", () => {
    expect(satisfiesVersion("not-a-version", "1.0.0")).toBe(false);
  });
});

describe("[unit] findPackageDir / readPackageJson / readAgentManifest", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mya-res-find-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("finds a package directory under node_modules", () => {
    makePkg(base, "foo");
    expect(findPackageDir("foo", base)).toBe(join(base, "node_modules", "foo"));
  });

  it("returns null for a missing package", () => {
    expect(findPackageDir("nope", base)).toBeNull();
  });

  it("reads package.json name + version", () => {
    const dir = makePkg(base, "bar", { version: "2.3.4" });
    const pkg = readPackageJson(dir);
    expect(pkg.name).toBe("bar");
    expect(pkg.version).toBe("2.3.4");
  });

  it("throws on missing package.json", () => {
    expect(() => readPackageJson(join(base, "node_modules", "ghost"))).toThrow(/package.json not found/);
  });

  it("reads agent-package.json manifest when present", () => {
    const manifest: PackageManifest = {
      name: "ext",
      version: "1.0.0",
      kind: ["extensions"],
      apiVersion: "1.0.0",
    };
    const dir = makePkg(base, "ext", { manifest });
    expect(readAgentManifest(dir)).toEqual(manifest);
  });

  it("returns null when no agent-package.json", () => {
    const dir = makePkg(base, "plain");
    expect(readAgentManifest(dir)).toBeNull();
  });
});

describe("[unit] resolveEntry — main / exports / index fallback", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mya-res-entry-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("honours an explicit main field", () => {
    makePkg(base, "m", { main: "dist/cli.js", entryName: "dist/cli.js" });
    const dir = join(base, "node_modules", "m");
    const pkg = readPackageJson(dir);
    expect(resolveEntry(dir, pkg)).toBe(join(dir, "dist", "cli.js"));
  });

  it("falls back to exports['.'] string", () => {
    makePkg(base, "e", { main: undefined, exports: { ".": "./build/index.js" }, entryName: "build/index.js" });
    // override package.json to drop main
    const dir = join(base, "node_modules", "e");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "e", version: "1.0.0", exports: { ".": "./build/index.js" } }));
    const pkg = readPackageJson(dir);
    expect(resolveEntry(dir, pkg)).toBe(join(dir, "build", "index.js"));
  });

  it("falls back to exports['.'].import", () => {
    const dir = join(base, "node_modules", "ei");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "mod.js"), "export const x = 1;");
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "ei", version: "1.0.0",
      exports: { ".": { import: "./src/mod.js" } },
    }));
    const pkg = readPackageJson(dir);
    expect(resolveEntry(dir, pkg)).toBe(join(dir, "src", "mod.js"));
  });

  it("falls back to index.js when no main/exports", () => {
    const dir = join(base, "node_modules", "idf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.js"), "export const y = 2;");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "idf", version: "1.0.0" }));
    const pkg = readPackageJson(dir);
    expect(resolveEntry(dir, pkg)).toBe(join(dir, "index.js"));
  });

  it("throws when no entry can be found", () => {
    const dir = join(base, "node_modules", "noentry");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "noentry", version: "1.0.0" }));
    const pkg = readPackageJson(dir);
    expect(() => resolveEntry(dir, pkg)).toThrow(/no entry point/);
  });
});

describe("[unit] resolvePackage — local resolution & version pinning", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mya-res-pkg-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("resolves a locally installed package", () => {
    const manifest: PackageManifest = {
      name: "crew-ext", version: "1.2.0", kind: ["extensions"], apiVersion: "1.0.0",
    };
    makePkg(base, "crew-ext", { version: "1.2.0", manifest });
    const r = resolvePackage("crew-ext", { baseDir: base });
    expect(r.name).toBe("crew-ext");
    expect(r.version).toBe("1.2.0");
    expect(r.manifest?.apiVersion).toBe("1.0.0");
    expect(r.entryPath).toBe(join(base, "node_modules", "crew-ext", "index.js"));
  });

  it("resolves a plain npm package with no manifest (manifest = null)", () => {
    makePkg(base, "lodashish", { version: "4.0.0" });
    const r = resolvePackage("lodashish", { baseDir: base });
    expect(r.manifest).toBeNull();
    expect(r.version).toBe("4.0.0");
  });

  it("throws when the package is missing", () => {
    expect(() => resolvePackage("ghost-pkg", { baseDir: base })).toThrow(/package not found/);
  });

  it("enforces an exact version pin (pass)", () => {
    makePkg(base, "pinned", { version: "3.1.4" });
    expect(() => resolvePackage("pinned", { baseDir: base, versionRange: "3.1.4" })).not.toThrow();
  });

  it("throws when the version pin is unmet", () => {
    makePkg(base, "pinned", { version: "3.1.4" });
    expect(() => resolvePackage("pinned", { baseDir: base, versionRange: "^2.0.0" })).toThrow(/version pin unmet/);
  });

  it("enforces a caret pin within the same major", () => {
    makePkg(base, "caret", { version: "1.5.0" });
    expect(() => resolvePackage("caret", { baseDir: base, versionRange: "^1.0.0" })).not.toThrow();
    expect(() => resolvePackage("caret", { baseDir: base, versionRange: "^2.0.0" })).toThrow(/version pin unmet/);
  });

  it("requires a manifest when requireManifest=true", () => {
    makePkg(base, "nomani", { version: "1.0.0" });
    expect(() => resolvePackage("nomani", { baseDir: base, requireManifest: true })).toThrow(/required manifest missing/);
  });

  it("requireManifest passes when a manifest is present", () => {
    const manifest: PackageManifest = { name: "m2", version: "1.0.0", kind: ["skills"], apiVersion: "1.0.0" };
    makePkg(base, "m2", { version: "1.0.0", manifest });
    expect(() => resolvePackage("m2", { baseDir: base, requireManifest: true })).not.toThrow();
  });
});

describe("[unit] readExtension — resolve + dynamic import", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mya-res-ext-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("imports the resolved entry module", async () => {
    makePkg(base, "loadable", {
      version: "1.0.0",
      entryContent: "export const greet = () => 'hello';\n",
    });
    const ext = await readExtension("loadable", { baseDir: base });
    expect(ext.resolved.name).toBe("loadable");
    const mod = ext.module as { greet?: () => string };
    expect(typeof mod.greet).toBe("function");
    expect(mod.greet!()).toBe("hello");
  });

  it("uses an injectable importer (mock — no real import)", async () => {
    makePkg(base, "inj", { version: "1.0.0" });
    let calledWith = "";
    const ext = await readExtension("inj", {
      baseDir: base,
      importer: async (p) => {
        calledWith = p;
        return { mocked: true };
      },
    });
    expect(calledWith).toBe(join(base, "node_modules", "inj", "index.js"));
    expect((ext.module as { mocked: boolean }).mocked).toBe(true);
  });

  it("throws a descriptive error when import fails", async () => {
    makePkg(base, "broken", { version: "1.0.0" });
    await expect(
      readExtension("broken", {
        baseDir: base,
        importer: async () => {
          throw new Error("syntax boom");
        },
      }),
    ).rejects.toThrow(/failed to import broken.*syntax boom/);
  });

  it("refuses to load a missing package", async () => {
    await expect(readExtension("absent", { baseDir: base })).rejects.toThrow(/package not found/);
  });
});

describe("[unit] readExtension — non-destructiveness", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "mya-res-nd-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("readExtension does not modify the package directory", async () => {
    makePkg(base, "ro", { version: "1.0.0" });
    const dir = join(base, "node_modules", "ro");
    const before = readPackageJson(dir);
    await readExtension("ro", { baseDir: base, importer: async () => ({}) });
    const after = readPackageJson(dir);
    expect(after).toEqual(before); // untouched
  });
});

describe("[unit] resolvePackageFrom — Node module resolution", () => {
  it("resolves a real installed dependency (vitest) from this file", () => {
    // vitest is installed at the repo root and resolvable via createRequire.
    const p = resolvePackageFrom("vitest", import.meta.url);
    expect(p).toMatch(/vitest/);
  });

  it("throws for an unresolvable package", () => {
    expect(() => resolvePackageFrom("definitely-not-a-real-pkg-xyz", import.meta.url)).toThrow(/cannot resolve/);
  });
});

describe("[smoke] package-resolver module", () => {
  it("exports the runtime resolution API", async () => {
    const m = await import("./package-resolver.js");
    expect(typeof m.readExtension).toBe("function");
    expect(typeof m.resolvePackage).toBe("function");
    expect(typeof m.satisfiesVersion).toBe("function");
  });
});
