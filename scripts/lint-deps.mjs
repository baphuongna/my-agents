#!/usr/bin/env node
/**
 * Invariant #19 (transports depend on `core` only; no cross-transport imports).
 *
 * ESLint/madge are TS-7-incompatible (madge transitively pulls
 * @typescript-eslint/typescript-estree, which crashes on the native Go compiler).
 * This grep-based check enforces the invariant directly: for each transport
 * package, fail if its src/ imports ANY other transport. (A one-way tui→rpc
 * import is NOT a cycle, so `madge --circular` could not catch it.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TRANSPORTS = ["tui", "rpc", "sdk", "print"];
/** The CLI orchestrator entry point legitimately dispatches to ALL transports
 * (it's above the transport layer, not a transport-to-transport dependency). */
const ORCHESTRATOR_EXCEPTIONS = ["print/src/main.ts"];
const root = join(process.cwd(), "packages");
const offenders = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(m?ts|tsx?)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

for (const t of TRANSPORTS) {
  const pkgDir = join(root, t, "src");
  // Skip packages without src/ (e.g. tui is a pure re-export wrapper with only dist/).
  try { statSync(pkgDir); } catch { continue; }
  const others = TRANSPORTS.filter((x) => x !== t);
  const files = walk(pkgDir);
  for (const f of files) {
    // Skip the CLI orchestrator (legitimately imports all transports).
    if (ORCHESTRATOR_EXCEPTIONS.some((ex) => f.replace(/\\/g, "/").includes(ex))) continue;
    const text = readFileSync(f, "utf8");
    for (const o of others) {
      // match `... from "@my-agent/<other>"` or `... from "@my-agent/<other>/..."`
      const re = new RegExp(`from\\s+["']@my-agent/${o}(/|["'])`);
      if (re.test(text)) offenders.push(`${f}: imports @my-agent/${o} (cross-transport, invariant #19)`);
    }
  }
}

if (offenders.length > 0) {
  console.error(`✗ invariant #19 (no cross-transport imports) violated — ${offenders.length} site(s):`);
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("✓ lint:deps: invariant #19 (transports depend on core only) clean");
