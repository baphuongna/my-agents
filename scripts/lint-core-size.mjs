#!/usr/bin/env node
/**
 * Invariant #18 (minimal core): adding code to `packages/core/` requires a
 * "why-not-a-package" justification. This script enforces a size budget:
 *
 *   - Reads the BASELINE (committed in scripts/core-size-baseline.txt)
 *   - Counts current non-test .ts lines in packages/core/src/
 *   - Fails if current > baseline + ALLOWED_DRIFT (50 lines)
 *
 * To update the baseline (after an approved core addition), run:
 *   node scripts/lint-core-size.mjs --update-baseline
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const baselineFile = new URL("./core-size-baseline.txt", import.meta.url);
const ALLOWED_DRIFT = 50; // lines

function countCoreLines() {
  try {
    const out = execSync(
      `find packages/core/src -name "*.ts" ! -name "*.test.ts" | xargs wc -l | tail -1`,
      { encoding: "utf8" },
    );
    return parseInt(out.trim().split(/\s+/)[0], 10) || 0;
  } catch (e) {
    console.error("✗ Failed to count core lines:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

const current = countCoreLines();

// Handle baseline update
if (process.argv.includes("--update-baseline")) {
  writeFileSync(baselineFile, String(current), "utf8");
  console.log(`✓ Baseline updated to ${current} lines`);
  process.exit(0);
}

// Read baseline
let baseline = 0;
if (existsSync(baselineFile)) {
  baseline = parseInt(readFileSync(baselineFile, "utf8").trim(), 10) || 0;
} else {
  writeFileSync(baselineFile, String(current), "utf8");
  baseline = current;
  console.log(`✓ Baseline file created: ${current} lines`);
}

const max = baseline + ALLOWED_DRIFT;

if (current > max) {
  console.error(`✗ Core size invariant violated!`);
  console.error(`  Baseline: ${baseline} lines`);
  console.error(`  Current:  ${current} lines`);
  console.error(`  Allowed:  ${max} lines (baseline + ${ALLOWED_DRIFT} drift)`);
  console.error(``);
  console.error(`  packages/core/ must stay minimal (spec §18 invariant #20).`);
  console.error(`  If this addition is approved, update the baseline:`);
  console.error(`    node scripts/lint-core-size.mjs --update-baseline`);
  process.exit(1);
} else {
  console.log(`✓ Core size OK: ${current}/${max} lines (baseline: ${baseline})`);
}
