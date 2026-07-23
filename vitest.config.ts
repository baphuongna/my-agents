import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "test/features/**/*.test.{ts,tsx}",
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
  },
});
