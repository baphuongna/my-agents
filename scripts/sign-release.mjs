#!/usr/bin/env node
// scripts/sign-release.mjs — sigstore-sign every public package tarball at release.
// Outputs a JSON array of SigstoreBundle to stdout (the workflow attaches it to the release).
// Run AFTER `npm publish` (the tarballs are `npm pack`-ed here for signing).
// Source: §16 supply chain, §23 #6 (sigstore resolved).
import { writeFile } from "node:fs/promises";
import { signTarball } from "../packages/signing/dist/index.js";

const PUBLIC_PKGS = []; // populated from packages/*/package.json (private:false)
for (const [name, pkgPath] of Object.entries(pkgs())) {
  const { stdout } = await run("npm", ["pack", "--json"], pkgPath);
  const packInfo = JSON.parse(stdout)[0];
  const bundle = await signTarball({
    packageName: name,
    version: packInfo.version,
    tarballPath: packInfo.filename,
    signer: { issuer: "https://token.actions.githubusercontent.com", subject: process.env.GITHUB_REF_NAME },
  });
  PUBLIC_PKGS.push(bundle);
}
await writeFile("sigstore-bundles.json", JSON.stringify(PUBLIC_PKGS, null, 2));
console.log(`signed ${PUBLIC_PKGS.length} packages → sigstore-bundles.json`);

function pkgs() {
  // minimal glob of packages/* with private !== true
  const { readdirSync, readFileSync } = await importReadOnly();
  const out = {};
  for (const d of readdirSync("packages")) {
    try {
      const m = JSON.parse(readFileSync(`packages/${d}/package.json`, "utf8"));
      if (!m.private) out[m.name] = `packages/${d}`;
    } catch { /* skip */ }
  }
  return out;
}
async function importReadOnly() {
  const fs = await import("node:fs");
  return { readdirSync: fs.readdirSync, readFileSync: fs.readFileSync };
}
async function run(cmd, args, cwd) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.on("exit", (c) => (c === 0 ? resolve({ stdout }) : reject(new Error(`${cmd} exited ${c}`))));
  });
}
