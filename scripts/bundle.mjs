#!/usr/bin/env node
/**
 * Bundle the mya CLI into a single self-contained ESM file using esbuild.
 * All workspace packages are inlined; the optional .node binary fails to
 * load at runtime → graceful JS fallback kicks in (pure-JS mode).
 *
 * Output: dist/mya.js (the publishable bin entry point).
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
      contents: "export default undefined;",
      loader: "js",
    }));
  },
};

await build({
  entryPoints: ["packages/print/src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/mya.js",
  // react-devtools-core is stubbed (optional dev-only inside ink).
  // ws is CJS that uses dynamic require — keep as external runtime dep (serve mode only).
  external: ["ws"],
  plugins: [stubPlugin],
  legalComments: "none",
  minify: false,
  sourcemap: false,
});

console.log("✓ bundled: dist/mya.js");
