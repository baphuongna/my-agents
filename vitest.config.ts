import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    reporter: "default",
    pool: "threads",
    isolate: true,
  },
  esbuild: {
    target: "es2022",
  },
});
