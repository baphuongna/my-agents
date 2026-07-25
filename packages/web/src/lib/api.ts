/**
 * mya Gateway API client.
 *
 * Maps to the real endpoints in packages/gateway/src/index.ts.
 * The gateway sets a session cookie on GET / — all fetches carry it
 * automatically (credentials: "include").
 */

const BASE = "";

// ── Global management-profile scope ──────────────────────────────────
// One header switcher (ProfileProvider in main.tsx) decides which profile
// the management pages read/write. fetchJSON transparently appends
// ?profile=<name> to the profile-scoped endpoint families below. "" = the
// dashboard process's own profile (legacy behaviour). Calls that already
// carry an explicit profile param are left untouched — explicit beats
// global. Adapted from the Hermes M2 pattern; mya is cookie-only so this
// is the ONLY scoping mechanism (no dual-auth token path).
let _managementProfile = "";

export function setManagementProfile(name: string): void {
  _managementProfile = (name || "").trim();
}

export function getManagementProfile(): string {
  return _managementProfile;
}

// Endpoint families that honour ?profile= on the backend. Anything else —
// health, status, pool, sync, profiles themselves — is machine-global or
// self-scoped and must NOT be rewritten.
const PROFILE_SCOPED_PREFIXES = [
  "/sessions",
  "/skills",
  "/cron",
  "/config",
  "/models",
  "/mcp",
  "/tools",
];

/**
 * Append `?profile=<name>` to a profile-scoped URL.
 *
 * - An explicit `profile` argument always wins over the global scope.
 * - An existing `profile=` query param on the URL is never overwritten.
 * - Non-scoped paths (health, status, profiles, …) are returned untouched.
 */
export function withProfile(url: string, profile?: string): string {
  const scope = profile !== undefined ? profile : _managementProfile;
  if (!scope) return url;
  if (url.includes("profile=")) return url; // explicit param wins
  const path = (url.split("?")[0] ?? url);
  if (!PROFILE_SCOPED_PREFIXES.some((p) => path.startsWith(p))) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}profile=${encodeURIComponent(scope)}`;
}

/** Generic JSON fetch with session cookie + 15s timeout. */
export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  url = withProfile(url);
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
  reasoning?: boolean;
  maxTokens?: number;
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

/** MCP server as returned by GET /mcp/servers. */
export interface McpServer {
  id: string;
  command: string;
  args: string[];
  phase: string;
  health: string;
  tools: string[];
  lastError?: string;
}

/** Result of POST /mcp/servers/:id/test. */
export interface McpTestResult {
  ok: boolean;
  id: string;
  action?: string;
  tools?: string[];
  error?: string;
}

/** Channel adapter as surfaced by GET /status (channels array). */
export interface ChannelInfo {
  id: string;
  type: string;
  alias?: string;
  label?: string;
  enabled: boolean;
  configured: boolean;
  health: string;
}

/** Result of POST /channels/:id/test. */
export interface ChannelTestResult {
  ok: boolean;
  id: string;
  message?: string;
  error?: string;
}

/** Profile entry as returned by GET /profiles. */
export interface ProfileInfo {
  name: string;
  description?: string;
  is_default?: boolean;
}

/** Active-profile info as returned by GET /profiles/active. */
export interface ActiveProfileInfo {
  name: string;
}

/** Result of a spawned admin action (gateway lifecycle / ops). */
export interface ActionResponse {
  ok: boolean;
  /** Backend action name — used to poll GET /actions/:name/status. */
  name: string;
  pid?: number | null;
  message?: string;
  error?: string;
  archive?: string;
}

/** Live status of a spawned admin action — polled until `running` is false. */
export interface ActionStatusResponse {
  name: string;
  running: boolean;
  exit_code: number | null;
  pid: number | null;
  lines: string[];
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

  // MCP servers
  mcpServers: () => fetchJSON<McpServer[]>("/mcp/servers"),
  mcpAdd: (cfg: { id: string; command: string; args?: string[]; env?: Record<string, string> }) =>
    postJSON<{ ok: boolean; id: string }>("/mcp/servers", cfg),
  mcpTest: (id: string) =>
    postJSON<McpTestResult>(`/mcp/servers/${id}/test`),
  mcpRemove: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/mcp/servers/${id}`, { method: "DELETE" }),

  // Channels (toggle + test; list comes from GET /status)
  channelConfig: (id: string, patch: { enabled?: boolean }) =>
    postJSON<{ ok: boolean; id: string; config: Record<string, unknown> }>(
      `/channels/${id}/config`,
      patch,
    ),
  channelTest: (id: string) =>
    postJSON<ChannelTestResult>(`/channels/${id}/test`),

  // Memory + dream
  memoryStats: () => fetchJSON<Record<string, unknown>>("/memory/stats"),
  memoryDream: () => postJSON<Record<string, unknown>>("/memory/dream"),

  // Profiles — self-scoped (never rewritten by withProfile)
  getProfiles: () => fetchJSON<{ profiles: ProfileInfo[] }>("/profiles"),
  getActiveProfile: () => fetchJSON<ActiveProfileInfo>("/profiles/active"),
  setActiveProfile: (name: string) =>
    postJSON<{ ok: boolean; name: string }>("/profiles/active", { name }),

  // ── Admin: gateway lifecycle ───────────────────────────────────────
  restartGateway: () =>
    postJSON<ActionResponse>("/gateway/restart"),
  stopGateway: () =>
    postJSON<ActionResponse>("/gateway/stop"),
  startGateway: () =>
    postJSON<ActionResponse>("/gateway/start"),

  // ── Admin: ops actions ─────────────────────────────────────────────
  runDoctor: () =>
    postJSON<ActionResponse>("/ops/doctor"),
  runSecurityAudit: () =>
    postJSON<ActionResponse>("/ops/security-audit"),
  runBackup: (output?: string) =>
    postJSON<ActionResponse>("/ops/backup", output ? { output } : undefined),

  // ── Admin: action status polling ───────────────────────────────────
  getActionStatus: (name: string, lines = 200) =>
    fetchJSON<ActionStatusResponse>(
      `/actions/${encodeURIComponent(name)}/status?lines=${lines}`,
    ),
};
