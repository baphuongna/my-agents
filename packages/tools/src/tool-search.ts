/**
 * @my-agent/toolssearch — deferrable tool search (§4 R31 ToolSearch).
 *
 * Long-tail tools are kept OUT of the prompt until BM25-queried or
 * `select:`-activated; lazy activation when the token budget is exceeded. This
 * shrinks the tool schema in the system prompt (cheaper + room for context).
 *
 * Source: §4 Core Loop completeness (R31); hermes tool_search, claw-code tools.
 */
import { nativeApproxTokens } from "@my-agent/natives";

export interface ToolDoc {
  name: string;
  description: string;
  /** Declared arg names (indexed for BM25). */
  args?: string[];
  /** If true, the tool is hidden from the default prompt surface (deferrable). */
  deferrable?: boolean;
}

/** Index entry for BM25. */
interface Posting {
  name: string;
  /** term-frequency map for this doc. */
  tf: Map<string, number>;
  length: number;
}

/**
 * A ToolSearch index: BM25 over tool name+description+args. The active surface
 * starts with non-deferrable tools; deferrable ones are activated on query or
 * explicit `select:`. */
export class ToolSearch {
  private docs = new Map<string, ToolDoc>();
  private postings = new Map<string, Posting>();
  private df = new Map<string, number>(); // document frequency per term
  private avgLength = 0;
  /** Explicitly-activated tool names (via `select:`). */
  private activated = new Set<string>();

  /** Register a tool doc. */
  register(doc: ToolDoc): void {
    this.docs.set(doc.name, doc);
    const terms = tokenize(`${doc.name} ${doc.description} ${(doc.args ?? []).join(" ")}`);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.postings.set(doc.name, { name: doc.name, tf, length: terms.length });
    const seen = new Set<string>();
    for (const t of terms) {
      if (seen.has(t)) continue;
      seen.add(t);
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLength = this.recomputeAvg();
  }

  /** Explicitly activate a tool (e.g. `select:database_query`). */
  activate(name: string): void {
    this.activated.add(name);
  }

  /** The active surface: non-deferrable tools + activated deferrable ones. */
  activeSurface(): string[] {
    return [...this.docs.values()]
      .filter((d) => !d.deferrable || this.activated.has(d.name))
      .map((d) => d.name);
  }

  /** Compute the token cost of the current active surface's descriptions. */
  activeSurfaceTokens(): number {
    return this.activeSurface()
      .map((n) => this.docs.get(n)!)
      .reduce((sum, d) => sum + nativeApproxTokens(`${d.name} ${d.description}`), 0);
  }

  /**
   * If the active surface exceeds `budgetTokens`, drop deferrable tools until it
   * fits (lazy activation = the opposite — tools come back when searched).
   * Returns the trimmed surface.
   */
  fitBudget(budgetTokens: number): string[] {
    const surface = this.activeSurface();
    let cost = this.activeSurfaceTokens();
    if (cost <= budgetTokens) return surface;
    // drop deferrable (activated) tools from the back until it fits
    const kept: string[] = [];
    for (const name of surface) {
      const doc = this.docs.get(name)!;
      const tcost = nativeApproxTokens(`${doc.name} ${doc.description}`);
      if (doc.deferrable && cost > budgetTokens) {
        cost -= tcost;
        continue;
      }
      kept.push(name);
    }
    return kept;
  }

  /** BM25 search for tools matching a query; returns ranked names (best first). */
  search(query: string, k = 1.5, limit = 10): { name: string; score: number }[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const N = this.postings.size;
    const scores = new Map<string, number>();
    for (const term of terms) {
      const df = this.df.get(term) ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const p of this.postings.values()) {
        const tf = p.tf.get(term) ?? 0;
        if (tf === 0) continue;
        const denom = tf + k * (1 - 0.5 + 0.5 * (p.length / (this.avgLength || 1)));
        const contribution = (idf * (tf * (k + 1))) / denom;
        scores.set(p.name, (scores.get(p.name) ?? 0) + contribution);
      }
    }
    return [...scores.entries()]
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private recomputeAvg(): number {
    if (this.postings.size === 0) return 0;
    let total = 0;
    for (const p of this.postings.values()) total += p.length;
    return total / this.postings.size;
  }

  get size(): number {
    return this.docs.size;
  }
}

/** Tokenizer: lowercase + split on non-alphanumeric (keeps identifiers' parts). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
