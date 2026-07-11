import { defineConfig } from "vitest/config";

/**
 * Test runner for the my-agent monorepo. Tests live alongside source as
 * `*.test.ts` inside each package's `src/`. We import built `dist/` for
 * cross-package coverage (packages reference each other via `@my-agent/*`
 * workspace deps → dist), so run `npm run build` before `npm test`.
 */
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
