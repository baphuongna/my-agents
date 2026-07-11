/**
 * ragfs scanner bridge (Phase 9 production wiring, review F1).
 *
 * The §8 R25-18 mandate is "ragfs is the AUTHORITATIVE scanner". To produce
 * a `RagfsScanner` from any scanner that takes a (content, scope)=>ScanVerdict
 * function (e.g. the prompts package's `scanInject`-derived closure), wrap it:
 *
 *   const scanner: RagfsScanner = makeRagfsScanner((content, scope) => scanInvokeFile(content, scope));
 *   ragfs.setScanner(scanner);
 *
 * This file lives in @my-agent/memory (not core) so the memory package can
 * produce RagfsScanner wrappers without importing prompts directly. The host
 * wires the prompts implementation at construction.
 */
import type { RagfsScanner } from "./ragfs.js";
import type { ScanVerdict } from "@my-agent/core";

/** Adapt a (content, scope) => ScanVerdict into a RagfsScanner. */
export function makeRagfsScanner(
  scan: (content: string, scope?: "context" | "wire" | "direct") => ScanVerdict,
): RagfsScanner {
  return {
    scan(content: string, scope?: "context" | "wire" | "direct"): ScanVerdict {
      return scan(content, scope);
    },
  };
}

/** A strict no-op RagfsScanner (every input is allowed). Useful for tests
 * where you want to exercise the router without the prompt-injection path. */
export const allowAllScanner: RagfsScanner = {
  scan: (_content: string): ScanVerdict => ({ allowed: true }),
};

/** A strict deny-all RagfsScanner. */
export const denyAllScanner: RagfsScanner = {
  scan: (_content: string): ScanVerdict => ({ allowed: false, reason: "deny-all scanner" }),
};
