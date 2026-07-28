/**
 * @my-agent/memory/brain-store — Full-fidelity persistence for Brain state.
 *
 * Replaces the lossy `[kind|entity] content` markdown serialization with a
 * JSONL append-only format that round-trips ALL fields of Fact, Take, and
 * BrainPage — including consolidatedAt, consolidatedInto, notability,
 * visibility, validUntil, source, and tier labels.
 *
 * Design:
 *   - Each line in brain.jsonl is a typed JSON object: {type, id, ...fields}
 *   - Append-only writes (O(1) per write, no rewrite)
 *   - Id-based upsert: on load, last entry per id wins (natural upsert)
 *   - Full fidelity: every Fact/Take/Page field is serialized
 *   - Crash-safe: incomplete last line is skipped on load
 *   - Compaction: periodic rewrite to remove tombstoned/deleted entries
 *
 * Sources:
 *   - agentmemory: KV scope-based persistence, full object serialization
 *   - codebase-memory-mcp: SQLite with typed schema (we use JSONL for simplicity)
 *   - spec §8 R27-18: Durable writes, crash recovery
 *   - spec R35: facts marked consolidated_at never deleted (preserved across restart)
 *
 * File location: ~/.mya/memory/brain.jsonl
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { nowWallclock } from "@my-agent/core";
import type { Fact, Take, BrainPage, FactKind, FactVisibility } from "./brain.js";
import type { Tier } from "./tree.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** A single line in brain.jsonl — discriminated by `type`. */
export type BrainRecord =
  | { type: "fact"; data: Fact; tier: Tier }
  | { type: "take"; data: Take; tier: Tier }
  | { type: "page"; data: BrainPage; tier: Tier }
  | { type: "tombstone"; id: string; deletedAt: number };

/** Result of loading from disk. */
export interface BrainSnapshot {
  facts: Map<string, Fact>;
  takes: Map<string, Take>;
  pages: Map<string, BrainPage>;
  tombstones: Map<string, { fact: Fact; deletedAt: number }>;
  tierMap: Map<string, Tier>;
}

// ── BrainStore ────────────────────────────────────────────────────────────

/**
 * @deprecated Superseded by SqliteBrainStore (Dig 3) when MYA_MEMORY_BACKEND=sqlite.
 * Still used for the default InMemory path (zero-behavior-change backward compat).
 * Do not use for new durable storage.
 */
