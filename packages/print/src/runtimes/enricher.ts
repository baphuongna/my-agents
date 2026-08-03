// packages/print/src/runtimes/enricher.ts
import type { PromptEnricher, EnrichContext } from "@my-agent/core";

const MAX_INJECTION_HITS = 5;
const MAX_INJECTION_CHARS = 2000;
const MAX_CAPTURE_CHARS = 4096;
const DEFAULT_NOTABILITY = 0.5;
const MIN_SCORE = 0.3;
const PER_HIT_BUDGET = Math.floor(MAX_INJECTION_CHARS / MAX_INJECTION_HITS); // 400

export class MemoryEnricher implements PromptEnricher {
  constructor(
    private memory?: { recall(query: string, opts?: { topK?: number }): any[] | Promise<any[]> },
    private brain?: { recordFact(fact: any): any },
  ) {}

  async enrich(prompt: string, ctx: EnrichContext): Promise<string> {
    if (!this.memory) return prompt;
    try {
      // MED-6 fix: await recall() (may be async in real MemoryManager)
      const results = await this.memory.recall(prompt, { topK: MAX_INJECTION_HITS });
      // MEDIUM-1 fix: recall returns one entry PER DOMAIN (up to 13).
      // Flatten ALL hits, then cap to MAX_INJECTION_HITS AFTER flattening
      // (was capped per-domain → could inject 13×5 = 65 hits = 26K chars).
      const hits = results?.flatMap((r: any) => r?.hits ?? []) ?? [];
      const filtered = hits
        .filter((h: any) => (h?.score ?? 0) >= MIN_SCORE && h?.content)
        // MEDIUM-2 fix: skip facts captured by THIS session (prevents echo)
        .filter((h: any) => !(h?.id ?? "").includes(`session:${ctx.sessionId}`))
        .sort((a: any, b: any) => (b?.score ?? 0) - (a?.score ?? 0))
        .slice(0, MAX_INJECTION_HITS);
      if (filtered.length === 0) return prompt;

      const memoryBlock = filtered
        .map((h: any, i: number) => `${i + 1}. ${h?.content ?? ""}`.slice(0, PER_HIT_BUDGET))
        .join("\n");

      return `<memory>\n${memoryBlock}\n</memory>\n\n${prompt}`;
    } catch {
      return prompt;
    }
  }

  async capture(output: string, ctx: EnrichContext): Promise<void> {
    if (!this.brain || !output.trim()) return;
    // MEDIUM-3 fix: skip capture for cron sessions — they accumulate facts
    // on every sweep and pollute the brain with repetitive job output.
    if (ctx.sessionId.startsWith("_cron:")) return;
    try {
      await this.brain.recordFact({
        kind: "event",
        entity: `session:${ctx.sessionId}`,
        content: output.slice(0, MAX_CAPTURE_CHARS),
        visibility: "private",
        notability: DEFAULT_NOTABILITY,
        source: "runtime-capture",
      });
    } catch {
      // never block on capture failure
    }
  }
}
