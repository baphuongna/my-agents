/**
 * Concrete compressors (§5) — behind the DriftGrader.
 *
 * Tier 1 ships:
 *   - windowCompressor: deterministic rolling window (keeps last N entries,
 *     drops older). Zero model cost. The verifiable baseline.
 *   - summarizeCompressor: collapses older entries into one summary via an
 *     auxiliary provider (§6 AuxiliaryProvider — invariant #8: separate alloc,
 *     never touches the main prompt cache). Degraded to window when no provider.
 *
 * The DriftGrader gates any compressor: if it drifts the model's answer, the
 * loop refuses to apply it (§5 accuracy-preservation gate).
 *
 * Source: §5 Prompt System, headroom #4 compression, R26-F.
 */
import type { Compressor, ProviderProfile } from "@my-agent/core";
import { nativeCompressLog } from "@my-agent/natives";

/**
 * Overflow-recovery compaction (§4 R31): on a `context_length_exceeded` stop,
 * drop the failed message, compact the history, and signal retry. Returns the
 * compacted history + whether a retry should run. Never loses the most recent
 * user turn (the live-zone tail is always kept). */
export function overflowRecovery(opts: {
  history: unknown[];
  keepTail: number;
  maxTokens: number;
  estimateTokens: (entry: unknown) => number;
}): { history: unknown[]; retry: boolean; dropped: number } {
  const { history, keepTail, estimateTokens } = opts;
  const total = history.reduce<number>((s, h) => s + estimateTokens(h), 0);
  if (total <= opts.maxTokens) return { history, retry: false, dropped: 0 };
  // keep the tail (live zone) + compact the head into one summary marker
  const tail = history.slice(Math.max(0, history.length - keepTail));
  const head = history.slice(0, Math.max(0, history.length - keepTail));
  const dropped = head.length;
  const compacted = [
    { role: "system", content: `[overflow-recovery: compacted ${dropped} earlier entries to fit context window]` },
    ...tail,
  ];
  return { history: compacted, retry: dropped > 0, dropped };
}

/**
 * Native-backed content compressor (§5/§2 Rust gate) — compacts tool/log output
 * via the Rust `compress_log` (truncate long lines + collapse repeated runs).
 * Deterministic, zero model cost. Stringifies each history entry, compacts the
 * concatenated text, returns a single `[compacted]` entry. Use behind the
 * DriftGrader like any other compressor.
 */
export function nativeContentCompressor(opts?: {
  maxLineLen?: number;
  collapseRun?: number;
}): Compressor {
  return {
    compress: (history: unknown[]) => {
      const text = history.map((h) => (typeof h === "string" ? h : JSON.stringify(h))).join("\n");
      const res = nativeCompressLog(text, opts ?? {});
      return [{ role: "system", content: `[compacted ${res.originalLines}→${res.compressedLines} lines]\n${res.text}` }];
    },
    ratio: () => 1,
  };
}

/**
 * Rolling-window compressor — keeps the last `maxEntries` history items,
 * drops the rest. Deterministic (identical input → identical output).
 */
export function windowCompressor(maxEntries: number): Compressor {
  return {
    compress: (history: unknown[]) => {
      if (history.length <= maxEntries) return [...history];
      return history.slice(history.length - maxEntries);
    },
    ratio: () => 1, // recomputed per-call; placeholder for the interface
  };
}

/**
 * Summarize compressor — collapses older entries (beyond `keep`) into a single
 * summary string via an auxiliary provider. Falls back to windowing when no
 * provider is wired (Tier 1 graceful degradation).
 *
 * NOTE: the summary is produced by a SEPARATE AuxiliaryProvider (invariant #8),
 * never the main turn profile. The summary replaces the dropped prefix.
 */
export function summarizeCompressor(
  keep: number,
  auxiliary?: ProviderProfile,
): Compressor & { compressAsync(history: unknown[]): Promise<unknown[]> } {
  const window = windowCompressor(keep);
  return {
    compress: (history: unknown[]) => window.compress(history), // sync fallback
    compressAsync: async (history: unknown[]) => {
      if (!auxiliary || history.length <= keep) return window.compress(history);
      const dropped = history.slice(0, history.length - keep);
      const kept = history.slice(history.length - keep);
      try {
        const { events } = await auxiliary.stream(
          { stable: "Summarize the following history concisely, preserving key facts.", context: "", volatile: JSON.stringify(dropped) },
          { append() {}, entries: () => [] },
        );
        const summary = events
          .filter((e) => e.kind === "text")
          .map((e) => (e.kind === "text" ? e.text : ""))
          .join("");
        return [{ role: "system", content: `[summary] ${summary}` }, ...kept];
      } catch {
        // auxiliary failed → degrade to window (never lose the kept tail)
        return window.compress(history);
      }
    },
    ratio: () => 1,
  };
}
