/**
 * mya — 100% pi-coding-agent InteractiveMode with MiniMax-M3.
 *
 * Calls pi's main() directly with model=MiniMax-M3.
 * This gives the EXACT pi TUI — no modifications, no filtering, no reduction.
 */

import { main } from "@earendil-works/pi-coding-agent";

export async function runPiInteractive(): Promise<void> {
  // Pass --model MiniMax-M3 to pi's main(). All other args pass through.
  const args = ["--model", "MiniMax-M3", ...process.argv.slice(2)];
  await main(args, {});
}
