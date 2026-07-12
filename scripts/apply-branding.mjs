#!/usr/bin/env node
/**
 * Apply mya branding to node_modules pi-coding-agent copy.
 * Run before bundle to ensure bundle has "mya" not "pi".
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const PI_NM = "node_modules/@earendil-works/pi-coding-agent/dist";

if (!existsSync(PI_NM)) {
  console.log("✓ pi-coding-agent not in node_modules, skipping branding");
  process.exit(0);
}

// Recursive find-replace in all .js files
function walk(dir, fn) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, fn);
    else if (entry.name.endsWith(".js")) fn(p);
  }
}

let count = 0;
walk(PI_NM, (file) => {
  let src = readFileSync(file, "utf8");
  const orig = src;
  // Branding replacements
  src = src.replace(/Pi can explain its own features[^`]*Pi\./g, "mya can explain its own features and look up its docs. Ask it how to use or extend mya.");
  src = src.replace(/pi exiting due to uncaughtException:/g, "mya exiting due to uncaughtException:");
  src = src.replace(/Restart pi for this to take effect/g, "Restart mya for this to take effect");
  src = src.replace(/then restart pi\./g, "then restart mya.");
  src = src.replace(/Start without extensions using "pi -ne"/g, 'Start without extensions using "mya -ne"');
  src = src.replace(/pi has joined Earendil/g, "mya");
  // pi-tui → mya/tui
  src = src.replace(/@earendil-works\/pi-tui/g, "@my-agent/tui");
  if (src !== orig) {
    writeFileSync(file, src);
    count++;
  }
});

console.log(`✓ branding applied to ${count} files in node_modules`);
