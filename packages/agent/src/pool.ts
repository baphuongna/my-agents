/**
 * @my-agent/agent — AgentPool: manages pi AgentSession instances.
 *
 * Each background session uses pi's FULL AgentSession (same as TUI):
 * - pi providers (30+ from models.json)
 * - pi tools (bash, read, write, edit, grep, find)
 * - pi session management (JSONL, compaction)
 * - Extensions (mya-bridge commands)
 *
 * Phase 2 enhancements (config-driven, from openclaw pattern):
 *   - Per-agentDir isolation (each agent can have its own session storage)
 *   - Per-agent concurrency (semaphore-bounded parallel sessions)
 *   - Multi-agent pool (named agents with their own config)
 *   - Validation at construction (fail-fast)
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
  /** Which agent (named) this session belongs to. */
  agentName?: string;
}

/** Minimal interface for pi AgentSession (duck-typed to avoid tight coupling). */
export interface AgentSession {
  prompt(text: string, options?: unknown): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): void;
  readonly sessionFile?: string;
}

export type SessionFactory = (sessionId: string, cwd?: string, agentDir?: string) => Promise<AgentSession>;

/** Per-agent configuration. */
export interface AgentConfig {
  /** Display name (required, unique). */
  name: string;
  /** Optional session storage dir (overrides pool default). */
  agentDir?: string;
  /** Optional max concurrent sessions for this agent. Default: pool.maxSessions. */
  maxSessions?: number;
  /** Optional idle TTL (ms). Default: pool.idleTtlMs. */
  idleTtlMs?: number;
}

export interface AgentPoolOptions {
  /** Max sessions per agent. Default 16. */
  maxSessions?: number;
  /** Default idle TTL (ms). Default 3_600_000. */
  idleTtlMs?: number;
  /** Factory that creates a pi AgentSession for a new session ID. */
  createSession: SessionFactory;
  /** Multi-agent configs (named agents with their own dirs/limits). */
  agents?: AgentConfig[];
}

/**
 * Pool of pi AgentSession instances. Supports:
 *   - Default pool (no agents config) — all sessions share one namespace
 *   - Multi-agent pool — each agent has its own sessions + dir + limits
 *
 * Sessions persist in the pool even when WS clients disconnect.
 * Idle sessions are evicted by LRU + TTL.
 */
export class AgentPool {
  private pool = new Map<string, AgentSessionEntry>();
  private maxSessions: number;
  private idleTtlMs: number;
  private createSession: SessionFactory;
  private agents = new Map<string, AgentConfig>();

  constructor(opts: AgentPoolOptions) {
    if (!opts.createSession) throw new Error("AgentPool: createSession factory required");
    this.maxSessions = opts.maxSessions ?? 16;
    this.idleTtlMs = opts.idleTtlMs ?? 3_600_000;
    this.createSession = opts.createSession;
    if (opts.agents) {
      for (const a of opts.agents) {
        if (this.agents.has(a.name)) throw new Error(`AgentPool: duplicate agent name "${a.name}"`);
        this.agents.set(a.name, a);
      }
    }
  }

  /** Register a named agent. */
  registerAgent(config: AgentConfig): void {
    if (this.agents.has(config.name)) throw new Error(`AgentPool: duplicate agent name "${config.name}"`);
    this.agents.set(config.name, config);
  }

  /** List registered agents. */
  listAgents(): AgentConfig[] {
    return [...this.agents.values()];
  }

  /** Get agent config by name (or undefined for default). */
  getAgent(name?: string): AgentConfig | undefined {
    if (!name) return undefined;
    return this.agents.get(name);
  }

  /** Get effective max sessions for an agent. */
  private effectiveMaxSessions(agentName?: string): number {
    const agent = agentName ? this.agents.get(agentName) : undefined;
    return agent?.maxSessions ?? this.maxSessions;
  }

  /** Get effective idle TTL for an agent. */
  private effectiveIdleTtl(agentName?: string): number {
    const agent = agentName ? this.agents.get(agentName) : undefined;
    return agent?.idleTtlMs ?? this.idleTtlMs;
  }

  /** Get or create a pi AgentSession for a session ID. */
  async acquire(sessionId: string, agentName?: string): Promise<AgentSession> {
    const key = this.poolKey(sessionId, agentName);
    let entry = this.pool.get(key);
    if (!entry) {
      const max = this.effectiveMaxSessions(agentName);
      if (this.poolSizeForAgent(agentName) >= max) this.evictOldest(agentName);
      const agent = agentName ? this.agents.get(agentName) : undefined;
      const session = await this.createSession(sessionId, undefined, agent?.agentDir);
      entry = {
        sessionId,
        session,
        createdAt: nowWallclock(),
        lastActivity: nowWallclock(),
        messageCount: 0,
        busy: false,
        sessionFile: (session as { sessionFile?: string }).sessionFile,
        agentName,
      };
      this.pool.set(key, entry);
    }
    entry.lastActivity = nowWallclock();
    return entry.session;
  }

  /** Create a new pool session for a given cwd (used by launcher). */
  async createForCwd(sessionId: string, cwd: string, agentName?: string): Promise<AgentSession> {
    const key = this.poolKey(sessionId, agentName);
    const max = this.effectiveMaxSessions(agentName);
    if (this.poolSizeForAgent(agentName) >= max) this.evictOldest(agentName);
    const agent = agentName ? this.agents.get(agentName) : undefined;
    const session = await this.createSession(sessionId, cwd, agent?.agentDir);
    const entry: AgentSessionEntry = {
      sessionId,
      session,
      createdAt: nowWallclock(),
      lastActivity: nowWallclock(),
      messageCount: 0,
      busy: false,
      sessionFile: (session as { sessionFile?: string }).sessionFile,
      agentName,
    };
    this.pool.set(key, entry);
    return session;
  }

  private poolKey(sessionId: string, agentName?: string): string {
    return agentName ? `${agentName}:${sessionId}` : sessionId;
  }

  get(sessionId: string, agentName?: string): AgentSessionEntry | undefined {
    return this.pool.get(this.poolKey(sessionId, agentName));
  }

  list(agentName?: string): AgentSessionEntry[] {
    const all = [...this.pool.values()];
    const filtered = agentName ? all.filter((e) => e.agentName === agentName) : all;
    return filtered.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  release(sessionId: string, agentName?: string): boolean {
    return this.pool.delete(this.poolKey(sessionId, agentName));
  }

  sweepIdle(): number {
    const now = nowWallclock();
    let evicted = 0;
    for (const [id, entry] of this.pool) {
      const ttl = this.effectiveIdleTtl(entry.agentName);
      if (!entry.busy && now - entry.lastActivity > ttl) {
        this.pool.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  get size(): number { return this.pool.size; }

  private poolSizeForAgent(agentName?: string): number {
    if (!agentName) {
      // Count entries without agentName (default pool)
      let n = 0;
      for (const e of this.pool.values()) if (!e.agentName) n++;
      return n;
    }
    let n = 0;
    for (const e of this.pool.values()) if (e.agentName === agentName) n++;
    return n;
  }

  private evictOldest(agentName?: string): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, entry] of this.pool) {
      if (entry.busy) continue;
      if (agentName && entry.agentName !== agentName) continue;
      if (!agentName && entry.agentName) continue;  // only default pool
      if (entry.lastActivity < oldestTime) {
        oldestTime = entry.lastActivity;
        oldest = id;
      }
    }
    if (oldest) this.pool.delete(oldest);
  }
}
