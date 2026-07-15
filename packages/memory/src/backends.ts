/**
 * Memory backends (§8). A backend is a durability-classed write/read store.
 * The MemoryManager aggregates backends per role (archivist/tree/diff/...).
 *
 * Tier 1 ships: InMemoryBackend (default, BestEffort) + FileBackend (markdown
 * write-through, Durable). Vector/ragfs backends land Tier 2 as packages.
 *
 * Source: §8 Memory, openhuman #6, R27-18 (WriteResult/Durability/DrainReport).
 */
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Durability,
  MemoryEntry,
  MemoryHit,
  MemoryQuery,
  MemoryRoleId,
  WriteResult,
} from "@my-agent/core";

/** A backend store for memory entries of a given role. */
export interface MemoryBackend {
  readonly role: MemoryRoleId;
  readonly durability: Durability;
  /** §8 R27-4: an EXTERNAL backend (Qdrant/Composio/etc.). The one-external-provider
   * rule: addBackend() refuses a 2nd external backend. */
  readonly external?: boolean;
  write(entry: MemoryEntry): Promise<WriteResult>;
  read(query: MemoryQuery): Promise<MemoryHit[]>;
  /** §8: tree-store API the archivist uses to append cleaned conversation leaves. */
  appendTreeLeaf?(path: string, md: string): Promise<WriteResult>;
}

// ─── BM25 scoring (pure TS, no external deps) ────────────────────────────────

/** Tokenize text into lowercase word tokens. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** BM25 corpus statistics (computed once per read() call from all matching docs). */
export interface BM25Corpus {
  docCount: number;
  avgDocLength: number;
  /** term → number of documents containing it (document frequency). */
  docFreq: Map<string, number>;
}

/** Build BM25 corpus stats from an array of pre-tokenized documents. */
function buildCorpus(docs: string[][]): BM25Corpus {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const tokens of docs) {
    totalLen += tokens.length;
    const seen = new Set(tokens);
    for (const t of seen) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  return {
    docCount: docs.length,
    avgDocLength: docs.length > 0 ? totalLen / docs.length : 0,
    docFreq,
  };
}

/**
 * Compute BM25 score for a query-document pair.
 * Pure function, no external deps. k1=1.5, b=0.75 (standard Okapi defaults).
 *
 * When `corpus` is omitted, treats the document as a 1-doc corpus (useful for
 * testing / single-doc scoring). For proper ranking across many docs, pass a
 * pre-computed BM25Corpus from `buildCorpus`.
 */
