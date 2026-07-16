/**
 * @my-agent/memory/ports — Hexagonal port interfaces (headroom pattern).
 *
 * Defines storage/capability contracts so consumers depend on interfaces, not
 * the concrete SQLite implementation. Enables a future Postgres engine (gbrain
 * dual-engine pattern) without consumer rewrites — engine = deployment knob.
 *
 * Phase 4 scope: define contracts + SqliteMemoryManager implements MemoryStore.
 * Existing consumers keep using SqliteMemoryManager (satisfies the interface);
 * gradual migration follows. Low-risk: no forced consumer rewrite, no behavior
 * change. Re-uses existing MemoryRecord/RecallOptions/MemoryHit types.
 */
import type { MemoryHit } from "./sqlite-recall.js";
import type { MemoryRecord } from "./sqlite-store.js";
import type { RecallOptions } from "./sqlite-recall.js";

// Re-export the shared vocabulary so consumers can import from one place.
export type { MemoryRecord, RecallOptions, MemoryHit };

// ── Port 1: MemoryStore (CRUD + temporal + scope) ──────────────────────────

/**
 * Persistence + recall contract — the single port every consumer depends on.
 * SqliteMemoryManager satisfies this today; a future PostgresMemoryManager can
 * swap in without touching mya-bridge or other consumers.
 */
export interface MemoryStore {
  /** Store a working memory. Returns its id. */
  record(input: {
    content: string;
    source?: string;
    sessionId?: string;
    importance?: number;
    memoryType?: string;
    veracity?: string;
    validUntil?: string;
    embedText?: string;
    scope?: string;
    metadata?: Record<string, unknown>;
    agentId?: string;
    turnId?: string;
  }): string;

  /** Recall relevant memories (FTS5 + scope filter). */
  recall(query: string, options?: RecallOptions): MemoryHit[];

  /** Run the full lifecycle: consolidate + degrade + purge + TTL-expire. */
  lifecycle(sessionId?: string): unknown;

  /** Underlying DB handle (for advanced/migration callers — use sparingly). */
  getDatabase(): unknown;
}

// ── Ports 2-6: capability seams (declared for future; SQLite bundles them) ─

export interface VectorIndex {
  index(memory: MemoryRecord): Promise<void>;
  search(query: string, topK: number): Promise<MemoryHit[]>;
  remove(id: string): Promise<void>;
  readonly dimension: number;
}

export interface TextIndex {
  index(memory: MemoryRecord): void;
  search(query: string, topK: number): MemoryHit[];
  remove(id: string): void;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimension: number;
  readonly modelName: string;
}

export interface MemoryCache {
  get(id: string): MemoryRecord | null;
  put(memory: MemoryRecord): void;
  invalidate(id: string): void;
  invalidateScope(scope: { agentId?: string; sessionId?: string }): void;
}

export interface GraphStore {
  upsertEntity(entity: { id: string; type: string; attrs?: Record<string, unknown> }): void;
  upsertEdge(edge: { from: string; to: string; type: string }): void;
  subgraph(roots: string[], hops: number): unknown;
}

// ── MemoryEngine: composes the ports (future orchestrator) ─────────────────
// Today SqliteMemoryManager IS the engine (bundles all 6 concerns in one SQLite
// DB). When backends split, an orchestrator composes the 6 ports. Declared now
// so the consumer-facing type stays stable across the refactor.

export interface MemoryEngine extends MemoryStore {
  // Extension point for future multi-port coordination (e.g. add() that writes
  // store + vector + text + cache atomically).
}
