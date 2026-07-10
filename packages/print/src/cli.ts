#!/usr/bin/env node
/**
 * my-agent — print transport CLI entry.
 *
 * Usage:
 *   my-agent [--json] "your prompt"
 *   echo "prompt" | my-agent --json
 *
 * Tier-0: uses a MockProvider (no network). Real providers land in Tier 1
 * via the §6 registry. This exercises the full loop → RuntimeEvent → sink.
 */
import { createSession, freeBudget, runTurn } from "@my-agent/core";
import { textMock } from "@my-agent/ai";
import { makeSink } from "./index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  let prompt =
    positional.join(" ").trim() ||
    (await readStdin()) ||
    "Hello. (Tier 0 scaffold — no provider wired yet.)";

  const sink = makeSink({ json });
  const session = createSession({
    profiles: [textMock(`[Tier-0 mock echo] ${prompt}`)],
    stableTier: "You are my-agent (Tier 0 scaffold).",
  });

  const handle = runTurn({ session, budget: freeBudget() });
  handle.on(sink.write);

  const terminal = await handle.done;
  if (!json && terminal.state === "Failed") {
    process.exitCode = 1;
  }
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
