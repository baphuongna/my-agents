// packages/print/src/runtimes/pool.ts

import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentRuntime, SmartRouter, PromptEnricher, CostTracker,
} from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";
import type { AgentSession } from "@my-agent/agent";
import { RuntimeSessionAdapter } from "./adapter.js";
import { buildAgentEnv } from "./build-env.js";

export interface RuntimePoolEntry {
  sessionId: string;
  session: AgentSession;
  runtimeType: string;
  busy: boolean;
  messageCount: number;
  lastActivity: number;
  sessionFile?: string;
  createdAt: number;
  idleSince: number;
}

export class RuntimePool {
  private entries = new Map<string, RuntimePoolEntry>();
  private pending = new Map<string, Promise<{ session: AgentSession; runtimeType: string }>>(); // M1 fix: per-sessionId lock
  private creationLock: Promise<void> = Promise.resolve(); // M3 fix: global creation lock for maxSessions
  private maxSessions: number;
  private idleTtlMs = 3_600_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
    opts?: { maxSessions?: number },
  ) {
    // R5 fix: env MYA_MAX_SESSIONS takes precedence (operator override).
    // Ctor default is fallback; only use 16 when neither is set.
    const envCap = parseInt(process.env.MYA_MAX_SESSIONS ?? "", 10);
    const cap = (Number.isFinite(envCap) && envCap > 0) ? envCap : (opts?.maxSessions ?? 16);
    this.maxSessions = Number.isFinite(cap) && cap > 0 ? cap : 16;
    this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
    this.sweepTimer.unref?.();
  }

  async acquire(sessionId: string): Promise<AgentSession> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      existing.lastActivity = nowWallclock();
      existing.idleSince = nowWallclock();
      return existing.session;
    }
    const { session } = await this.acquireWithRuntime(sessionId, { agentType: "pi" });
    return session;
  }

  async acquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string; toolsAllowList?: string[] },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      if (opts?.agentType && existing.runtimeType !== opts.agentType) {
        throw new Error(
          `Session ${sessionId} exists as ${existing.runtimeType}, cannot reassign to ${opts.agentType}`
        );
      }
      existing.lastActivity = nowWallclock();
      existing.idleSince = nowWallclock();
      return { session: existing.session, runtimeType: existing.runtimeType };
    }

    // M1 fix: check for pending creation to prevent race
    const pendingCreate = this.pending.get(sessionId);
    if (pendingCreate) {
      // F2 fix: validate agentType matches pending creation
      if (opts?.agentType) {
        const result = await pendingCreate;
        if (result.runtimeType !== opts.agentType) {
          throw new Error(`Session ${sessionId} pending as ${result.runtimeType}, cannot reassign to ${opts.agentType}`);
        }
      }
      return pendingCreate;
    }

    const createPromise = this._doAcquireLocked(sessionId, opts);
    this.pending.set(sessionId, createPromise);
    try {
      const result = await createPromise;
      return result;
    } finally {
      this.pending.delete(sessionId);
    }
  }

  private async _doAcquireLocked(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string; toolsAllowList?: string[] },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    // M3 fix: serialize creation to prevent maxSessions race
    const prev = this.creationLock;
    let release!: () => void;
    this.creationLock = new Promise<void>(r => { release = r; });
    try {
      await prev;
      return await this._doAcquireWithRuntime(sessionId, opts);
    } finally {
      release();
    }
  }

  private async _doAcquireWithRuntime(
    sessionId: string,
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string; toolsAllowList?: string[] },
  ): Promise<{ session: AgentSession; runtimeType: string }> {
    if (this.entries.size >= this.maxSessions) {
      this.sweepIdle();
      if (this.entries.size >= this.maxSessions) throw new Error("Max sessions reached");
    }

    let runtime: AgentRuntime;
    if (opts?.agentType) {
      const rt = this.runtimes.get(opts.agentType);
      if (!rt) throw new Error(`Agent type "${opts.agentType}" not found`);
      if (!rt.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
      runtime = rt;
    } else {
      const result = await this.router.select({
        prompt: opts?.prompt ?? "",
        modelOverride: opts?.model,
      });
      runtime = result.runtime;
    }

    const env = buildAgentEnv();
    const runtimeSession = await runtime.start({
      cwd: opts?.cwd ?? process.cwd(),
      agentDir: join(homedir(), ".mya", "agent"),
      sessionId,
      modelId: opts?.model,
      toolsAllowList: opts?.toolsAllowList,
      env,
    });

    const adapter = new RuntimeSessionAdapter(
      runtimeSession,
      this.enricher,
      this.costTracker,
      (busy: boolean) => {
        // R4-LOW fix: key by entry object, not sessionId — a force-killed
        // session's stale onBusyChange(false) must not touch a RE-ACQUIRED
        // entry with the same sessionId.
        const entry = this.entries.get(sessionId);
        if (entry && entry.session === adapter) {
          entry.busy = busy;
          entry.lastActivity = nowWallclock();
          if (!busy) entry.idleSince = nowWallclock();
        }
      },
      () => {
        const entry = this.entries.get(sessionId);
        if (entry && entry.session === adapter) entry.messageCount++;
      },
    );

    this.entries.set(sessionId, {
      sessionId,
      session: adapter,
      runtimeType: runtime.runtimeType,
      busy: false,
      messageCount: 0,
      lastActivity: nowWallclock(),
      createdAt: nowWallclock(),
      idleSince: nowWallclock(),
    });

    // Wire runtime type for cost tracking (rate fallback when costUsd absent)
    this.costTracker.setRuntimeType?.(sessionId, runtime.runtimeType);

    return { session: adapter, runtimeType: runtime.runtimeType };
  }

  get(sessionId: string): RuntimePoolEntry | undefined {
    return this.entries.get(sessionId);
  }

  list(): RuntimePoolEntry[] {
    return [...this.entries.values()];
  }

  release(sessionId: string, opts?: { force?: boolean }): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    if (entry.busy && !opts?.force) return false;
    this.costTracker.forget?.(sessionId);
    void Promise.resolve(entry.session.abort()).catch(() => {});
    this.entries.delete(sessionId);
    return true;
  }

  async createForCwd(sessionId: string, cwd: string): Promise<AgentSession> {
    const { session } = await this.acquireWithRuntime(sessionId, { cwd });
    return session;
  }

  get size(): number { return this.entries.size; }

  sweepIdle(): void {
    const now = nowWallclock();
    for (const [id, entry] of this.entries) {
      if (entry.busy) continue;
      if (now - entry.idleSince > this.idleTtlMs) {
        this.costTracker.forget?.(id);
        try { void Promise.resolve(entry.session.abort()).catch(() => {}); } catch {}
        this.entries.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    for (const entry of this.entries.values()) {
      this.costTracker.forget?.(entry.sessionId);
      try { void Promise.resolve(entry.session.abort()).catch(() => {}); } catch {}
    }
    this.entries.clear();
  }
}
