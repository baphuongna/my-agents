/**
 * Session + History — minimal Tier-0 implementations.
 *
 * History is an append-only log (JSONL tree in Tier 1; in-memory array here).
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { History, MemorySnapshot, ProviderProfile, Session } from "./types.js";

export class ArrayHistory implements History {
  private _entries: unknown[] = [];
  append(entry: unknown): void {
    this._entries.push(entry);
  }
  entries(): readonly unknown[] {
    return this._entries;
  }
}

/**
 * Issue #7: FileHistory — JSONL-backed history. Each `append` writes one line.
 * `entries()` reads all lines (for session resume / startup).
 *
 * Use case: agent sessions that should survive process restarts.
 * Pattern: same as pi's JSONL session files (one file per session).
 */
export class FileHistory implements History {
  private _entries: unknown[] = [];
  private readonly path: string;
  private loaded = false;

  constructor(path: string) {
    this.path = path;
  }

  /** Eagerly load from disk. Called on first append or explicit load(). */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const text = readFileSync(this.path, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          this._entries.push(JSON.parse(line));
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // ignore read errors
    }
  }

  append(entry: unknown): void {
    this.load();
    this._entries.push(entry);
    // Persist to disk
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      // best-effort; in-memory still works
    }
  }

  entries(): readonly unknown[] {
    this.load();
    return this._entries;
  }
}

/** Tier-0 MemoryManager stub: returns an empty snapshot (R29-6/M10). */
export function stubMemory(): Session["memory"] {
  return {
    snapshot: (): MemorySnapshot => ({ entries: [], generatedDay: 0 }),
    query: async () => [],
  };
}

/** Build a minimal Tier-0 session. */
export function createSession(opts: {
  profiles: ProviderProfile[];
  stableTier?: string;
  userMd?: string;
  /**
   * Issue #7: optional file path for JSONL-backed history.
   * If provided, uses FileHistory (auto-loads on first access).
   * Otherwise falls back to in-memory ArrayHistory.
   */
  historyPath?: string;
}): Session {
  return {
    profiles: opts.profiles,
    stableTier: opts.stableTier ?? "",
    ctxFiles: [],
    memory: stubMemory(),
    userMd: opts.userMd ?? "",
    history: opts.historyPath ? new FileHistory(opts.historyPath) : new ArrayHistory(),
    skillSetDirty: false,
  };
}
