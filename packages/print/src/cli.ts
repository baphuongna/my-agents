#!/usr/bin/env node
/**
 * my-agent — print transport CLI entry (full e2e wiring).
 *
 * Usage:
 *   my-agent [--json] [--model <m>] "your prompt"
 *   echo "prompt" | my-agent --json
 *
 * Auto-config (zero-config when possible):
 *   - OPENAI_API_KEY set → real OpenAI adapter (model: --model or gpt-4o-mini)
 *   - no key             → mock echo fallback (agent still runs)
 * Memory: durable under ~/.my-agent/memory/ (archivist + goals roles).
 */
import { createAgent } from "@my-agent/agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { makeSink } from "./index.js";

/** Load MiniMax/OpenAI keys from ~/.mya/agent/auth.json if not already in env. */
// P8-P1/P6 (Hermes distillation 2026-07-24): env denylist + value sanitization.
// Denylist blocks loader/linker/python/node vars that a malicious auth.json
// could plant to gain RCE on next subprocess. Line-safe values strip CR/LF/NUL
// so a pasted secret with embedded separators can't inject a new env line.
const DENYLISTED_ENV_VARS: ReadonlySet<string> = new Set([
  "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
  "NODE_OPTIONS", "NODE_PATH",
  "PATH", "SHELL", "BROWSER", "EDITOR", "VISUAL", "PAGER",
  "GIT_SSH_COMMAND", "GIT_EXEC_PATH",
  "MYA_HOME", "MYA_CONFIG", "MYA_ENV",
]);
function envLineSafe(value: string): string {
  // Strip NUL + all line separators (CR/LF/CRLF/Unicode LS/PS).
  return value.replace(/\x00/g, "").replace(/[\r\n\u2028\u2029]+/g, "");
}
function isValidEnvName(name: string): boolean {
  // POSIX env-var name: [A-Za-z_][A-Za-z0-9_]*
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
function setEnvIfAllowed(name: string, value: string): boolean {
  if (DENYLISTED_ENV_VARS.has(name)) return false;
  if (!isValidEnvName(name)) return false;
  if (process.env[name]) return false; // env wins
  process.env[name] = envLineSafe(value);
  return true;
}
function loadAuthConfig(): void {
  try {
    const authPath = join(homedir(), ".mya", "agent", "auth.json");
    const raw = readFileSync(authPath, "utf8");
    const auth = JSON.parse(raw) as Record<string, unknown>;
    // MiniMax: { minimax: { key: "sk-..." } } → MINIMAX_API_KEY
    const minimax = auth["minimax"] as Record<string, unknown> | undefined;
    if (minimax?.["key"] && !process.env["MINIMAX_API_KEY"]) {
      process.env["MINIMAX_API_KEY"] = envLineSafe(String(minimax["key"]));
    }
    // OpenAI: { openai: { key: "sk-..." } } → OPENAI_API_KEY
    const openai = auth["openai"] as Record<string, unknown> | undefined;
    if (openai?.["key"] && !process.env["OPENAI_API_KEY"]) {
      process.env["OPENAI_API_KEY"] = envLineSafe(String(openai["key"]));
    }
    // Generic env overrides: { env: { VAR: "value" } } → process.env (if not preset).
    const envCfg = (auth as Record<string, unknown>)["env"] as Record<string, unknown> | undefined;
    if (envCfg && typeof envCfg === "object") {
      for (const [k, v] of Object.entries(envCfg)) {
        if (typeof v === "string") setEnvIfAllowed(k, v);
      }
    }
  } catch { /* auth.json absent or unreadable — fall through to env/mock */ }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const positional = args.filter((a) => !a.startsWith("--") && a !== model);
  const prompt =
    positional.join(" ").trim() ||
    (await readStdin()) ||
    "Hello. (No prompt given — running with mock fallback.)";

  // Load auth from ~/.mya/agent/auth.json if env vars aren't set.
  loadAuthConfig();

  const agent = createAgent({
    model,
    memoryDir: join(homedir(), ".my-agent", "memory"),
  });

  const sink = makeSink({ json });
  await agent.run(prompt, sink.write);

  const profile = process.env["MINIMAX_API_KEY"] ? "minimax" : process.env["OPENAI_API_KEY"] ? "openai" : "mock-fallback";
  if (!json) process.stderr.write(`[provider: ${profile}]\n`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
