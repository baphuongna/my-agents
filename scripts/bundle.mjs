#!/usr/bin/env node
/**
 * Bundle mya CLI — builds from PROJECT SOURCE (not npm, not vendored JS dist).
 *
 * Pi TypeScript source is IN packages/ (coding-agent, pi-ai-src, pi-agent-src).
 * esbuild resolves @my-agent/* from these source packages directly.
 * No external pi dependency. No vendored JS. Source is owned by mya.
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
    const srcMap = {
      "@my-agent/coding-agent": "packages/coding-agent/src/index.ts",
      "@my-agent/pi-ai": "packages/pi-ai-src/src/index.ts",
      "@my-agent/pi-agent-core": "packages/pi-agent-src/src/index.ts",
      "@my-agent/tui": "packages/tui/src/index.ts",
    };

    // Subpath imports
    const srcSubpaths = {
      "@my-agent/pi-ai/compat": "packages/pi-ai-src/src/compat.ts",
      "@my-agent/pi-ai/oauth": "packages/pi-ai-src/src/oauth.ts",
    };

    // Resolve @my-agent/* from source packages
    // coding-agent is bundled (not external) — builds from project source
    b.onResolve({ filter: /^@my-agent\/(coding-agent|pi-ai|pi-agent-core|tui)/ }, (args) => {
      // Exact match
      if (srcMap[args.path]) {
        return { path: path.resolve(srcMap[args.path]) };
      }
      // Subpath match
      if (srcSubpaths[args.path]) {
        return { path: path.resolve(srcSubpaths[args.path]) };
      }
      // Try as package + subpath (e.g. @my-agent/ai/oauth)
      for (const [pkg, src] of Object.entries(srcMap)) {
        if (args.path.startsWith(pkg + "/")) {
          const sub = args.path.slice(pkg.length + 1);
          const resolved = src.replace("/index.ts", "/" + sub + ".ts").replace("/main.ts", "/" + sub + ".ts");
          return { path: path.resolve(resolved) };
        }
      }
    });

    // Stub react-devtools-core (not needed)
    b.onResolve({ filter: /^react-devtools-core/ }, () => ({ path: "stub-dep", namespace: "stub-dep" }));
    // highlight.js subpaths → external (tree-shaken to main package)
    b.onResolve({ filter: /^highlight\.js\/lib/ }, () => ({ path: "highlight.js", external: true }));
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
    // Stable SQLite backend (replaces experimental node:sqlite — native addon,
    // resolved at runtime via createRequire in sqlite-db.ts)
    "better-sqlite3",
    // Optional native deps — resolved at runtime via dynamic import()
    "tesseract.js", "chrome-remote-interface", "sharp",
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
const themeSrc = path.resolve("packages/coding-agent/src/modes/interactive/theme");
const themeDst = path.resolve("dist/modes/interactive/theme");
if (fs.existsSync(themeSrc)) {
  fs.mkdirSync(themeDst, { recursive: true });
  for (const f of fs.readdirSync(themeSrc)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(themeSrc, f), path.join(themeDst, f));
  }
  console.log(`✓ copied ${fs.readdirSync(themeDst).length} theme files`);
}

console.log("✓ bundled: dist/mya.js (from project source)");