export class BrainStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private recordCount = 0;
  private loaded = false;

  constructor(dir: string) {
    this.filePath = join(dir, "brain.jsonl");
    // Ensure directory exists
    void mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
  }

  // ── Write operations (all go through a serialized queue) ────────────────

  /** Persist a fact (upsert — appends new version, load picks last). */
  persistFact(fact: Fact, tier: Tier = "L0"): Promise<void> {
    return this.enqueue(async () => {
      await this.append({ type: "fact", data: fact, tier });
    });
  }

  /** Persist a take (upsert). */
  persistTake(take: Take, tier: Tier = "L1"): Promise<void> {
    return this.enqueue(async () => {
      await this.append({ type: "take", data: take, tier });
    });
  }

  /** Persist a page (upsert). */
  persistPage(page: BrainPage, tier: Tier = "L2"): Promise<void> {
    return this.enqueue(async () => {
      await this.append({ type: "page", data: page, tier });
    });
  }

  /** Record a tombstone (soft-delete marker). */
  persistTombstone(id: string, deletedAt: number): Promise<void> {
    return this.enqueue(async () => {
      await this.append({ type: "tombstone", id, deletedAt });
    });
  }

  /** Persist multiple takes at once (batch — for after consolidation). */
  persistTakes(takes: Take[], tier: Tier = "L1"): Promise<void> {
    return this.enqueue(async () => {
      const lines = takes.map((t) => JSON.stringify({ type: "take", data: t, tier }) + "\n").join("");
      if (lines) await this.appendRaw(lines);
    });
  }

  // ── Read operations ─────────────────────────────────────────────────────

  /**
   * Load the full Brain snapshot from disk.
   * Reads all lines, picks the last entry per id (natural upsert).
   * Incomplete/corrupt lines are silently skipped.
   */
  async load(): Promise<BrainSnapshot> {
    const snapshot: BrainSnapshot = {
      facts: new Map(),
      takes: new Map(),
      pages: new Map(),
      tombstones: new Map(),
      tierMap: new Map(),
    };

    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      this.loaded = true;
      return snapshot; // File doesn't exist yet — fresh start
    }

    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      let record: BrainRecord;
      try {
        record = JSON.parse(line) as BrainRecord;
      } catch {
        continue; // Corrupt line — skip
      }
      switch (record.type) {
        case "fact": {
          // Last-write-wins: overwrites previous entry with same id
          snapshot.facts.set(record.data.id, record.data);
          snapshot.tierMap.set(record.data.id, record.tier);
          // If this fact was previously tombstoned, remove the tombstone
          snapshot.tombstones.delete(record.data.id);
          break;
        }
        case "take": {
          snapshot.takes.set(record.data.id, record.data);
          snapshot.tierMap.set(record.data.id, record.tier);
          break;
        }
        case "page": {
          snapshot.pages.set(record.data.id, record.data);
          snapshot.tierMap.set(record.data.id, record.tier);
          break;
        }
        case "tombstone": {
          // Tombstone marks a fact as soft-deleted
          const fact = snapshot.facts.get(record.id);
          if (fact) {
            snapshot.tombstones.set(record.id, { fact, deletedAt: record.deletedAt });
            snapshot.facts.delete(record.id);
            snapshot.tierMap.delete(record.id);
          }
          break;
        }
      }
    }

    this.loaded = true;
    this.recordCount = lines.filter((l) => l.trim()).length;
    return snapshot;
  }

  // ── Compaction ──────────────────────────────────────────────────────────

  /**
   * Rewrite the file with only live entries (no duplicates, no expired tombstones).
   * Call periodically to prevent unbounded growth.
   * Atomic: write to temp file, then rename.
   */
  async compact(snapshot: BrainSnapshot): Promise<void> {
    return this.enqueue(async () => {
      const lines: string[] = [];
      for (const [id, fact] of snapshot.facts) {
        const tier = snapshot.tierMap.get(id) ?? "L0";
        lines.push(JSON.stringify({ type: "fact", data: fact, tier }));
      }
      for (const [id, take] of snapshot.takes) {
        const tier = snapshot.tierMap.get(id) ?? "L1";
        lines.push(JSON.stringify({ type: "take", data: take, tier }));
      }
      for (const [id, page] of snapshot.pages) {
        const tier = snapshot.tierMap.get(id) ?? "L2";
        lines.push(JSON.stringify({ type: "page", data: page, tier }));
      }
      // Tombstones older than 72h are dropped during compaction
      const now = nowWallclock();
      for (const [id, ts] of snapshot.tombstones) {
        if (now - ts.deletedAt < 72 * 60 * 60 * 1000) {
          lines.push(JSON.stringify({ type: "tombstone", id, deletedAt: ts.deletedAt }));
        }
      }
      const content = lines.map((l) => l + "\n").join("");
      const tmpPath = this.filePath + ".tmp";
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, this.filePath);
      this.recordCount = lines.length;
    });
  }

  /** Get the current record count (for diagnostics). */
  get size(): number { return this.recordCount; }
  get isLoaded(): boolean { return this.loaded; }

  // ── Internal helpers ────────────────────────────────────────────────────

  /** Serialize writes through a queue to prevent interleaving. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  /** Append a single record as a JSON line. */
  private async append(record: BrainRecord): Promise<void> {
    await this.appendRaw(JSON.stringify(record) + "\n");
  }

  /** Append raw string data to the file. */
  private async appendRaw(data: string): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, data, "utf8");
      this.recordCount++;
    } catch {
      // Best-effort — in-memory Brain still works
    }
  }
}