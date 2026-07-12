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
function loadAuthConfig(): void {
  try {
    const authPath = join(homedir(), ".mya", "agent", "auth.json");
    const raw = readFileSync(authPath, "utf8");
    const auth = JSON.parse(raw) as Record<string, unknown>;
    // MiniMax: { minimax: { key: "sk-..." } } → MINIMAX_API_KEY
    const minimax = auth["minimax"] as Record<string, unknown> | undefined;
    if (minimax?.["key"] && !process.env["MINIMAX_API_KEY"]) {
      process.env["MINIMAX_API_KEY"] = String(minimax["key"]);
    }
    // OpenAI: { openai: { key: "sk-..." } } → OPENAI_API_KEY
    const openai = auth["openai"] as Record<string, unknown> | undefined;
    if (openai?.["key"] && !process.env["OPENAI_API_KEY"]) {
      process.env["OPENAI_API_KEY"] = String(openai["key"]);
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
