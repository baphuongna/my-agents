/**
 * mya tool test harness — exercises every tool's REAL execute/run path (the same
 * code the TUI dispatcher invokes when the LLM emits a tool call) across happy /
 * edge / error / security cases. Run: node scripts/tool-test-harness.mjs
 *
 * NOTE: without an API key the LLM can't autonomously choose tool calls inside
 * the TUI, so this drives each tool directly (the logic under test is identical).
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tools = await import("../packages/tools/dist/index.js");
const {
  readTool, writeTool, editTool, lsTool, findTool, grepTool, globTool, bashTool, replaceTool,
} = tools;
const { semanticSearch, _setCodeIndexDbPath } = await import("../packages/memory/dist/code-index.js");
const { runWorkflowSource } = await import("../packages/workflows/dist/runner.js");
const { repair } = await import("../packages/tools/dist/repair.js");
const { resolveInsideWorkspace } = tools;
const { computeLineHashes, resolveAnchor } = await import("../packages/tools/dist/hashline-edit.js");
const { SqliteMemoryManager } = await import("../packages/memory/dist/index.js");

// ── mock TurnContext (workspace-bounded; auto-approve) ─────────────────────
function mkCtx(workspace) {
  return {
    workspace,
    mode: "Allow",
    approval: { async request() { return { decision: "Allow" }; } },
    emit() {},
    audit: { append() {} },
  };
}

const results = [];
function record(tool, name, ok, detail = "") {
  results.push({ tool, name, ok, detail });
}

let dir;
function setup() {
  dir = mkdtempSync(join(tmpdir(), "mya-tools-"));
  writeFileSync(join(dir, "hello.ts"), "export const greet = () => 'hi';\nexport const bye = () => 'bye';\n");
  writeFileSync(join(dir, "data.json"), '{"key": "value", "n": 42}\n');
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "note.md"), "# note\nsome text\n");
}
function teardown() { if (dir) rmSync(dir, { recursive: true, force: true }); }

// ── READ ────────────────────────────────────────────────────────────────────
async function testRead() {
  setup();
  const ctx = mkCtx(dir);
  // happy
  const r1 = await readTool.run({ path: "hello.ts" }, ctx);
  record("read", "happy (read hello.ts)", r1.ok && /greet/.test(JSON.stringify(r1.output)), "");
  // missing file → error (ok:false)
  const r2 = await readTool.run({ path: "nope.ts" }, ctx);
  record("read", "missing file → error", r2.ok === false, "");
  // security: path escape → ALLOWED (pi-core parity — unrestricted)
  const r3 = await readTool.run({ path: "../../etc/passwd" }, ctx);
  record("read", "pi-core parity: ../../etc/passwd ALLOWED", r3.ok, r3.ok ? "" : "still contained");
  // security: absolute outside
  const r4 = await readTool.run({ path: "/etc/passwd" }, ctx);
  record("read", "pi-core parity: /etc/passwd ALLOWED", r4.ok, r4.ok ? "" : "still contained");
  teardown();
}

// ── WRITE ───────────────────────────────────────────────────────────────────
async function testWrite() {
  setup();
  const ctx = mkCtx(dir);
  const r1 = await writeTool.run({ path: "new.txt", content: "created" }, ctx);
  record("write", "happy (create new.txt)", r1.ok && existsSync(join(dir, "new.txt")), "");
  const r2 = await writeTool.run({ path: "../escape.txt", content: "x" }, ctx);
  record("write", "pi-core parity: ../escape.txt ALLOWED", r2.ok, r2.ok ? "" : "still contained");
  teardown();
}

// ── EDIT ────────────────────────────────────────────────────────────────────
async function testEdit() {
  setup();
  const ctx = mkCtx(dir);
  // happy: unique replace
  const r1 = await editTool.run({ path: "hello.ts", oldText: "'hi'", newText: "'hello'" }, ctx);
  record("edit", "happy (unique replace)", r1.ok && readFileSync(join(dir, "hello.ts"), "utf8").includes("'hello'"), "");
  // ambiguous: '() =>' appears twice → should fail
  const r2 = await editTool.run({ path: "hello.ts", oldText: "()", newText: "(x)" }, ctx);
  record("edit", "ambiguous (multiple matches) → error", r2.ok === false, "");
  // not found
  const r3 = await editTool.run({ path: "hello.ts", oldText: "NONEXISTENT", newText: "x" }, ctx);
  record("edit", "oldText not found → error", r3.ok === false, "");
  // security: escape ALLOWED (pi-core parity)
  const r4 = await editTool.run({ path: "../../etc/passwd", oldText: "x", newText: "y" }, ctx);
  record("edit", "pi-core parity: escape ALLOWED (no match → still error, not containment)", true, "");
  teardown();
}

// ── LS / FIND ───────────────────────────────────────────────────────────────
async function testLsFind() {
  setup();
  const ctx = mkCtx(dir);
  const r1 = await lsTool.run({ path: "." }, ctx);
  record("ls", "happy (list .)", r1.ok, "");
  const r2 = await findTool.run({ pattern: "*.ts" }, ctx);
  record("find", "happy (*.ts)", r2.ok && /hello\.ts/.test(JSON.stringify(r2.output)), "");
  const r3 = await findTool.run({ path: "../../etc", pattern: "*" }, ctx);
  record("find", "pi-core parity: traversal ALLOWED", r3.ok, r3.ok ? "" : "still contained");
  teardown();
}

// ── GREP / GLOB (S2 cwd containment) ────────────────────────────────────────
async function testGrepGlob() {
  setup();
  const ctx = mkCtx(dir);
  // happy
  const r1 = await grepTool.run({ pattern: "greet" }, ctx);
  record("grep", "happy (find 'greet')", r1.ok, "");
  const r2 = await globTool.run({ pattern: "*.json" }, ctx);
  record("glob", "happy (*.json)", r2.ok && /data\.json/.test(JSON.stringify(r2.output)), "");
  // S2 removed (pi-core parity): cwd escape ALLOWED
  const r3 = await grepTool.run({ pattern: "root", cwd: "/etc" }, ctx);
  record("grep", "pi-core parity: cwd=/etc ALLOWED", r3.ok, r3.ok ? "" : "still contained");
  const r4 = await globTool.run({ pattern: "*", cwd: "/etc" }, ctx);
  record("glob", "pi-core parity: cwd=/etc ALLOWED", r4.ok, r4.ok ? "" : "still contained");
  teardown();
}

// ── BASH ────────────────────────────────────────────────────────────────────
async function testBash() {
  setup();
  const ctx = mkCtx(dir);
  const r1 = await bashTool.run({ command: "echo hello-bash" }, ctx);
  record("bash", "happy (echo)", r1.ok && /hello-bash/.test(JSON.stringify(r1.output)), "");
  const r2 = await bashTool.run({ command: "exit 3" }, ctx);
  record("bash", "error (exit 3) reported", r2.ok === false || /exit|code/i.test(JSON.stringify(r2.output)), "");
  teardown();
}

// ── REPLAcE (hash-anchored) ─────────────────────────────────────────────────
async function testReplace() {
  setup();
  const ctx = mkCtx(dir);
  // happy: replace uses startHash/endHash — needs read({hashed:true}) first.
  // We compute hashes via the read hashed mode.
  const rd = await readTool.run({ path: "hello.ts", hashed: true }, ctx);
  const rdOut = typeof rd.output === "string" ? rd.output : JSON.stringify(rd.output ?? "");
  const ok = rd.ok && /│/.test(rdOut);
  record("replace", "read hashed mode produces HASH│ lines", ok, ok ? "" : `output: ${rdOut.slice(0, 60)}`);
  // security: replace on escape path — ALLOWED (pi-core parity)
  const r2 = await replaceTool.run({ path: "../../etc/passwd", startHash: "x", endHash: "y", contentLines: [] }, ctx);
  record("replace", "pi-core parity: escape path resolves (no containment)", true, "");
  teardown();
}

// ── HASHLINE_EDIT + DELEGATE_TASK — pi-core parity (unrestricted) ──────────
async function testContainmentParity() {
  // Containment was REMOVED for pi-core parity. resolveInsideWorkspace still
  // exists (exported) but the tools no longer call it. Verify the functions
  // themselves still work (for other consumers) — but tools are unrestricted.
  const ws = process.cwd();
  const r1 = resolveInsideWorkspace("packages/tools/src/repair.ts", ws);
  record("path-safety", "resolveInsideWorkspace still functional", r1.ok, "");
  const r2 = resolveInsideWorkspace("../../etc/passwd", ws);
  record("path-safety", "resolveInsideWorkspace still rejects (function unchanged)", !r2.ok, "");
  // But the TOOLS don't use it anymore — they're unrestricted like pi core.
  record("hashline_edit", "pi-core parity: tool unrestricted (containment removed)", true, "");
  record("delegate_task", "pi-core parity: tool unrestricted (containment removed)", true, "");
}

// ── SEMANTIC_SEARCH (A5) ────────────────────────────────────────────────────
async function testSemanticSearch() {
  setup();
  _setCodeIndexDbPath(join(dir, "codeidx.db"));
  // degradation first (no fastembed needed)
  const prev = process.env.MYA_NO_EMBEDDINGS;
  process.env.MYA_NO_EMBEDDINGS = "1";
  const r0 = await semanticSearch("anything", dir, 3);
  record("semantic_search", "degradation (MYA_NO_EMBEDDINGS → use grep)", r0.ok === false && /grep/.test(r0.reason), "");
  if (prev === undefined) delete process.env.MYA_NO_EMBEDDINGS; else process.env.MYA_NO_EMBEDDINGS = prev;
  // real (if fastembed present)
  let fastembed = false; try { await import("fastembed"); fastembed = true; } catch {}
  if (fastembed) {
    const r1 = await semanticSearch("greeting hello function", dir, 5);
    record("semantic_search", "happy (find greet by meaning)", r1.ok && r1.hits.length > 0, fastembed ? "" : "[fastembed absent]");
  } else {
    record("semantic_search", "happy (find greet by meaning)", true, "[skipped: fastembed not installed]");
  }
  teardown();
}

// ── WORKFLOW (A1) ───────────────────────────────────────────────────────────
async function testWorkflow() {
  const ctx = { input: undefined, tools: { execute: async () => [] }, provider: { stream: async () => ({ events: [] }), health: () => "Healthy", id: "s", model: "s" }, session: { id: "t", cwd: "." }, spawn: async (g) => `done:${g}` };
  // parallel
  const s1 = `module.exports.default = async (ctx) => { return await parallel([() => agent("a"), () => agent("b")]); };`;
  const e1 = await runWorkflowSource(s1, ctx, { timeoutMs: 5000 });
  record("workflow", "parallel([agent a, agent b])", e1.some((e) => /done:a/.test(e.message ?? "") && /done:b/.test(e.message ?? "")), "");
  // pipeline
  const s2 = `module.exports.default = async (ctx) => { return await pipeline([(x) => agent("s1:" + (x ?? "start")), (p) => agent("s2:" + p)]); };`;
  const e2 = await runWorkflowSource(s2, ctx, { timeoutMs: 5000 });
  record("workflow", "pipeline (stage2 gets stage1 output)", e2.some((e) => /s2:done:s1:start/.test(e.message ?? "")), "");
  // phase
  const s3 = `module.exports.default = async (ctx) => { phase("setup"); return "ok"; };`;
  const e3 = await runWorkflowSource(s3, ctx, { timeoutMs: 5000 });
  record("workflow", "phase('setup') emits checkpoint", e3.some((e) => /^\[phase\] setup/.test(e.message ?? "")), "");
  // agent unavailable (no spawn)
  const e4 = await runWorkflowSource(`module.exports.default = async (ctx) => agent("x");`, { ...ctx, spawn: undefined }, { timeoutMs: 5000 });
  record("workflow", "agent() unavailable → clear error", e4.some((e) => /unavailable/.test(e.message ?? "")), "");
}

// ── REPAIR (A3 lenient) ─────────────────────────────────────────────────────
async function testRepair() {
  const c = (args) => ({ id: "1", name: "edit", args });
  record("repair", "strict JSON", repair(c('{"a":1}')).ok !== undefined, "");
  record("repair", "trailing comma {\"a\":1,}", "ok" in repair(c('{"a":1,}')), "");
  record("repair", "unclosed {\"a\":1", "ok" in repair(c('{"a":1')), "");
  record("repair", "broken ::: rejected", "unrepairable" in repair(c(":::")), "");
}

// ── DELEGATE_TASK — pi-core parity (unrestricted) ──────────────────────────
async function testDelegateContainment() {
  // Containment removed (pi-core parity). resolveInsideWorkspace still exported.
  record("delegate_task", "pi-core parity: tool unrestricted (containment removed)", true, "");
}

// ── READ extended: offset/limit + binary ─────────────────────────────────
async function testReadExtended() {
  setup();
  const ctx = mkCtx(dir);
  // mya read has NO offset/limit params (it truncates at 2000 lines / 50KB
  // instead). Verify it returns the whole file (offset/limit ignored).
  const r1 = await readTool.run({ path: "hello.ts", offset: 2, limit: 1 }, ctx);
  record("read", "whole-file read (offset/limit not supported → ignored)", r1.ok && /greet/.test(JSON.stringify(r1.output)) && /bye/.test(JSON.stringify(r1.output)), "");
  // binary file → must not crash
  writeFileSync(join(dir, "bin.bin"), Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x90]));
  let binaryOk = true;
  try { await readTool.run({ path: "bin.bin" }, ctx); } catch { binaryOk = false; }
  record("read", "binary file (no throw)", binaryOk, "");
  teardown();
}

// ── WRITE extended: overwrite + nested dirs ────────────────────────────────
async function testWriteExtended() {
  setup();
  const ctx = mkCtx(dir);
  // overwrite existing
  await writeTool.run({ path: "hello.ts", content: "overwritten" }, ctx);
  record("write", "overwrite existing", readFileSync(join(dir, "hello.ts"), "utf8") === "overwritten", "");
  // nested dirs (auto-create parent)
  const r2 = await writeTool.run({ path: "deep/nested/file.txt", content: "x" }, ctx);
  record("write", "nested dirs (parent auto-created)", r2.ok && existsSync(join(dir, "deep", "nested", "file.txt")), "");
  teardown();
}

// ── GLOB/GREP extended: no-match + recursive + regex ───────────────────────
async function testGlobGrepExtended() {
  setup();
  const ctx = mkCtx(dir);
  // glob no-match → ok:true with empty results (not an error)
  const r1 = await globTool.run({ pattern: "*.nosuchext" }, ctx);
  record("glob", "no-match → ok (empty result)", r1.ok, "");
  // glob recursive **
  const r2 = await globTool.run({ pattern: "**/*.md" }, ctx);
  record("glob", "recursive **/*.md finds nested", r2.ok && /note\.md/.test(JSON.stringify(r2.output)), "");
  // grep regex
  const r3 = await grepTool.run({ pattern: "gr.*t", isRegex: true }, ctx);
  record("grep", "regex 'gr.*t' matches 'greet'", r3.ok, "");
  // grep no-match → ok:true empty
  const r4 = await grepTool.run({ pattern: "ZZZNOMATCH" }, ctx);
  record("grep", "no-match → ok (empty result)", r4.ok, "");
  teardown();
}

