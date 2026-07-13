/**
 * @my-agent/agent — AgentPool: manages pi AgentSession instances.
 *
 * Each background session uses pi's FULL AgentSession (same as TUI):
 * - pi providers (30+ from models.json)
 * - pi tools (bash, read, write, edit, grep, find)
 * - pi session management (JSONL, compaction)
 * - Extensions (mya-bridge commands)
 *
 * This replaced the legacy AgentPool (which used mya's basic createAgent).
 */
import { nowWallclock } from "@my-agent/core";

export interface AgentSessionEntry {
  sessionId: string;
  /** Pi AgentSession (full agent, same as TUI). */
  session: AgentSession;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  busy: boolean;
  /** JSONL file path for this session (for pi --session resume). */
  sessionFile?: string;
}

/** Minimal interface for pi AgentSession (duck-typed to avoid tight coupling). */
export interface AgentSession {
  prompt(text: string, options?: unknown): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): void;
  readonly sessionFile?: string;
}

export type SessionFactory = (sessionId: string, cwd?: string) => Promise<AgentSession>;

export interface AgentPoolOptions {
  maxSessions?: number;
  idleTtlMs?: number;
  /** Factory that creates a pi AgentSession for a new session ID. */
  createSession: SessionFactory;
}

export class AgentPool {
  private pool = new Map<string, AgentSessionEntry>();
  private maxSessions: number;
  private idleTtlMs: number;
  private createSession: SessionFactory;

  constructor(opts: AgentPoolOptions) {
    this.maxSessions = opts.maxSessions ?? 16;
    this.idleTtlMs = opts.idleTtlMs ?? 3_600_000;
    this.createSession = opts.createSession;
  }

  /** Get or create a pi AgentSession for a session ID. */
  async acquire(sessionId: string): Promise<AgentSession> {
    let entry = this.pool.get(sessionId);
    if (!entry) {
      if (this.pool.size >= this.maxSessions) this.evictOldest();
      const session = await this.createSession(sessionId);
      entry = {
        sessionId,
        session,
        createdAt: nowWallclock(),
        lastActivity: nowWallclock(),
        messageCount: 0,
        busy: false,
        sessionFile: (session as { sessionFile?: string }).sessionFile,
      };
      this.pool.set(sessionId, entry);
    }
    entry.lastActivity = nowWallclock();
    return entry.session;
  }

  /** Create a new pool session for a given cwd (used by launcher). */
  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    if (this.pool.size >= this.maxSessions) this.evictOldest();
    const session = await this.createSession(sessionId, cwd);
    const entry: AgentSessionEntry = {
      sessionId,
      session,
      createdAt: nowWallclock(),
      lastActivity: nowWallclock(),
      messageCount: 0,
      busy: false,
      sessionFile: (session as { sessionFile?: string }).sessionFile,
    };
    this.pool.set(sessionId, entry);
    return session;
  }

  get(sessionId: string): AgentSessionEntry | undefined {
    return this.pool.get(sessionId);
  }

  list(): AgentSessionEntry[] {
    return [...this.pool.values()].sort((a, b) => b.lastActivity - a.lastActivity);
  }

  release(sessionId: string): boolean {
    return this.pool.delete(sessionId);
  }

  sweepIdle(): number {
    const now = nowWallclock();
    let evicted = 0;
    for (const [id, entry] of this.pool) {
      if (!entry.busy && now - entry.lastActivity > this.idleTtlMs) {
        this.pool.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  get size(): number { return this.pool.size; }

  private evictOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, entry] of this.pool) {
      if (!entry.busy && entry.lastActivity < oldestTime) {
        oldestTime = entry.lastActivity;
        oldest = id;
      }
    }
    if (oldest) this.pool.delete(oldest);
  }
}
