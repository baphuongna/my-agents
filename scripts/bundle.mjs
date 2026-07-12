#!/usr/bin/env node
/**
 * Bundle mya CLI — uses vendored/ code EXCLUSIVELY (not npm).
 *
 * esbuild plugin intercepts ALL @earendil-works/* imports
 * and redirects to vendored/ — ensuring 100% clone, not library.
 */

import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";

const cjsShim = `import { createRequire as __myaCreateRequire } from "node:module";
const require = __myaCreateRequire(import.meta.url);`;

// ── Plugin: redirect @earendil-works/* → vendored/ ────────────────
const vendoredResolve = {
  name: "vendored-resolve",
  setup(b) {
    // Pi packages → vendored/ (NOT node_modules)
    const piMap = {
      "@earendil-works/pi-coding-agent": "vendored/pi/dist/index.js",
      "@earendil-works/pi-tui": "packages/tui/dist/index.js",
      "@earendil-works/pi-ai": "vendored/pi-ai/dist/index.js",
      "@earendil-works/pi-agent-core": "vendored/pi-agent-core/dist/index.js",
    };

    // Subpath imports: @earendil-works/pi-ai/oauth, /compat
    const piSubpaths = {
      "@earendil-works/pi-ai/compat": "vendored/pi-ai/dist/compat.js",
      "@earendil-works/pi-ai/oauth": "vendored/pi-ai/dist/oauth.js",
    };

    // All @earendil-works/* — check exact match first, then subpath
    b.onResolve({ filter: /^@earendil-works\// }, (args) => {
      // Exact match
      if (piMap[args.path]) {
        return { path: path.resolve(piMap[args.path]) };
      }
      // Subpath match
      if (piSubpaths[args.path]) {
        return { path: path.resolve(piSubpaths[args.path]) };
      }
      // Try as directory + subpath
      for (const [pkg, dir] of Object.entries(piMap)) {
        if (args.path.startsWith(pkg + "/")) {
          const sub = args.path.slice(pkg.length + 1);
          return { path: path.resolve(dir.replace("/index.js", "/" + sub + ".js")) };
        }
      }
      // Fallback: let esbuild resolve normally (returning undefined continues
      // to the next resolver; do NOT return null — that's a hard denial).
    });

    // Stub only react-devtools + highlight.js (path mismatch)
    b.onResolve({ filter: new RegExp("^react-devtools-core") }, () => ({ path: "stub-dep", namespace: "stub-dep" }));
    b.onResolve({ filter: new RegExp("^highlight\\.js/lib") }, (args) => ({ path: "highlight.js", external: true }));
    b.onLoad({ filter: /.*/, namespace: "stub-dep" }, () => ({ contents: "export default undefined;", loader: "js" }));
  },
};

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
  ],
  plugins: [vendoredResolve],
  legalComments: "none",
  minify: false,
  sourcemap: false,
  logLevel: "error",
});

// Copy pi theme JSONs to dist/
const themeSrc = path.resolve("vendored/pi/dist/modes/interactive/theme");
const themeDst = path.resolve("dist/modes/interactive/theme");
if (fs.existsSync(themeSrc)) {
  fs.mkdirSync(themeDst, { recursive: true });
  for (const f of fs.readdirSync(themeSrc)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(themeSrc, f), path.join(themeDst, f));
  }
  console.log(`✓ copied ${fs.readdirSync(themeDst).length} theme files`);
}

console.log("✓ bundled: dist/mya.js (100% from vendored/)");
