/**
 * mya — 100% pi InteractiveMode CLONED into this repo.
 *
 * Uses vendored/pi/ (cloned source), NOT the npm package.
 * MiniMax-M3 as default model.
 */

// Import via package name — esbuild alias remaps to vendored/ at bundle time
import { main } from "@earendil-works/pi-coding-agent";

export async function runPiInteractive(): Promise<void> {
  const args = ["--model", "MiniMax-M3", "--no-extensions", ...process.argv.slice(2)];
  await main(args, {});
}