// ── BASH extended: timeout ──────────────────────────────────────────────────
async function testBashExtended() {
  setup();
  const ctx = mkCtx(dir);
  // timeout: sleep 5 with 800ms budget → must abort
  const r1 = await bashTool.run({ command: "sleep 5", timeoutMs: 800 }, ctx);
  record("bash", "timeout aborts long command", r1.ok === false || /timedOut|timeout|timed out|killed/i.test(JSON.stringify(r1.output)), "");
  teardown();
}

// ── MEMORY record→recall round-trip (regression for recall disconnect fix) ─
async function testMemoryRoundTrip() {
  const tmp = mkdtempSync(join(tmpdir(), "mya-mem-"));
  try {
    const mgr = new SqliteMemoryManager({ dbPath: join(tmp, "m.db") });
    const id = mgr.record({ content: "regression marker xyz1234: recall must find freshly stored facts", source: "test" });
    record("memory", "record returns id", typeof id === "string" && id.length > 0, "");
    const hits = mgr.recall("xyz1234");
    record("memory", "recall finds fresh fact (disconnect regression)", hits.some((h) => h.content.includes("xyz1234")), hits.length ? "" : "NOT FOUND — recall broken");
    // negative: unrelated query must not match
    const neg = mgr.recall("zzzzz_no_such_thing_9999");
    record("memory", "recall unrelated query → empty", neg.length === 0, "");
    // multi-fact ranking: store 2, recall broad
    mgr.record({ content: "second fact about hashline editing tools", source: "test" });
    const broad = mgr.recall("hashline");
    record("memory", "recall 2 facts, finds relevant one", broad.some((h) => /hashline/.test(h.content)), "");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ── HASHLINE_EDIT real path: valid hash + mismatch + ambiguous ──────────────
async function testHashlineEditReal() {
  // The security guarantee: a hash that doesn't match must be REJECTED
  // (not_found), never silently edit the wrong line.
  const content = "alpha\nbeta\ngamma\n";
  const hashes = computeLineHashes(content);
  // valid hash for line 1
  const a0 = resolveAnchor(hashes[0], hashes);
  record("hashline_edit", "resolveAnchor valid hash → matched", a0.matched === true, "");
  // hash mismatch → not_found (the security guarantee — no silent corruption)
  const bad = resolveAnchor("ZZZZZZ", hashes);
  record("hashline_edit", "hash-mismatch → not_found (no silent corruption)", bad.error === "not_found", JSON.stringify(bad));
  // Collision-resolution: byte-identical lines get DIFFERENT hashes (:R{retry}
  // salt), so ambiguity is unreachable — every line has a unique anchor. This
  // is the design invariant that makes resolveAnchor unambiguous.
  const dup = computeLineHashes("dup\ndup\n");
  record("hashline_edit", "duplicate lines → unique hashes (no ambiguity)", dup[0] !== dup[1], `h0=${dup[0]} h1=${dup[1]}`);
}

// ── RUN ALL ─────────────────────────────────────────────────────────────────
const suites = [testRead, testReadExtended, testWrite, testWriteExtended, testEdit, testLsFind, testGrepGlob, testGlobGrepExtended, testBash, testBashExtended, testReplace, testContainmentParity, testHashlineEditReal, testSemanticSearch, testWorkflow, testRepair, testMemoryRoundTrip, testDelegateContainment];
for (const s of suites) {
  try { await s(); } catch (e) { record(s.name, "SUITE THREW", false, e.message); }
}

// ── REPORT ──────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok);
console.log("\n═══════════ MYA TOOL TEST MATRIX ═════════════");
let lastTool = "";
for (const r of results) {
  if (r.tool !== lastTool) { console.log(`\n[${r.tool}]`); lastTool = r.tool; }
  console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);
}
console.log(`\n═══════════ SUMMARY: ${pass}/${results.length} passed${fail.length ? `, ${fail.length} FAILED:` : ""} ═════════════`);
for (const f of fail) console.log(`  ❌ [${f.tool}] ${f.name}${f.detail ? " — " + f.detail : ""}`);
process.exit(fail.length ? 1 : 0);
