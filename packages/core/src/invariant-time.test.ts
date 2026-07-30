import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Invariant #10 (single time helper): `Date.now()` must NEVER appear outside
 * `packages/core/src/time.ts` (the sole time provider). Everything else routes
 * through `nowWallclock()` / `nowMonotonic()` from `@my-agent/core`. This guard
 * test prevents regression without needing ESLint.
 */
describe("Invariant #10 — single time helper (no Date.now() outside core.time)", () => {
  const root = join(process.cwd(), "packages");
  const offenders: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        // the sole allowed source of wall-clock time:
        if (full.endsWith(join("core", "src", "time.ts"))) continue;
        // Exclude vendored pi upstream packages (coding-agent, tui).
        // These are owned by pi and use Date.now() natively; mya's invariant applies
        // only to code mya owns (core, ai, cron, gateway, memory, tools, print, etc.).
        if (full.includes(join("packages", "coding-agent"))) continue;
        if (full.includes(join("packages", "tui"))) continue;
        // Web SPA runs in the browser — cannot import @my-agent/core (Node-only).
        if (full.includes(join("packages", "web"))) continue;
        // Exclude @hermes/shared (cloned from Hermes, uses Date.now natively)
        if (full.includes(join("packages", "shared"))) continue;
        const text = readFileSync(full, "utf8");
        // match `Date.now(` but NOT inside a comment line.
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          if (/Date\.now\s*\(/.test(line)) offenders.push(`${full}: ${line.trim()}`);
        }
      }
    }
  }
  walk(root);

  it("no Date.now() calls outside packages/core/src/time.ts", () => {
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
