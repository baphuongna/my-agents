#!/usr/bin/env node
// scripts/typecheck.mjs — HONEST per-package typecheck.
//
// WHY THIS EXISTS: the root `npm run typecheck` used to be `tsc --noEmit` on a
// root tsconfig.json with `"files": []` + `references`. In non-build mode, that
// checks ZERO files — a false green that hid real per-package errors (it once
// shipped a TS2352 cast bug in packages/memory). `tsc --build --noEmit` is also
// broken (TS6310 "Referenced project may not disable emit"). The only honest
// build-mode command (`tsc -b --force`) emits artifacts. So instead we run
// `tsc --noEmit -p <pkg>/tsconfig.json` per package and aggregate.
//
// This is HONEST: it exits non-zero if ANY package has type errors.
// Use `--json` for machine-readable output. Use `--pkg <name>` to check one.
//
// Usage:
//   npm run typecheck            # all packages
//   node scripts/typecheck.mjs --pkg memory   # one package (fast dev loop)
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const pkgIdx = argv.indexOf("--pkg");
const onlyPkg = pkgIdx !== -1 ? argv[pkgIdx + 1] : undefined;

const pkgsDir = join(process.cwd(), "packages");
let targets = readdirSync(pkgsDir).filter(
  (n) =>
    statSync(join(pkgsDir, n)).isDirectory() &&
    existsSync(join(pkgsDir, n, "tsconfig.json")),
);
if (onlyPkg) targets = targets.filter((p) => p === onlyPkg);

const CONCURRENCY = 6;

async function runOne(pkg) {
  const tsconfig = join(pkgsDir, pkg, "tsconfig.json");
  try {
    await execAsync(`npx tsc --noEmit -p ${JSON.stringify(tsconfig)}`, {
      maxBuffer: 40 * 1024 * 1024,
    });
    return { pkg, errors: 0 };
  } catch (e) {
    const out = `${e.stderr || ""}${e.stdout || ""}`;
    return { pkg, errors: (out.match(/error TS/g) || []).length };
  }
}

// Simple concurrency pool.
async function pool(items, fn, n) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve()
      .then(() => fn(item))
      .then((r) => {
        results.push(r);
        executing.delete(p);
      });
    executing.add(p);
    if (executing.size >= n) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

const started = Date.now();
const results = (await pool(targets, runOne, CONCURRENCY)).sort((a, b) =>
  a.pkg.localeCompare(b.pkg),
);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const failing = results.filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors);
const clean = results.filter((r) => r.errors === 0).map((r) => r.pkg);
const total = results.reduce((s, r) => s + r.errors, 0);

if (asJson) {
  process.stdout.write(JSON.stringify({ total, elapsed, clean, failing }));
  process.exit(failing.length > 0 ? 1 : 0);
}

const scope = onlyPkg ? `--pkg ${onlyPkg}` : "all packages";
console.log(`\nTypecheck [${scope}] — ${results.length} package(s), ${elapsed}s`);
if (clean.length && !onlyPkg) console.log(`✓ ${clean.length} clean: ${clean.join(", ")}`);
if (failing.length) {
  console.log(`\n✗ ${failing.length} package(s) with errors:`);
  for (const r of failing)
    console.log(`  ${String(r.errors).padStart(5)}  ${r.pkg}`);
  console.log(
    `\nTotal: ${total} error(s). See docs/TYPECHECK-BASELINE.md.`,
  );
} else {
  console.log("✓ No type errors.");
}
process.exit(failing.length > 0 ? 1 : 0);
