#!/usr/bin/env node
/**
 * Lint guard (§18 invariant enforcement). ESLint's @typescript-eslint parser is
 * INCOMPATIBLE with TypeScript 7 (the native Go compiler removed the JS compiler
 * API symbols typescript-estree needs — BarBarToken/Intrinsic). This script
 * enforces the invariants a parser-based linter would, via targeted greps. It's
 * wired to `npm run lint` and fails the build on violation.
 *
 * Invariant #10 (single time helper): no Date.now() outside packages/core/src/time.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "packages");
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(m?[tc]sx?)$/.test(entry) && !entry.endsWith(".test.ts")) {
      if (full.endsWith(join("core", "src", "time.ts"))) continue; // the sole allowed source
      const text = readFileSync(full, "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue; // skip comments
        // HIGH-3 (review): widen the ban beyond the literal — aliases, bracket access,
        // alternative clocks. (A grep tripwire, not a guarantee — AST linters are TS-7-incompatible.)
        if (/Date\.now\s*\(|Date\[(['"]?)now|\.getTime\s*\(|performance\.now\s*\(/.test(line)) offenders.push(`${full}: ${trimmed}`);
      }
    }
  }
}
walk(root);

if (offenders.length > 0) {
  console.error(`✗ invariant #10 (single time helper) violated — ${offenders.length} site(s):`);
  for (const o of offenders) console.error("  " + o);
  console.error("\nUse nowWallclock()/nowMonotonic() from @my-agent/core instead of Date.now().");
  process.exit(1);
}
console.log("✓ lint: invariant #10 (no Date.now() outside core.time) clean");
