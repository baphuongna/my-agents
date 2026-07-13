/**
 * §12 gateway control-plane — the management surface (sessions / cron / config /
 * tools) + a per-session runtime-handle LRU cache with idle-TTL eviction.
 *
 * The LRU bounds in-memory Provider/Channel/Tool handles: on access, lastUsed is
 * refreshed; when MAX_SIZE is exceeded the oldest idle entry is evicted (its
 * handle's flush() is called if present). Idle entries past IDLE_TTL_SECS are
 * swept. This prevents unbounded handle growth from many sessions.
 *
 * Source: §12 Channels/gateway; gateway-protocol control-plane.
 */
import { nowWallclock } from "@my-agent/core";

const MAX_SIZE = 128;
const IDLE_TTL_MS = 3600 * 1000; // 1h

/** A cached runtime handle (Provider/Channel/Tool) with optional flush on evict. */
export interface CachedHandle {
  flush?(): void;
}

interface LruEntry {
  handle: CachedHandle;
  lastUsed: number;
}

/** A bounded LRU + idle-TTL cache of per-session runtime handles. */
export class HandleLruCache {
  private readonly entries = new Map<string, LruEntry>(); // Map preserves insertion order
  constructor(private readonly maxSize = MAX_SIZE, private readonly idleTtlMs = IDLE_TTL_MS) {}

  get(sessionId: string): CachedHandle | undefined {
    const e = this.entries.get(sessionId);
    if (!e) return undefined;
    // refresh recency (delete + re-insert puts it at the end = most-recent)
    this.entries.delete(sessionId);
    e.lastUsed = nowWallclock();
    this.entries.set(sessionId, e);
    return e.handle;
  }

  set(sessionId: string, handle: CachedHandle): void {
    if (this.entries.has(sessionId)) this.entries.delete(sessionId);
    this.entries.set(sessionId, { handle, lastUsed: nowWallclock() });
    this.evict();
  }

  /** Evict oldest while over maxSize. Returns the count evicted. */
  private evict(): number {
    let n = 0;
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const e = this.entries.get(oldest);
      this.entries.delete(oldest);
      try { e?.handle.flush?.(); } catch { /* best-effort */ }
      n++;
    }
    return n;
  }

  /** Sweep entries idle longer than idleTtlMs. Returns the count swept. */
  sweepIdle(now = nowWallclock()): number {
    let n = 0;
    for (const [k, e] of this.entries) {
      if (now - e.lastUsed > this.idleTtlMs) {
        this.entries.delete(k);
        try { e.handle.flush?.(); } catch { /* best-effort */ }
        n++;
      }
    }
    return n;
  }

  get size(): number { return this.entries.size; }
}

/** A registered session in the control-plane. */
export interface ControlSession {
  id: string;
  createdAt: number;
  status: "active" | "idle" | "closed";
}

/** A registered cron job. */
export interface ControlCronJob {
  id: string;
  name: string;
  trigger: "cron" | "on-interval" | "once";
  /** cron expression (cron) / interval-ms (on-interval) / epoch-ms (once). */
  schedule: string | number;
  prompt: string;
  deliveryTarget: string;
  enabled: boolean;
  /** Optional timezone (e.g. "America/Los_Angeles"). */
  timezone?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: "succeeded" | "failed" | "lease-expired" | "running" | "claimed";
  lastError?: string;
}

/** The gateway control-plane: a read/management registry over sessions/cron/etc. */
export class ControlPlane {
  readonly handles: HandleLruCache;
  private readonly sessions = new Map<string, ControlSession>();
  private readonly cronJobs = new Map<string, ControlCronJob>();
  private readonly config: Record<string, unknown>;

  constructor(opts: { config?: Record<string, unknown>; handles?: HandleLruCache } = {}) {
    this.handles = opts.handles ?? new HandleLruCache();
    this.config = opts.config ?? {};
  }

  // --- sessions ---
  registerSession(id: string, status: ControlSession["status"] = "active"): ControlSession {
    const s: ControlSession = { id, createdAt: nowWallclock(), status };
    this.sessions.set(id, s);
    return s;
  }
  getSession(id: string): ControlSession | undefined { return this.sessions.get(id); }
  listSessions(): ControlSession[] { return [...this.sessions.values()]; }
  setSessionStatus(id: string, status: ControlSession["status"]): void {
    const s = this.sessions.get(id);
    if (s) s.status = status;
  }

  // --- cron ---
  registerCronJob(job: ControlCronJob): void { this.cronJobs.set(job.id, job); }
  listCronJobs(): ControlCronJob[] { return [...this.cronJobs.values()]; }
  getCronJob(id: string): ControlCronJob | undefined { return this.cronJobs.get(id); }
  updateCronJob(id: string, patch: Partial<ControlCronJob>): ControlCronJob | undefined {
    const cur = this.cronJobs.get(id);
    if (!cur) return undefined;
    const updated = { ...cur, ...patch, id: cur.id };
    this.cronJobs.set(id, updated);
    return updated;
  }
  removeCronJob(id: string): boolean { return this.cronJobs.delete(id); }

  // --- config / tools ---
  getConfig(): Record<string, unknown> { return this.config; }
  listTools(): string[] { return Array.isArray(this.config["tools"]) ? (this.config["tools"] as string[]) : []; }
}
