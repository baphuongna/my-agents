#!/usr/bin/env node
/**
 * Bundle mya CLI — builds from PROJECT SOURCE (not npm, not vendored JS dist).
 *
 * Pi comes from npm (@earendil-works/pi-coding-agent).
 * esbuild resolves @my-agent/* from these source packages directly.
 * pi-agent-core + pi-ai + pi-tui resolve from node_modules (@earendil-works/* npm packages).
 * No vendored JS. Source is owned by mya.
 */

import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";

const cjsShim = `import { createRequire as __myaCreateRequire } from "node:module";
const require = __myaCreateRequire(import.meta.url);`;

// ── Plugin: resolve @my-agent/* from project packages/ source ──────
const sourceResolve = {
  name: "source-resolve",
  setup(b) {
    // Map @my-agent/* to packages/ source (.ts files, not .js dist)
    // Explicit subpath overrides (file not derivable by convention).
    const srcSubpaths = {};

    // Resolve ALL @my-agent/* from packages/ SOURCE (.ts), not compiled dist.
    // This means editing ANY package's source is picked up by `npm run bundle`
    // directly — no `tsc -b` needed first (the former gotcha). Falls through to
    // esbuild default resolution (compiled dist) if the source file is absent,
    // so unmapped/odd packages keep working unchanged.
    b.onResolve({ filter: /^@my-agent\// }, (args) => {
      if (srcSubpaths[args.path]) return { path: path.resolve(srcSubpaths[args.path]) };
      const pkg = args.path.replace(/^@my-agent\//, "").replace(/\/.*$/, "");
      const dir = pkg;
      const stripped = args.path.slice(("@my-agent/" + pkg).length).replace(/^\//, "");
      const base = `packages/${dir}/src`;
      const candidates = stripped
        ? [`${base}/${stripped}.ts`, `${base}/${stripped}/index.ts`]
        : [`${base}/index.ts`, `${base}/main.ts`];
      for (const c of candidates) {
        if (fs.existsSync(path.resolve(c))) return { path: path.resolve(c) };
      }
      // No source found → fall through to esbuild default (compiled dist).
    });

    // Stub react-devtools-core (not needed)
    b.onResolve({ filter: /^react-devtools-core/ }, () => ({ path: "stub-dep", namespace: "stub-dep" }));
    // highlight.js subpaths → external (tree-shaken to main package)
    b.onResolve({ filter: /^highlight\.js\/lib/ }, () => ({ path: "highlight.js", external: true }));
    b.onLoad({ filter: /.*/, namespace: "stub-dep" }, () => ({ contents: "export default undefined;", loader: "js" }));
  },
};

// ── Dedupe: remove same-version nested copies under pi-coding-agent ──
// npm installs many packages as BOTH top-level AND nested deps of
// pi-coding-agent. esbuild bundles both → module-level singletons get
// duplicated → subtle runtime bugs (e.g. OAuth bundledLoaders split).
// Fix: delete nested copies where the version matches top-level.
// Different versions are KEPT (pi-coding-agent was tested with those).
const NESTED_NM = path.resolve("node_modules/@earendil-works/pi-coding-agent/node_modules");
function readVersion(pkgDir) {
  try {
    const pj = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pj)) return null;
    return JSON.parse(fs.readFileSync(pj, "utf-8")).version ?? null;
  } catch { return null; }
}
let dedupRemoved = 0;
if (fs.existsSync(NESTED_NM)) {
  for (const entry of fs.readdirSync(NESTED_NM)) {
    const nestedEntry = path.join(NESTED_NM, entry);
    if (entry.startsWith("@")) {
      for (const sub of fs.readdirSync(nestedEntry)) {
        const np = path.join(nestedEntry, sub);
        const tp = path.resolve(`node_modules/${entry}/${sub}`);
        const nv = readVersion(np), tv = readVersion(tp);
        if (nv && tv && nv === tv) { fs.rmSync(np, { recursive: true }); dedupRemoved++; }
      }
      if (fs.existsSync(nestedEntry) && fs.readdirSync(nestedEntry).length === 0) fs.rmSync(nestedEntry, { recursive: true });
    } else {
      const tp = path.resolve(`node_modules/${entry}`);
      const nv = readVersion(nestedEntry), tv = readVersion(tp);
      if (nv && tv && nv === tv) { fs.rmSync(nestedEntry, { recursive: true }); dedupRemoved++; }
    }
  }
}
if (dedupRemoved > 0) console.log(`  dedup: removed ${dedupRemoved} same-version nested packages`);

await build({
  entryPoints: ["packages/print/src/main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: "dist/mya.js",
  banner: { js: cjsShim },
  define: { "process.env.NODE_ENV": '"production"' },
  external: [
    "node:crypto", "node:fs", "node:os", "node:path", "node:child_process",
    "node:url", "node:module", "node:util", "node:stream", "node:http",
    "node:https", "node:net", "node:tls", "node:zlib", "node:buffer",
    "node:events", "node:string_decoder", "node:readline", "node:worker_threads",
    "node:async_hooks", "node:perf_hooks", "node:assert", "node:querystring",
    // Stable SQLite backend (replaces experimental node:sqlite — native addon,
    // resolved at runtime via createRequire in sqlite-db.ts)
    "better-sqlite3",
    // Optional native deps — resolved at runtime via dynamic import()
    "tesseract.js", "chrome-remote-interface", "sharp", "agent-browser",
    // Embeddings (action #3) — fastembed pulls onnxruntime-node (.node natives);
    // both are dynamic-imported by embeddings.ts and resolved at runtime.
    "fastembed", "onnxruntime-node", "onnxruntime-common",
  ],
  plugins: [sourceResolve],
  legalComments: "none",
  minify: false,
  sourcemap: false,
  logLevel: "error",
});

// Copy theme JSONs from source
const themeSrc = path.resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme");
const themeDst = path.resolve("dist/modes/interactive/theme");
if (fs.existsSync(themeSrc)) {
  fs.mkdirSync(themeDst, { recursive: true });
  for (const f of fs.readdirSync(themeSrc)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(themeSrc, f), path.join(themeDst, f));
  }
  console.log(`✓ copied ${fs.readdirSync(themeDst).length} theme files`);
}

console.log("✓ bundled: dist/mya.js (from project source)");
