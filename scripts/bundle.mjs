#!/usr/bin/env node
/**
 * Bundle the mya CLI into a single self-contained ESM file using esbuild.
 * All workspace packages are inlined; the optional .node binary fails to
 * load at runtime → graceful JS fallback kicks in (pure-JS mode).
 *
 * Output: dist/mya.js (the publishable bin entry point).
 *
 * Phase 18: Ink/React + Yoga bundled inline. The CJS-shim banner lets Node's
 * createRequire() back-stop bundled dynamic requires (yoga-layout uses TLA,
 * so format=esm is required). dev env is forced to "production" to skip
 * ink's devtools branch (which pulls `ws`).
 */
import { build } from "esbuild";

/** Stub out optional dev-only deps that ink tries to import (react-devtools-core). */
const stubPlugin = {
  name: "stub-optional",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
export function connectToDevTools() {}
export default { connectToDevTools };
`,
      loader: "js",
    }));
  },
};

/** CJS require shim — esbuild's __require helper throws on dynamic require in
 * ESM format. We back-stop it with a real Node createRequire so bundled
 * CJS deps (ink/yoga/ws wrappers if they survive) still work. */
const cjsShim = `import { createRequire as __myaCreateRequire } from "node:module";
const require = __myaCreateRequire(import.meta.url);
`;

await build({
  entryPoints: ["packages/print/src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/mya.js",
  banner: { js: cjsShim },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  external: [],
  plugins: [stubPlugin],
  legalComments: "none",
  minify: false,
  sourcemap: false,
});

console.log("✓ bundled: dist/mya.js");
