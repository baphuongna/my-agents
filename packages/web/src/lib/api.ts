/**
 * mya Gateway API client.
 *
 * Maps to the real endpoints in packages/gateway/src/index.ts.
 * The gateway sets a session cookie on GET / — all fetches carry it
 * automatically (credentials: "include").
 */

const BASE = "";

/** Generic JSON fetch with session cookie + 15s timeout. */
export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}${url}`, {
      ...init,
      credentials: "include",
      signal: init?.signal ?? ctl.signal,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return res.json() as Promise<T>;
    }
    return res.text() as unknown as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON helper. */
export function postJSON<T>(url: string, body?: unknown): Promise<T> {
  return fetchJSON<T>(url, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── Types ─────────────────────────────────────────────────────────────

export interface StatusResponse {
  status: string;
  uptime?: number;
  version?: string;
  sessions?: number;
  pid?: number;
  [key: string]: unknown;
}

export interface SessionInfo {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  model?: string;
  provider?: string;
  cwd?: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt?: string;
  shellCommand?: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  jobType?: string;
  provider?: string;
  model?: string;
  deliveryTargets?: string[];
}

export interface CronRun {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  output?: string;
  error?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  contextWindow?: number;
  [key: string]: unknown;
}

export interface ToolInfo {
  name: string;
  description?: string;
  mode?: string;
}

export interface MemoryStatus {
  factCount?: number;
  pendingCount?: number;
  embeddedCount?: number;
  [key: string]: unknown;
}

// ── API endpoints ─────────────────────────────────────────────────────

export const api = {
  // Health
  health: () => fetchJSON<{ status: string; uptime: number }>("/health/live"),
  ready: () => fetchJSON<{ status: string }>("/ready"),
  status: () => fetchJSON<StatusResponse>("/status"),

  // Sessions
  sessions: () => fetchJSON<SessionInfo[]>("/sessions"),
  session: (id: string) => fetchJSON<SessionInfo>(`/sessions/${id}`),

  // Cron
  cronJobs: () => fetchJSON<CronJob[]>("/cron/jobs"),
  cronAdd: (job: Partial<CronJob>) => postJSON<CronJob>("/cron/jobs", job),
  cronPatch: (id: string, patch: Partial<CronJob>) =>
    postJSON<CronJob>(`/cron/jobs/${id}/patch`, patch),
  cronRun: (id: string) => postJSON<{ status: string }>(`/cron/jobs/${id}/run`),
  cronDelete: (id: string) =>
    fetchJSON<{ status: string }>(`/cron/jobs/${id}`, { method: "DELETE" }),
  cronRuns: (id: string) => fetchJSON<CronRun[]>(`/cron/jobs/${id}/runs`),

  // Models & tools
  models: () => fetchJSON<ModelInfo[]>("/models"),
  tools: () => fetchJSON<ToolInfo[]>("/tools"),
  config: () => fetchJSON<Record<string, unknown>>("/config"),

  // Pool
  poolSessions: () => fetchJSON<unknown[]>("/pool/sessions"),

  // Sync
  syncState: () => fetchJSON<unknown>("/sync/state"),
};
