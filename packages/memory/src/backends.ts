/**
 * Memory backends (§8). A backend is a durability-classed write/read store.
 * The MemoryManager aggregates backends per role (archivist/tree/diff/...).
 *
 * Tier 1 ships: InMemoryBackend (default, BestEffort) + FileBackend (markdown
 * write-through, Durable). Vector/ragfs backends land Tier 2 as packages.
 *
 * Source: §8 Memory, openhuman #6, R27-18 (WriteResult/Durability/DrainReport).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
    return this.entries
      .filter((e) => e.role === (query.role ?? this.role))
      .filter((e) => !q || e.content.toLowerCase().includes(q))
      .slice(0, topK)
      .map((e) => ({
        id: (e as MemoryEntry & { id?: string }).id ?? `mem-${this.role}-?`,
        role: e.role,
        content: e.content,
        score: 1, // BM25/vector scoring lands Tier 2
      }));
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
    const line = `- [${entry.role}] ${entry.content.replace(/\n/g, " ")}\n`;
    try {
      await mkdir(dirname(this.path()), { recursive: true });
      const existing = await this.safeRead();
      await writeFile(this.path(), existing + line, "utf8");
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
    const hits: MemoryHit[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && hits.length < topK; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("- ") && (!q || line.toLowerCase().includes(q))) {
        hits.push({ id: `file-${this.role}-${i}`, role: this.role, content: line.slice(2), score: 1 });
      }
    }
    return hits;
  }

  private async safeRead(): Promise<string> {
    try {
      return await readFile(this.path(), "utf8");
    } catch {
      return "";
    }
  }
}
