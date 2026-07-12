#!/usr/bin/env node
// Apply mya branding to node_modules before bundling
await import("./apply-branding.mjs");
/**
 * Bundle mya CLI — 100% cloned pi code from vendored/ directory.
 * All deps are in vendored/node_modules/ (cloned, not npm).
 */

import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";

const cjsShim = `import { createRequire as __myaCreateRequire } from "node:module";
const require = __myaCreateRequire(import.meta.url);`;

const stubPlugin = {
  name: "stub",
  setup(b) {
    b.onResolve({ filter: /react-devtools-core/ }, () => ({ path: "stub", namespace: "stub" }));
    b.onLoad({ filter: /stub/, namespace: "stub" }, () => ({ contents: "export default undefined;", loader: "js" }));
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
  // Resolve everything from vendored/node_modules first, then regular node_modules
  nodePaths: [path.resolve("vendored/node_modules")],
  external: [
    "node:crypto", "node:fs", "node:os", "node:path", "node:child_process",
    "node:url", "node:module", "node:util", "node:stream", "node:http",
    "node:https", "node:net", "node:tls", "node:zlib", "node:buffer",
    "node:events", "node:string_decoder", "node:readline", "node:worker_threads",
    "node:async_hooks", "node:perf_hooks", "node:assert", "node:querystring",
  ],
  plugins: [stubPlugin],
  legalComments: "none",
  minify: false,
  sourcemap: false,
  logLevel: "error",
});

// Copy pi theme JSONs to dist/ (runtime reads via fs.readFileSync)
const themeSrc = path.resolve("vendored/pi/dist/modes/interactive/theme");
const themeDst = path.resolve("dist/modes/interactive/theme");
if (fs.existsSync(themeSrc)) {
  fs.mkdirSync(themeDst, { recursive: true });
  for (const f of fs.readdirSync(themeSrc)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(themeSrc, f), path.join(themeDst, f));
  }
  console.log(`✓ copied ${fs.readdirSync(themeDst).length} theme files`);
}

console.log("✓ bundled: dist/mya.js");
