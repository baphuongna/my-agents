/**
 * mya — 100% pi InteractiveMode CLONED into this repo.
 *
 * Uses vendored/pi/ (cloned source), NOT the npm package.
 * MiniMax-M3 as default model.
 */

// Import via package name — esbuild alias remaps to vendored/ at bundle time
import { main } from "@earendil-works/pi-coding-agent";

export async function runPiInteractive(): Promise<void> {
  // Skip version check (mya has its own version lifecycle)
  process.env.PI_SKIP_VERSION_CHECK = "1";
  const args = ["--model", "MiniMax-M3", "--no-extensions", ...process.argv.slice(2)];
  await main(args, {});
}
