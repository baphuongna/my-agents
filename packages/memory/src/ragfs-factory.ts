/**
 * createRagfs — Phase 10 production wiring. Builds a ready-to-use RagfsRouter
 * with the memory + knowledge sources registered + the scanner set. The host
 * (agent loop) calls this at startup:
 *
 *   const ragfs = createRagfs({ scanner: makeRagfsScanner(myScanFn) });
 *
 * Source: §8 R25-18 (ragfs is the authoritative scanner — read-on-read scan).
 */
import { RagfsRouter, type RagfsScanner, type ContextSource } from "./ragfs.js";

export interface CreateRagfsOptions {
  /** The prompt-injection scanner (required for R25-18 compliance). If absent,\n   * the router fails closed on read (throws). Wire via makeRagfsScanner. */
  scanner?: RagfsScanner;
  /** Additional sources to register (e.g. KnowledgeSource over a TypedGraph). */
  sources?: ContextSource[];
}

/** Build a RagfsRouter with the scanner + sources wired. */
export function createRagfs(opts: CreateRagfsOptions = {}): RagfsRouter {
  const router = new RagfsRouter();
  if (opts.scanner) router.setScanner(opts.scanner);
  for (const src of opts.sources ?? []) router.register(src);
  return router;
}
