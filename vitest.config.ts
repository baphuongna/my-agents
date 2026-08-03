import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // `@/` → web package src. Scoped to `@/` (trailing slash) so npm scopes
    // like `@my-agent/core` are never rewritten. Required for web component
    // tests that use the `@/` alias (matching web's vite.config.ts).
    alias: [
      { find: "@/", replacement: fileURLToPath(new URL("packages/web/src/", import.meta.url)) },
      // highlight.js v11 removed ./lib/index.js from its exports map.
      // Redirect to the file so vitest resolves it too.
      {
        find: "highlight.js/lib/index.js",
        replacement: fileURLToPath(new URL("node_modules/highlight.js/lib/index.js", import.meta.url)),
      },
    ],
  },
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "test/features/**/*.test.{ts,tsx}",
    ],
    // Exclude intercom node:test files (moved verbatim from pi-intercom, use node:test not vitest)
    exclude: [
      "packages/intercom/src/**/*.test.ts",
      "packages/intercom/src/test/**/*.ts",
      "node_modules/**",
    ],
    environment: "node",
    globals: false,
    reporter: "default",
    // pool: 'forks' (child processes, not worker_threads) — required because the
    // embeddings worker_thread offloads ONNX, and spawning a worker_thread from
    // inside vitest's default worker-thread pool crashes the native ONNX runtime
    // (Napi::Error / core dump). Child processes avoid the nested-worker crash.
    pool: "forks",
    isolate: true,
  },
  esbuild: {
    target: "es2022",
    // Match tsconfig `jsx: react-jsx` so .tsx component tests render without
    // needing React in scope. Affects only .tsx files; pure .ts tests untouched.
    jsx: "automatic",
  },
});
