/**
 * Bench the pre-stream hot path. Times:
 *   - memory.refresh() across 6 file backends (was serial, now Promise.all)
 *   - FileBackend.read() cost at file_size=N
 *   - FileBackend.write() cost (was read+write whole file, now appendFile)
 *   - agent.prompt() with mock provider, populated memory (full pre-stream)
 *
 * Usage: node scripts/bench-pre-stream.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const dir = mkdtempSync(join(tmpdir(), "mya-bench-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const { FileBackend } = await import("../packages/memory/src/backends.ts");
const { MemoryManagerImpl } = await import("../packages/memory/src/manager.ts");
const { createAgent } = await import("../packages/agent/src/index.ts");

function hdr(s) { console.log(`\n=== ${s} ===`); }
function row(label, ms) { console.log(`  ${label.padEnd(40)} ${ms.toFixed(2).padStart(8)}ms`); }
async function time(label, fn, n = 1) {
  // warmup
  await fn();
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  row(label, median);
  return median;
}

const ROLES = ["working", "archivist", "tree", "diff", "goals", "sync"];
const ENTRIES_PER_ROLE = 200; // ~200 lines per role.md

// ─── 1. Populate: write ENTRIES_PER_ROLE entries to each role file ───────────
hdr("setup: populate 6 role files");
const writeBackends = {};
for (const r of ROLES) {
  const b = new FileBackend(r, dir);
  writeBackends[r] = b;
  for (let i = 0; i < ENTRIES_PER_ROLE; i++) {
    await b.write({ role: r, content: `entry ${i} for role ${r} with some text to make the line ~80 chars total` });
  }
}
console.log(`  wrote ${ROLES.length * ENTRIES_PER_ROLE} entries across ${ROLES.length} files`);

// ─── 2. MemoryManagerImpl.refresh() — the per-turn cost on the hot path ─────
hdr("MemoryManagerImpl.refresh() over 6 file backends (×20 turns)");
const mem = new MemoryManagerImpl();
for (const r of ROLES) mem.register(writeBackends[r]);
await time("refresh() median (6 file backends, ~200 lines each)", () => mem.refresh(), 20);

// ─── 3. FileBackend.write() — was O(file_size), now O(1) ───────────────────
hdr("FileBackend.write() at varying file sizes");
for (const size of [0, 100, 500, 2000]) {
  const b = new FileBackend("benchwrite", join(dir, `bw-${size}`));
  for (let i = 0; i < size; i++) {
    await b.write({ role: "benchwrite", content: `seed ${i}` });
  }
  await time(`write() into ${size}-line file`, () => b.write({ role: "benchwrite", content: "benchmark" }), 10);
}

// ─── 4. Full agent.prompt() with populated memory + mock provider ───────────
hdr("agent.prompt() with mock provider + populated memory (×5 turns)");
// Force the mock fallback by passing an explicit provider list (avoids the real
// MINIMAX_API_KEY in the dev env from making this a network benchmark).
const agent = createAgent({
  memoryDir: join(dir, "fresh-agent"),
  providers: [
    (await import("../packages/ai/src/mock.ts")).textMock("(no provider configured — mock echo)", "mock-bench"),
  ],
});
const agentDir = join(dir, "fresh-agent");
for (const r of ROLES) {
  const b = new FileBackend(r, agentDir);
  for (let i = 0; i < ENTRIES_PER_ROLE; i++) {
    await b.write({ role: r, content: `entry ${i} for role ${r} with some text to make the line ~80 chars total` });
  }
}
await agent.prompt("warmup"); // assemblePrompt first-time cost
await time("prompt() median (mock provider, 6 populated backends)", () => agent.prompt("hi"), 5);

// ─── 5. Baseline: the OLD write() pattern (read+write whole file) ───────────
// For comparison: how long the OLD FileBackend.write() would take. Implemented
// inline using the same primitives. This shows the cost we just eliminated.
hdr("BASELINE (pre-fix): FileBackend.write() old pattern = read+write whole file");
const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
async function oldWrite(path, line) {
  const existing = await rf(path, "utf8").catch(() => "");
  await wf(path, existing + line, "utf8");
}
for (const size of [0, 100, 500, 2000]) {
  const targetDir = join(dir, `oldwrite-${size}`);
  const { mkdir: mk } = await import("node:fs/promises");
  await mk(targetDir, { recursive: true });
  const p = join(targetDir, "oldwrite.md");
  for (let i = 0; i < size; i++) {
    await oldWrite(p, `seed ${i}\n`);
  }
  await time(`OLD write() into ${size}-line file`, () => oldWrite(p, "benchmark\n"), 10);
}

console.log(`\nbench dir: ${dir} (cleaned up on exit)`);
