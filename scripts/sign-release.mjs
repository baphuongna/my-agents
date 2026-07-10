#!/usr/bin/env node
// scripts/sign-release.mjs — sigstore-sign every public package tarball at release.
// Outputs a JSON array of SigstoreBundle to sigstore-bundles.json (attached to the release).
// Run AFTER `npm publish` (the release.yml workflow). Source: §16 supply chain, §23 #6.
import { writeFile, readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

// Gather public (non-private) packages.
const PUBLIC_PKGS = [];
for (const d of readdirSync("packages")) {
  try {
    const m = JSON.parse(readFileSync(`packages/${d}/package.json`, "utf8"));
    if (!m.private) PUBLIC_PKGS.push({ name: m.name, cwd: `packages/${d}` });
  } catch { /* skip non-package dirs */ }
}

const bundles = [];
for (const { name, cwd } of PUBLIC_PKGS) {
  const { stdout } = await run("npm", ["pack", "--json"], cwd);
  const packInfo = JSON.parse(stdout)[0];
  const { signTarball } = await import("../packages/signing/dist/index.js");
  const bundle = await signTarball({
    packageName: name,
    version: packInfo.version,
    tarballPath: packInfo.filename,
    signer: { issuer: "https://token.actions.githubusercontent.com", subject: process.env.GITHUB_REF_NAME },
  });
  bundles.push(bundle);
}
await writeFile("sigstore-bundles.json", JSON.stringify(bundles, null, 2));
console.log(`signed ${bundles.length} packages → sigstore-bundles.json`);

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.on("exit", (c) => (c === 0 ? resolve({ stdout }) : reject(new Error(`${cmd} exited ${c}`))));
  });
}