export function bm25Score(
  query: string,
  document: string,
  corpus?: BM25Corpus,
  k1 = 1.5,
  b = 0.75,
): number {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(document);
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const docLen = docTokens.length;
  const N = corpus?.docCount ?? 1;
  const avgdl = corpus?.avgDocLength ?? docLen;

  // Term frequency in the document.
  const docTf = new Map<string, number>();
  for (const t of docTokens) docTf.set(t, (docTf.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of queryTokens) {
    const f = docTf.get(qt);
    if (!f) continue;
    const df = corpus?.docFreq.get(qt) ?? 1;
    // Okapi BM25 IDF (always positive with the +1 smoothing).
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const denom = f + k1 * (1 - b + (b * docLen) / avgdl);
    score += (idf * (f * (k1 + 1))) / denom;
  }
  return score;
}

// ─── InMemoryBackend (default; BestEffort; lost on restart) ──────────────────
export class InMemoryBackend implements MemoryBackend {
  readonly durability: Durability = "BestEffort";
  private entries: MemoryEntry[] = [];
  private nextId = 1;

  constructor(readonly role: MemoryRoleId, readonly external: boolean = false) {}

  async write(entry: MemoryEntry): Promise<WriteResult> {
    // Assign a STABLE id at write time (R39: was generated at read-time → non-deterministic).
    const withId: MemoryEntry & { id: string } = { ...entry, id: `mem-${this.role}-${this.nextId++}` };
    this.entries.push(withId);
    return { Ok: true };
  }

  /** §8: tree-store leaf append (archivist). Stored as a `tree` entry. */
  async appendTreeLeaf(path: string, md: string): Promise<WriteResult> {
    this.entries.push({ role: this.role, content: md, metadata: { path } });
    return { Ok: true };
  }

  async read(query: MemoryQuery): Promise<MemoryHit[]> {
    const q = query.text.toLowerCase();
    const topK = query.topK ?? 10;
    // MEDIUM-3 fix: include BOTH substring matches AND token matches.
    // Substring match with no token overlap gets score 0 (BM25) but is still included.
    const qTokens = q ? new Set(tokenize(q)) : null;
    const filtered = this.entries
      .filter((e) => e.role === (query.role ?? this.role))
      .filter((e) => {
        if (!q) return true;
        if (e.content.toLowerCase().includes(q)) return true; // substring match
        if (qTokens) {
          const tokens = new Set(tokenize(e.content.toLowerCase()));
          for (const t of qTokens) { if (tokens.has(t)) return true; } // token match
        }
        return false;
      });
    // Build corpus stats for BM25 ranking.
    const corpus = buildCorpus(filtered.map((e) => tokenize(e.content)));
    return filtered
      .map((e) => ({
        id: (e as MemoryEntry & { id?: string }).id ?? `mem-${this.role}-?`,
        role: e.role,
        content: e.content,
        score: bm25Score(query.text, e.content, corpus),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Test/inspection helper. */
  size(): number {
    return this.entries.length;
  }
}

// ─── FileBackend (markdown write-through; Durable) ───────────────────────────
/**
 * Appends each entry as a markdown bullet to `<dir>/<role>.md`. Survives restart.
 * Read scans the file for substring matches (Tier 1; BM25/vector Tier 2).
 */
export class FileBackend implements MemoryBackend {
  readonly durability: Durability = "Durable";

  constructor(
    readonly role: MemoryRoleId,
    private dir: string,
  ) {
    // Auto-create the memory dir on construction so `mya` (no args) works
    // without manual setup. Fire-and-forget; mkdir is idempotent + recursive.
    mkdir(this.dir, { recursive: true }).catch(() => { /* will retry on write */ });
  }

  private path(): string {
    return `${this.dir}/${this.role}.md`;
  }

  async write(entry: MemoryEntry): Promise<WriteResult> {
    // P0-perf: the file is an append-only markdown bullet log. Use appendFile
    // (O(1) per write) instead of read-then-write of the whole growing file.
    const line = `- [${entry.role}] ${entry.content.replace(/\n/g, " ")}\n`;
    try {
      await mkdir(dirname(this.path()), { recursive: true });
      await appendFile(this.path(), line, "utf8");
      return { Durable: true };
    } catch {
      // Spill: keep going in-memory equivalent (Tier 1 stub — full spill lands Tier 2).
      return { Spilled: { pendingCount: 1 } };
    }
  }

  async read(query: MemoryQuery): Promise<MemoryHit[]> {
    const content = await this.safeRead();
    const q = query.text.toLowerCase();
    const topK = query.topK ?? 10;
    // Scan ALL matching lines, score with BM25, then take top-K by score.
    const lines = content.split("\n");
    // MEDIUM-3 fix: include BOTH substring matches AND token matches
    const qTokens = q ? new Set(tokenize(q)) : null;
    const candidates: Array<{ id: string; content: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!line.startsWith("- ")) continue;
      const lower = line.toLowerCase();
      let match = !q;
      if (!match && lower.includes(q)) match = true; // substring match
      if (!match && qTokens) {
        const tokens = new Set(tokenize(lower));
        for (const t of qTokens) { if (tokens.has(t)) { match = true; break; } }
      }
      if (match) candidates.push({ id: `file-${this.role}-${i}`, content: line.slice(2) });
    }
    // Build corpus stats from all matching candidates.
    const corpus = buildCorpus(candidates.map((c) => tokenize(c.content)));
    return candidates
      .map((c) => ({
        id: c.id,
        role: this.role,
        content: c.content,
        score: bm25Score(query.text, c.content, corpus),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async safeRead(): Promise<string> {
    try {
      return await readFile(this.path(), "utf8");
    } catch {
      return "";
    }
  }
}
