/**
 * @my-agent/agent — AgentPool: manages multiple agent instances.
 *
 * Each session gets its own agent (own history, own turnLock) → parallel.
 * Shared across pool: providers, tools, skillStore, auditLog, etc.
 *
 * Used by the gateway to serve multiple WS sessions concurrently.
 * Sessions persist in the pool even when WS clients disconnect.
 */
import { createAgent, type Agent, type AgentConfig } from "./index.js";
import { nowWallclock } from "@my-agent/core";

export interface PoolEntry {
  agent: Agent;
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  /** Whether an agent turn is currently in-flight. */
  busy: boolean;
}

export interface AgentPoolOptions {
  /** Max concurrent agents (LRU eviction). Default 16. */
  maxAgents?: number;
  /** Idle TTL in ms (evict agents inactive for this long). Default 1 hour. */
  idleTtlMs?: number;
  /** Agent config factory — receives sessionId, returns AgentConfig. */
  createConfig?: (sessionId: string) => AgentConfig;
}

/**
 * Pool of agent instances. Each session gets an isolated agent.
 * Idle agents are evicted by LRU + TTL.
 */
export class AgentPool {
  private pool = new Map<string, PoolEntry>();
  private maxAgents: number;
  private idleTtlMs: number;
  private createConfig: (sessionId: string) => AgentConfig;

  constructor(opts: AgentPoolOptions = {}) {
    this.maxAgents = opts.maxAgents ?? 16;
    this.idleTtlMs = opts.idleTtlMs ?? 3_600_000;
    this.createConfig = opts.createConfig ?? (() => ({}));
  }

  /** Get or create an agent for a session. */
  acquire(sessionId: string): Agent {
    let entry = this.pool.get(sessionId);
    if (!entry) {
      // Evict if at capacity
      if (this.pool.size >= this.maxAgents) this.evictOldest();
      const agent = createAgent(this.createConfig(sessionId));
      entry = {
        agent,
        sessionId,
        createdAt: nowWallclock(),
        lastActivity: nowWallclock(),
        messageCount: 0,
        busy: false,
      };
      this.pool.set(sessionId, entry);
    }
    entry.lastActivity = nowWallclock();
    return entry.agent;
  }

  /** Get pool entry metadata (without creating). */
  get(sessionId: string): PoolEntry | undefined {
    return this.pool.get(sessionId);
  }

  /** List all active sessions. */
  list(): PoolEntry[] {
    return [...this.pool.values()].sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /** Evict a specific session. */
  release(sessionId: string): boolean {
    return this.pool.delete(sessionId);
  }

  /** Evict idle sessions (call periodically). Returns count evicted. */
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

  /** Get pool size. */
  get size(): number {
    return this.pool.size;
  }

  /** Evict the oldest idle entry. */
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
