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
  private maxSessions = (() => { const n = parseInt(process.env.MYA_MAX_SESSIONS ?? "16", 10); return Number.isFinite(n) && n > 0 ? n : 16; })();
  private idleTtlMs = 3_600_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private router: SmartRouter,
    private runtimes: Map<string, AgentRuntime>,
    private enricher: PromptEnricher,
    private costTracker: CostTracker,
  ) {
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
    opts?: { agentType?: string; model?: string; cwd?: string; prompt?: string },
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

    if (this.entries.size >= this.maxSessions) {
      this.sweepIdle();
      if (this.entries.size >= this.maxSessions) throw new Error("Max sessions reached");
    }

    let runtime: AgentRuntime;
    if (opts?.agentType) {
      runtime = this.runtimes.get(opts.agentType)!;
      if (!runtime) throw new Error(`Agent type "${opts.agentType}" not found`);
      if (!runtime.isAvailable()) throw new Error(`Agent "${opts.agentType}" not available`);
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
      env,
    });

    const adapter = new RuntimeSessionAdapter(
      runtimeSession,
      this.enricher,
      this.costTracker,
      (busy: boolean) => {
        const entry = this.entries.get(sessionId);
        if (entry) {
          entry.busy = busy;
          entry.lastActivity = nowWallclock();
          if (!busy) entry.idleSince = nowWallclock();
        }
      },
      () => {
        const entry = this.entries.get(sessionId);
        if (entry) entry.messageCount++;
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
        void Promise.resolve(entry.session.abort()).catch(() => {});
        this.entries.delete(id);
        this.costTracker.forget?.(id);
      }
    }
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const entry of this.entries.values()) {
      void Promise.resolve(entry.session.abort()).catch(() => {});
    }
    this.entries.clear();
  }
}
