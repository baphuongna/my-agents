/**
 * mya Session Launcher — Phase 1+2+3+4.
 *
 * Features:
 *  - 6 tabs: Sessions, Channels, Cron, Providers, Subagents, Status
 *  - Search/filter input
 *  - Real-time refresh (poll 2s)
 *  - Status bar (connection, session count)
 *  - Fullscreen TUI (alt screen + mouse via ANSI)
 *  - New session → gateway acquire (always)
 *  - x kill, n new, q quit, Tab switch, r refresh
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { authHeaders, withAuth } from "./gw-auth.js";
import { join, resolve as pathResolve } from "node:path";
import { nowWallclock, supervisedTask, type SupervisedTaskHandle } from "@my-agent/core";
import { scanSkillDirectory } from "./skill-search/scanner.ts";

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[38;2;210;153;34m${s}\x1b[39m`,
  red: (s: string) => `\x1b[38;2;201;79;79m${s}\x1b[39m`,
  blue: (s: string) => `\x1b[38;2;120;170;220m${s}\x1b[39m`,
  selBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clrEol: "\x1b[K",
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  mouseOn: "\x1b[?1003h\x1b[?1006h",
  mouseOff: "\x1b[?1003l\x1b[?1006l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clear: "\x1b[2J\x1b[H",
};

interface Sess {
  id: string;
  label: string;
  detail: string;
  type: "gateway" | "new";
  arg?: string;
  busy?: boolean;
  messages?: number;
  lastActivity?: number;
}

interface GatewayInfo {
  connected: boolean;
  port: number;
  sessions: number;
  running: number;
  model?: string;
  uptime?: number;
  channels?: Array<{ id: string; type: string; alias?: string; label: string; enabled: boolean; configured: boolean; health: string }>;
  cronJobs?: Array<{ id: string; name: string; trigger: string; schedule: string | number; prompt: string; enabled: boolean; lastRunAt?: number; nextRunAt?: number; lastStatus?: string; lastError?: string; jobType?: string; deliveryTarget?: string }>;
  providers?: Array<{ id: string; envKey: string; model: string; configured: boolean }>;
  subagents?: { active: number; total: number };
  agentTree?: AgentTreeEntry[];
  mcpServers?: Array<{ id: string; command: string; args: string[]; phase: string; health: string; tools: string[]; lastError?: string }>;
  skills?: Array<{ name: string; description: string; triggers: string[] }>;
  roles?: Array<{ name: string; description: string; promptAppend?: string; toolsAllowed?: string[]; toolsDenied?: string[]; modelPrefer?: string; memoryScope?: string }>;
  memoryStats?: { facts: number; takes: number; tombstones: number; dreamRunning: boolean; lastDream?: string };
  version?: string;
  pid?: number;
}

const GW_PORT = parseInt(process.env["MYA_PORT"] ?? "3000", 10);
const REFRESH_MS = 2000;

function fmt(ts: number): string {
  if (!ts || isNaN(ts)) return "-";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = nowWallclock() - ms;
  if (d < 0 || d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

async function fetchJson<T>(url: string, timeoutMs = 1000): Promise<T | undefined> {
  try {
    const r = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return undefined;
    return (await r.json()) as T;
  } catch { return undefined; }
}

async function loadGatewaySessions(): Promise<Sess[]> {
  const arr = await fetchJson<Array<{ sessionId: string; messages: number; lastActivity: number; busy: boolean; sessionFile?: string }>>(`http://127.0.0.1:${GW_PORT}/pool/sessions`);
  if (!arr) return [];
  return arr.map((s) => ({
    id: s.sessionId,
    label: s.sessionId.replace(/^ch-/, "").replace(/^s-/, "").replace(/-/g, " "),
    detail: `${s.messages} msgs | ${s.busy ? "running" : "idle"} | ${fmt(s.lastActivity)}`,
    type: "gateway" as const,
    arg: s.sessionFile,
    busy: s.busy,
    messages: s.messages,
    lastActivity: s.lastActivity,
  }));
}

async function loadGatewayInfo(): Promise<GatewayInfo> {
  const [health, sessions, status, cronJobs, tree, mcpServers, skills, memoryStats, roles] = await Promise.all([
    fetchJson<{ state: string; ok: boolean }>(`http://127.0.0.1:${GW_PORT}/health/live`),
    loadGatewaySessions(),
    fetchJson<{ model?: string; uptime?: number; channels?: GatewayInfo["channels"]; providers?: Array<{ id: string; envKey: string; model: string; configured: boolean }>; subagents?: GatewayInfo["subagents"]; version?: string; pid?: number }>(`http://127.0.0.1:${GW_PORT}/status`),
    fetchJson<Array<{ id: string; name: string; trigger: string; schedule: string | number; prompt: string; enabled: boolean; lastRunAt?: number; nextRunAt?: number; lastStatus?: string; lastError?: string; jobType?: string; deliveryTarget?: string }>>(`http://127.0.0.1:${GW_PORT}/cron/jobs`),
    fetchJson<AgentTreeEntry[]>(`http://127.0.0.1:${GW_PORT}/pool/tree`),
    fetchJson<GatewayInfo["mcpServers"]>(`http://127.0.0.1:${GW_PORT}/mcp/servers`),
    fetchJson<GatewayInfo["skills"]>(`http://127.0.0.1:${GW_PORT}/skills`),
    fetchJson<GatewayInfo["memoryStats"]>(`http://127.0.0.1:${GW_PORT}/memory/stats`),
    fetchJson<GatewayInfo["roles"]>(`http://127.0.0.1:${GW_PORT}/roles`),
  ]);
  return {
    connected: !!health?.ok,
    port: GW_PORT,
    sessions: sessions.length,
    running: sessions.filter((s) => s.busy).length,
    model: status?.model,
    uptime: status?.uptime,
    channels: status?.channels,
    cronJobs,
    providers: status?.providers,
    subagents: status?.subagents,
    agentTree: tree,
    mcpServers,
    skills,
    memoryStats,
    roles,
    version: status?.version,
    pid: status?.pid,
  };
}

async function acquireGatewaySession(cwd: string): Promise<string | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/acquire`, {
      method: "POST",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ cwd }),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return undefined;
    const data = (await r.json()) as { sessionId?: string };
    return data.sessionId;
  } catch { return undefined; }
}

async function killGatewaySession(id: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/kill/${id}`, {
      method: "POST",
      headers: authHeaders(),
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch { return false; }
}

async function toggleChannel(id: string, enabled: boolean): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/channels/${id}/config`, {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ enabled }),
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch { return false; }
}

async function testChannel(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/channels/${id}/test`, {
      method: "POST",
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json() as { ok: boolean; error?: string };
    return data;
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

async function addCronJob(name: string, schedule: string, prompt: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs`, {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ name, schedule, prompt, trigger: "cron" }),
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch { return false; }
}

/** Write a role config to ~/.mya/roles/<name>.json. */
async function addRoleFile(name: string, description: string, promptAppend: string): Promise<boolean> {
  // BUG #2: validate name to prevent path traversal. kebab-case regex rejects
  // "..", "/", and any char that could escape the roles directory.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return false;
  try {
    const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const dir = join(homedir(), ".mya", "roles");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.json`);
    // BUG #6: refuse to silently overwrite an existing role.
    if (existsSync(file)) return false;
    const role = {
      name,
      description,
      ...(promptAppend ? { promptAppend } : {}),
    };
    writeFileSync(file, JSON.stringify(role, null, 2) + "\n");
    return true;
  } catch { return false; }
}

/** Delete a role config file. */
async function deleteRoleFile(name: string): Promise<boolean> {
  // BUG #2: validate name — it comes from role.name (JSON content field),
  // NOT from a validated filename. A planted malicious JSON with
  // name="../../.mya/memory/memory" would otherwise delete arbitrary files.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return false;
  try {
    if (name === "default") return false; // protect default role
    const { unlinkSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const file = join(homedir(), ".mya", "roles", `${name}.json`);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
  } catch { return false; }
}

/** Create a new skill (frontmatter + template body). Returns the SKILL.md path, or null on failure. */
async function addSkillFile(name: string, description: string, subTab: "main" | "corpus"): Promise<string | null> {
  // Validate name — kebab-case, no path traversal (mirror addRoleFile guard).
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  try {
    const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const base = join(homedir(), ".mya", "agent", subTab === "main" ? "skills" : "data");
    const skillDir = join(base, name);
    const file = join(skillDir, "SKILL.md");
    if (existsSync(file)) return null; // refuse silent overwrite
    mkdirSync(skillDir, { recursive: true });
    const content = `---\nname: ${name}\ndescription: ${description}\ntriggers: []\n---\n# ${name}\n\nDescribe when to use this skill and the instructions to follow.\n`;
    writeFileSync(file, content);
    return file;
  } catch { return null; }
}

async function configureProvider(id: string, envKey: string, apiKey: string, action: "add" | "remove"): Promise<{ ok: boolean; restart?: boolean }> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/providers/config`, {
      method: "POST",
      headers: withAuth({ "content-type": "application/json" }),
      body: JSON.stringify({ id, envKey, apiKey, action }),
      signal: AbortSignal.timeout(2000),
    });
    const data = await r.json() as { ok: boolean; restart?: boolean };
    return data;
  } catch { return { ok: false }; }
}

async function killSubagent(sessionId: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/kill/${sessionId}`, {
      method: "POST",
      headers: authHeaders(),
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch { return false; }
}

type Tab = "agents" | "channels" | "cron" | "providers" | "mcp" | "skills" | "memory" | "roles" | "status";

interface AgentTreeEntry {
  sessionId: string;
  busy: boolean;
  messages: number;
  lastActivity: number;
  subagents?: Array<{ id: string; goal: string; status: string; depth: number; output?: string }>;
}

interface LauncherState {
  tab: Tab;
  sel: number;
  cronSel: number;
  filter: string;
  sessions: Sess[];
  info: GatewayInfo;
  refreshing: boolean;
  lastRefresh: number;
  skillSubTab: "main" | "corpus";
}

/** Inline prompt — user types a single value. Returns undefined on Esc. */
function inlinePrompt(label: string, hint: string, defaultValue = ""): Promise<string | undefined> {
  return new Promise((resolve) => {
    let buf = defaultValue;
    let resolved = false;
    const isTTY = !!process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    const render = () => {
      process.stdout.write(A.clear);
      process.stdout.write(`\n  ${A.bold(A.accent("mya"))} ${A.muted(label)}\n`);
      process.stdout.write(`  ${A.dim2("─".repeat(50))}\n\n`);
      process.stdout.write(`  ${A.accent(buf + "_")}\n\n`);
      // Multi-line hint: split on newlines, indent each line in dim.
      for (const hintLine of hint.split("\n")) {
        process.stdout.write(`  ${A.dim2(hintLine)}\n`);
      }
      process.stdout.write(`\n  ${A.dim2("Enter = confirm  ·  Esc = cancel")}\n`);
    };
    const cleanup = (result?: string) => {
      if (resolved) return;
      resolved = true;
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(result);
    };
    const onData = (data: Buffer) => {
      const k = data.toString();
      if (k === "\x03" || k === "\x04") { cleanup(); return; }
      if (k === "\x1b") { cleanup(); return; }
      if (k === "\r" || k === "\n") { cleanup(buf.trim() || undefined); return; }
      if (k === "\x7f" || k === "\b") { buf = buf.slice(0, -1); render(); return; }
      if (k.length === 1 && k >= " ") {
        // First character clears the default value
        if (defaultValue && buf === defaultValue) buf = "";
        buf += k; render(); return;
      }
    };
    render();
    process.stdin.on("data", onData);
  });
}

/** Directory picker — user types path or picks current dir. */
function pickDirectory(initial: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let dir = initial;
    let inputMode = false;
    let inputBuf = "";
    let resolved = false;
    const isTTY = !!process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.altScreenOn + A.mouseOn + A.hideCursor);

    const render = () => {
      const lines: string[] = [];
      lines.push("");
      lines.push(`  ${A.bold(A.accent("mya"))} ${A.muted("- Working Directory")}`);
      lines.push(`  ${A.dim2("─".repeat(60))}`);
      lines.push("");
      if (inputMode) {
        lines.push(`  ${A.dim2("path:")} ${A.accent(inputBuf + "_")}`);
        lines.push(`  ${A.dim2("Enter to confirm | Esc to cancel")}`);
      } else {
        lines.push(`  ${A.dim2("Current:")} ${A.green(dir)}`);
        lines.push("");
        lines.push(`  ${A.dim2("Enter = use this directory")}`);
        lines.push(`  ${A.dim2("Type path = change directory")}`);
        lines.push(`  ${A.dim2("~/ = home | ../ = parent | /abs/path")}`);
      }
      lines.push(`  ${A.dim2("─".repeat(60))}`);
      lines.push(`  ${A.dim2("Enter confirm | Esc back | q cancel")}`);
      process.stdout.write(A.clear + lines.join("\n") + "\n");
    };

    const cleanup = (result?: string) => {
      if (resolved) return;
      resolved = true;
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.altScreenOff + A.mouseOff + A.clear + A.showCursor);
      resolve(result);
    };

    const onData = (data: Buffer) => {
      const k = data.toString();
      if (k === "\x03" || k === "\x04") { cleanup(); return; }
      if (k === "\x1b") {
        if (inputMode) { inputMode = false; inputBuf = ""; render(); return; }
        cleanup();
        return;
      }
      if (k === "\r" || k === "\n") {
        if (inputMode && inputBuf.trim()) {
          let p = inputBuf.trim();
          if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
          else if (p === "~") p = homedir();
          else if (!p.startsWith("/")) p = pathResolve(dir, p);
          cleanup(p);
        } else {
          cleanup(dir);
        }
        return;
      }
      if (k === "q" && !inputMode) { cleanup(); return; }
      if (!inputMode) {
        if (k.length === 1 && k >= " ") { inputMode = true; inputBuf = k; render(); return; }
      } else {
        if (k === "\x7f" || k === "\b") { inputBuf = inputBuf.slice(0, -1); render(); return; }
        if (k.length === 1 && k >= " ") { inputBuf += k; render(); return; }
      }
    };

    render();
    process.stdin.on("data", onData);
  });
}

/** Launch pi TUI connected to a gateway session via WS. */
async function launchGatewaySession(sessionId: string): Promise<void> {
  process.stdout.write(A.altScreenOff + A.mouseOff + A.clear);
  process.stdout.write("\n  " + A.muted("Connecting to gateway session " + sessionId + "...") + "\n\n");
  await new Promise<void>((resolve) => {
    const args = ["--gateway-session", sessionId];
    const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

/** Main launcher UI — fullscreen TUI with tabs, search, status bar, real-time refresh. */
function runLauncherUI(initialTab?: Tab): Promise<{ kind: "session"; id: string } | { kind: "new" } | { kind: "add-role" } | { kind: "delete-role"; name: string } | { kind: "view-skill"; path: string; subTab: "main" | "corpus" } | { kind: "edit-skill"; path: string; subTab: "main" | "corpus" } | { kind: "delete-skill"; path: string; name: string; subTab: "main" | "corpus" } | { kind: "add-skill"; subTab: "main" | "corpus" } | undefined> {
  return new Promise((resolve) => {
    const state: LauncherState = {
      tab: initialTab ?? "agents",
      sel: 0,
      cronSel: 0,
      filter: "",
      sessions: [],
      info: { connected: false, port: GW_PORT, sessions: 0, running: 0 },
      refreshing: false,
      lastRefresh: 0,
      skillSubTab: "main",
    };
    let resolved = false;
    let refreshTimer: SupervisedTaskHandle | undefined;
    const isTTY = !!process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.altScreenOn + A.mouseOn + A.hideCursor);

    const refresh = async () => {
      if (state.refreshing) return;
      state.refreshing = true;
      try {
        state.info = await loadGatewayInfo();
        state.sessions = await loadGatewaySessions();
        state.lastRefresh = nowWallclock();
        render();
      } finally { state.refreshing = false; }
    };

    const filteredSessions = (): Sess[] => {
      const items: Sess[] = [
        { id: "new", label: "New session", detail: "Choose directory + open gateway session", type: "new" },
        ...state.sessions,
      ];
      if (!state.filter) return items;
      const q = state.filter.toLowerCase();
      return items.filter((s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    };

    const render = () => {
      const lines: string[] = [];
      const w = process.stdout.columns || 100;
      const h = process.stdout.rows || 30;

      // Header
      const connIcon = state.info.connected ? A.green("●") : A.red("○");
      const connText = state.info.connected ? "connected" : "disconnected";
      lines.push(`  ${A.bold(A.accent("mya"))} ${A.muted("Session Launcher")}  ${connIcon} ${A.dim2("gateway")} ${connText} ${A.dim2("·")} ${A.dim2("port " + state.info.port)}`);
      lines.push(`  ${A.dim2("─".repeat(Math.max(40, w - 4)))}`);

      // Tabs
      const tabs: Tab[] = ["agents", "channels", "cron", "providers", "mcp", "skills", "memory", "roles", "status"];
      const tabLabels: Record<Tab, string> = {
        agents: `Agents (${state.info.sessions})`,
        channels: `Channels (${state.info.channels?.length ?? "?"})`,
        cron: `Cron (${state.info.cronJobs?.length ?? "?"})`,
        providers: `Providers (${state.info.providers?.length ?? "?"})`,
        mcp: `MCP (${state.info.mcpServers?.length ?? "?"})`,
        skills: `Skills (${state.info.skills?.length ?? "?"})`,
        memory: `Memory`,
        roles: `Roles (${state.info.roles?.length ?? "?"})`,
        status: "Status",
      };
      const tabLine = tabs.map((t) => {
        const label = tabLabels[t];
        return t === state.tab ? A.selBg(" " + A.bold(A.accent(label)) + " ") : " " + A.muted(label) + " ";
      }).join(A.dim2("│"));
      lines.push(`  ${tabLine}`);
      lines.push("");

      // Tab content
      if (state.tab === "agents") {
        const tree = state.info.agentTree ?? [];
        const sa = state.info.subagents;
        lines.push(`  ${A.green(String(state.info.running))} active ${A.dim2("/ " + state.info.sessions + " sessions")} ${A.dim2("· " + (sa?.active ?? 0) + " subagents")}`);
        lines.push("");
        // Build flat display list: main sessions + nested subagents
        const items: Array<{ kind: "main" | "sub"; id: string; label: string; status: string; detail: string }> = [];
        items.push({ kind: "main" as const, id: "new", label: "New agent session", status: "", detail: "Choose directory + open" });
        for (const entry of tree) {
          const label = entry.sessionId.replace(/^(ch-|s-)/, "").replace(/-/g, " ").slice(0, 28);
          items.push({ kind: "main", id: entry.sessionId, label, status: entry.busy ? "running" : "idle", detail: `${entry.messages} msgs ${A.dim2(fmt(entry.lastActivity))}` });
          if (entry.subagents) {
            for (const sub of entry.subagents) {
              items.push({ kind: "sub", id: sub.id, label: sub.goal.slice(0, 40), status: sub.status, detail: sub.output ? sub.output.slice(0, 50) : "" });
            }
          }
        }
        const maxRows = Math.max(3, h - 10);
        const half = Math.floor(maxRows / 2);
        const start = Math.max(0, Math.min(state.sel - half, Math.max(0, items.length - maxRows)));
        const end = Math.min(items.length, start + maxRows);
        if (start > 0) lines.push(`  ${A.dim2("  ↑ " + start + " above")}`);
        for (let i = start; i < end; i++) {
          const item = items[i]!;
          const is = i === state.sel;
          const indent = item.kind === "sub" ? "    └─ " : "";
          const icon = item.id === "new" ? A.blue("+") : item.kind === "sub"
            ? (item.status === "running" ? A.blue("●") : A.dim2("○"))
            : (item.status === "running" ? A.yellow("●") : A.green("○"));
          const statusStr = item.status ? (item.status === "running" ? A.yellow("running") : A.dim2(item.status)).padEnd(10) : "".padEnd(10);
          const baseLine = `${icon}  ${indent}${item.label.slice(0, 30).padEnd(32)} ${statusStr} ${A.dim2(item.detail)}`;
          lines.push(is ? `  ${A.selBg(baseLine + A.clrEol)}` : `  ${baseLine}`);
        }
        if (end < items.length) lines.push(`  ${A.dim2("  ↓ " + (items.length - end) + " more")}`);
      } else if (state.tab === "channels") {
        if (!state.info.channels?.length) {
          lines.push(`  ${A.muted("No channels configured.")}`);
        } else {
          for (const ch of state.info.channels) {
            const icon = ch.enabled ? A.green("●") : A.dim2("○");
            lines.push(`  ${icon}  ${ch.label.padEnd(24)}  ${A.dim2(ch.type)}  ${ch.enabled ? A.green("enabled") : A.dim2("disabled")}`);
          }
        }
      } else if (state.tab === "cron") {
        if (!state.info.cronJobs?.length) {
          lines.push(`  ${A.muted("No cron jobs.")}`);
          lines.push(`  ${A.muted("Add: ")}${A.accent("mya cron add <name> <schedule> <prompt>")}`);
        } else {
          for (let i = 0; i < state.info.cronJobs.length; i++) {
            const job = state.info.cronJobs[i]!;
            const is = i === state.cronSel;
            const icon = job.enabled ? A.green("●") : A.dim2("○");
            const sched = job.trigger === "on-interval" ? `every ${(job.schedule as number) / 1000}s` : String(job.schedule);
            const typeBadge = job.jobType === "shell" ? A.accent("🔧") : A.dim2("🤖");
            const lastStatus = job.lastStatus
              ? job.lastStatus === "succeeded" ? A.green("✓")
              : job.lastStatus === "failed" ? A.red("✗")
              : job.lastStatus === "lease-expired" ? A.yellow("⏱")
              : A.yellow("?")
              : A.dim2("-");
            const nextRun = job.nextRunAt ? A.dim2("next:" + fmt(job.nextRunAt)) : "";
            const line1 = `${icon}  ${job.name.padEnd(18)}  ${A.dim2(sched.padEnd(16))} ${typeBadge} ${lastStatus} ${A.dim2(fmt(job.lastRunAt ?? 0))} ${nextRun}`;
            if (is) lines.push(`  ${A.selBg(line1 + A.clrEol)}`);
            else lines.push(`  ${line1}`);
            if (job.prompt) {
              const promptLine = `      ${A.dim2("\"" + job.prompt.slice(0, 60) + (job.prompt.length > 60 ? "..." : "") + "\"")}`;
              lines.push(is ? `  ${A.selBg(promptLine + A.clrEol)}` : `  ${promptLine}`);
            }
          }
        }
      } else if (state.tab === "providers") {
        const providers = state.info.providers ?? [];
        const configured = providers.filter((p) => p.configured);
        const available = providers.filter((p) => !p.configured);
        const scrollUp = state.sel > 0 ? A.dim2("↑") : " ";
        const scrollDn = state.sel < providers.length - 1 ? A.dim2("↓") : " ";
        lines.push(`  ${A.green(configured.length + " configured")} ${A.dim2("· " + available.length + " available")}  ${scrollUp}${scrollDn}`);
        lines.push("");
        // Viewport: center selection, show a window
        const maxRows = Math.max(3, h - 12);
        const half = Math.floor(maxRows / 2);
        const start = Math.max(0, Math.min(state.sel - half, Math.max(0, providers.length - maxRows)));
        const end = Math.min(providers.length, start + maxRows);
        let showedConfigHdr = false;
        let showedAvailHdr = false;
        for (let i = start; i < end; i++) {
          const p = providers[i]!;
          if (p.configured && !showedConfigHdr) {
            lines.push(`  ${A.bold("Configured:")}`);
            showedConfigHdr = true;
          }
          if (!p.configured && !showedAvailHdr) {
            lines.push("");
            lines.push(`  ${A.bold("Available (" + available.length + "):")}`);
            showedAvailHdr = true;
          }
          const is = i === state.sel;
          const icon = p.configured ? A.green("●") : A.dim2("○");
          const name = p.configured ? p.id.padEnd(22) : A.dim2(p.id.padEnd(22));
          const model = A.dim2((p.model || "").slice(0, 28).padEnd(30));
          const baseLine = `${icon}  ${name} ${model} ${A.dim2(p.envKey)}`;
          const cleanLine = p.configured ? baseLine : baseLine.replace(/\x1b\[[\d;]+m/g, "");
          lines.push(is ? `  ${A.selBg(cleanLine + A.clrEol)}` : `  ${baseLine}`);
        }
        if (end < providers.length) {
          lines.push(`  ${A.dim2("  ↓ " + (providers.length - end) + " more — ↓ to scroll")}`);
        }
      } else if (state.tab === "mcp") {
        const servers = state.info.mcpServers ?? [];
        const connected = servers.filter((s) => s.phase === "Connected" || s.phase === "Validated");
        lines.push(`  ${A.green(connected.length + " connected")} ${A.dim2("· " + servers.length + " total")}`);
        lines.push("");
        if (servers.length === 0) {
          lines.push(`  ${A.muted("No MCP servers configured.")}`);
          lines.push(`  ${A.dim2("Press " + A.accent("a") + " to add an MCP server.")}`);
          lines.push(`  ${A.dim2("Example: npx @anthropic/mcp-server-filesystem /tmp")}`);
        } else {
          const maxRows = Math.max(3, h - 10);
          const half = Math.floor(maxRows / 2);
          const start = Math.max(0, Math.min(state.sel - half, Math.max(0, servers.length - maxRows)));
          const end = Math.min(servers.length, start + maxRows);
          if (start > 0) lines.push(`  ${A.dim2("  ↑ " + start + " above")}`);
          for (let i = start; i < end; i++) {
            const s = servers[i]!;
            const is = i === state.sel;
            const phaseIcon = s.phase === "Connected" || s.phase === "Validated" ? A.green("●") : s.phase === "Quarantine" ? A.red("✗") : A.dim2("○");
            const toolCount = s.tools.length;
            const cmd = `${s.command} ${(s.args ?? []).join(" ")}`.slice(0, 40);
            const baseLine = `${phaseIcon}  ${s.id.padEnd(18)} ${A.dim2(s.phase.padEnd(12))} ${A.dim2(String(toolCount).padStart(2) + " tools")} ${A.dim2(cmd)}`;
            lines.push(is ? `  ${A.selBg(baseLine + A.clrEol)}` : `  ${baseLine}`);
            if (s.lastError) {
              lines.push(`     ${A.red("└─ " + s.lastError.slice(0, 60))}`);
            }
          }
          if (end < servers.length) lines.push(`  ${A.dim2("  ↓ " + (servers.length - end) + " more")}`);
        }
      } else if (state.tab === "skills") {
        const mainSkills = state.info.skills ?? [];
        const corpusDir = join(homedir(), ".mya", "agent", "data");
        const corpusSkills = scanSkillDirectory(corpusDir);
        const mainActive = state.skillSubTab === "main";

        // Sub-tab toggle header with counts
        const mainLabel = `[Main ${mainSkills.length}]`;
        const corpusLabel = `[Corpus ${corpusSkills.length}]`;
        const mainPart = mainActive ? A.bold(A.accent(mainLabel)) : A.muted(mainLabel);
        const corpusPart = !mainActive ? A.bold(A.accent(corpusLabel)) : A.muted(corpusLabel);
        lines.push(`  ${mainPart}  ${corpusPart}  ${A.dim2("(s to switch)")}`);
        lines.push(`  ${A.dim2("from ~/.mya/agent/" + (mainActive ? "skills/" : "data/"))}`);
        lines.push("");

        // Build display list from active sub-tab
        const displaySkills: Array<{ name: string; description: string; triggers: string[]; filePath: string }> =
          mainActive
            ? mainSkills.map((s) => ({ name: s.name, description: s.description, triggers: s.triggers ?? [], filePath: join(homedir(), ".mya", "agent", "skills", s.name, "SKILL.md") }))
            : corpusSkills.map((s) => ({ name: s.name, description: s.description, triggers: [], filePath: s.filePath }));

        if (displaySkills.length === 0) {
          lines.push(`  ${A.muted("No skills found.")}`);
          lines.push(`  ${A.dim2(mainActive ? "Install to ~/.mya/agent/skills/<name>/SKILL.md" : "Add to ~/.mya/agent/data/<name>/SKILL.md")}`);
        } else {
          const maxRows = Math.max(3, h - 10);
          const half = Math.floor(maxRows / 2);
          const start = Math.max(0, Math.min(state.sel - half, Math.max(0, displaySkills.length - maxRows)));
          const end = Math.min(displaySkills.length, start + maxRows);
          if (start > 0) lines.push(`  ${A.dim2("  ↑ " + start + " above")}`);
          for (let i = start; i < end; i++) {
            const s = displaySkills[i]!;
            const is = i === state.sel;
            const triggers = s.triggers.length ? A.dim2("  ← " + s.triggers.slice(0, 3).join(", ")) : "";
            const baseLine = `${A.green("●")}  ${A.bold(s.name.padEnd(24))} ${A.dim2(s.description.slice(0, 50))}${triggers}`;
            lines.push(is ? `  ${A.selBg(baseLine + A.clrEol)}` : `  ${baseLine}`);
          }
          if (end < displaySkills.length) lines.push(`  ${A.dim2("  ↓ " + (displaySkills.length - end) + " more")}`);
        }
      } else if (state.tab === "memory") {
        const m = state.info.memoryStats;
        lines.push(`  ${A.bold("Brain Stats")}`);
        lines.push(`  ${A.dim2("─".repeat(40))}`);
        lines.push(`  ${A.green("●")}  Facts:        ${A.bold(String(m?.facts ?? 0))}`);
        lines.push(`  ${A.blue("●")}  Takes:        ${A.bold(String(m?.takes ?? 0))} ${A.dim2("(consolidated)")}`);
        lines.push(`  ${A.dim2("○")}  Tombstones:   ${m?.tombstones ?? 0} ${A.dim2("(72h TTL)")}`);
        lines.push("");
        lines.push(`  ${A.bold("Dream Cycle")}`);
        lines.push(`  ${A.dim2("─".repeat(40))}`);
        lines.push(`  ${m?.dreamRunning ? A.yellow("● running") : A.green("○ idle")}  Status:     ${m?.dreamRunning ? "consolidating..." : "waiting (30min)"}`);
        lines.push("");
        lines.push(`  ${A.dim2("Enter/d = trigger dream now | r refresh")}`);
      } else if (state.tab === "roles") {
        const roles = state.info.roles ?? [];
        if (roles.length === 0) {
          lines.push(`  ${A.dim2("No roles configured.")}`);
          lines.push(`  ${A.dim2("Create ~/.mya/roles/*.json to add roles.")}`);
        } else {
          lines.push(`  ${A.bold("Roles")}  ${A.dim2("(" + roles.length + " loaded from ~/.mya/roles/")}`);
          lines.push(`  ${A.dim2("─".repeat(40))}`);
          for (let i = 0; i < roles.length; i++) {
            const role = roles[i]!;
            const isSelected = i === state.sel;
            const tools = role.toolsAllowed
              ? A.blue(role.toolsAllowed.join(","))
              : role.toolsDenied
                ? A.dim2("all except ") + A.yellow(role.toolsDenied.join(","))
                : A.dim2("all tools");
            const model = role.modelPrefer ? A.accent(role.modelPrefer) : A.dim2("inherit");
            const cursor = isSelected ? A.accent("▶") : " ";
            const nameColored = isSelected ? A.bold(A.accent(role.name.padEnd(14))) : A.bold(role.name.padEnd(14));
            const line = `  ${cursor} ${nameColored} ${role.description}`;
            if (isSelected) {
              lines.push(`  ${A.selBg(line + A.clrEol)}`);
            } else {
              lines.push(line);
            }
            const indent = "    ";
            const toolLine = `${indent}${A.dim2("tools:")} ${tools}`;
            const modelLine = `${indent}${A.dim2("model:")} ${model}`;
            if (isSelected) {
              lines.push(`  ${A.selBg(toolLine + A.clrEol)}`);
              lines.push(`  ${A.selBg(modelLine + A.clrEol)}`);
            } else {
              lines.push(toolLine);
              lines.push(modelLine);
            }
            if (role.promptAppend) {
              const promptLine = `${indent}${A.dim2("prompt:")} ${role.promptAppend.slice(0, 60)}${role.promptAppend.length > 60 ? "…" : ""}`;
              if (isSelected) {
                lines.push(`  ${A.selBg(promptLine + A.clrEol)}`);
              } else {
                lines.push(promptLine);
              }
            }
            lines.push("");
          }
          lines.push(`  ${A.dim2("Use /role <name> in TUI to switch roles.")}`);
        }
      } else if (state.tab === "status") {
        const configuredProviders = (state.info.providers ?? []).filter((p) => p.configured);
        const statusLines: string[] = [];
        statusLines.push(`  ${A.dim2("Gateway:")}     ${state.info.connected ? A.green("online") : A.red("offline")}`);
        statusLines.push(`  ${A.dim2("Port:")}        ${state.info.port}`);
        statusLines.push(`  ${A.dim2("PID:")}          ${state.info.pid ?? "-"}`);
        statusLines.push(`  ${A.dim2("Version:")}      ${state.info.version ?? "-"}`);
        statusLines.push(`  ${A.dim2("Agents:")}       ${state.info.sessions} (${state.info.running} running)`);
        statusLines.push(`  ${A.dim2("Providers:")}   ${configuredProviders.length} configured`);
        statusLines.push(`  ${A.dim2("Channels:")}    ${state.info.channels?.length ?? 0}`);
        statusLines.push(`  ${A.dim2("Cron jobs:")}    ${state.info.cronJobs?.length ?? 0}`);
        statusLines.push(`  ${A.dim2("Model:")}       ${state.info.model ?? A.dim2("unknown")}`);
        if (state.info.uptime !== undefined) {
          const hh = Math.floor(state.info.uptime / 3600);
          const mm = Math.floor((state.info.uptime % 3600) / 60);
          statusLines.push(`  ${A.dim2("Uptime:")}      ${hh}h ${mm}m`);
        }
        statusLines.push(`  ${A.dim2("Last refresh:")} ${fmt(state.lastRefresh)}`);
        if (configuredProviders.length > 0) {
          statusLines.push("");
          statusLines.push(`  ${A.bold("Providers (" + configuredProviders.length + "):")}`);
          for (const p of configuredProviders) {
            statusLines.push(`  ${A.green("●")}  ${p.id.padEnd(14)} ${A.dim2(p.model)}`);
          }
        }
        statusLines.push("");
        statusLines.push(`  ${A.bold("Paths:")}`);
        statusLines.push(`  ${A.dim2("Config:")}       ~/.mya/`);
        statusLines.push(`  ${A.dim2("Memory:")}       ~/.mya/agent/memory/`);
        statusLines.push(`  ${A.dim2("Sessions:")}     ~/.mya/agent/sessions/`);
        statusLines.push(`  ${A.dim2("Skills:")}       ~/.mya/agent/skills/`);
        statusLines.push(`  ${A.dim2("Cron:")}         ~/.mya/agent/cron.json`);
        statusLines.push(`  ${A.dim2("Web:")}          http://127.0.0.1:${state.info.port}/`);
        // Viewport scroll for status
        const maxRows = Math.max(3, h - 8);
        const start = Math.max(0, Math.min(state.sel, Math.max(0, statusLines.length - maxRows)));
        const end = Math.min(statusLines.length, start + maxRows);
        if (start > 0) lines.push(`  ${A.dim2("↑ " + start + " above")}`);
        for (let i = start; i < end; i++) lines.push(statusLines[i]!);
        if (end < statusLines.length) lines.push(`  ${A.dim2("↓ " + (statusLines.length - end) + " more")}`);
      }

      // Footer / status bar
      const remaining = Math.max(0, h - lines.length - 4);
      for (let i = 0; i < remaining; i++) lines.push("");

      lines.push(`  ${A.dim2("─".repeat(Math.max(40, w - 4)))}`);
      const help = state.tab === "agents"
        ? "1-8 tabs | ↑/↓ select | Enter open | x kill | n new | r refresh | q quit"
        : state.tab === "channels"
          ? "1-8 tabs | ↑/↓ | Space toggle | t test | a add | q quit"
          : state.tab === "cron"
            ? "1-8 tabs | ↑/↓ | Space toggle | r run | d delete | a add | q quit"
            : state.tab === "providers"
              ? "1-8 tabs | ↑/↓ | a/Enter = add/edit key | d = remove | q quit"
              : state.tab === "mcp"
                ? "1-8 tabs | ↑/↓ | Enter/c = connect | d delete | a add | q quit"
                : state.tab === "skills"
                  ? "1-8 tabs | ↑/↓ select | s=sub-tab | a=add | v=view | e=edit | d=delete | q quit"
                  : state.tab === "memory"
                    ? "1-8 tabs | Enter/d = dream now | r refresh | q quit"
                    : state.tab === "roles"
                      ? "1-8 tabs | ↑/↓ select | a add | d delete | r refresh | q quit"
                      : "1-8 tabs | ↑/↓ scroll | r refresh | q quit";
      lines.push(`  ${A.dim2(help)}`);

      process.stdout.write(A.clear + lines.join("\n") + "\n");
    };

    const cleanup = (result?: { kind: "session"; id: string } | { kind: "new" } | { kind: "add-role" } | { kind: "delete-role"; name: string } | { kind: "view-skill"; path: string; subTab: "main" | "corpus" } | { kind: "edit-skill"; path: string; subTab: "main" | "corpus" } | { kind: "delete-skill"; path: string; name: string; subTab: "main" | "corpus" } | { kind: "add-skill"; subTab: "main" | "corpus" }) => {
      if (resolved) return;
      resolved = true;
      if (refreshTimer) refreshTimer.stop();
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.altScreenOff + A.mouseOff + A.clear + A.showCursor);
      // Remember the current tab so launcher can resume there after external actions
      if (result && typeof result === "object") (result as { _resumeTab?: Tab })._resumeTab = state.tab;
      resolve(result);
    };

    const onData = async (data: Buffer) => {
      if (resolved) return;
      const k = data.toString();

      if (k === "\x03" || k === "\x04") { cleanup(); return; }
      if (k === "q") { cleanup(); return; }
      if (k === "r") { void refresh(); return; }

      // Tab switch
      if (k === "\t" || k === "\x1b[Z") {
        const tabs: Tab[] = ["agents", "channels", "cron", "providers", "mcp", "skills", "memory", "roles", "status"];
        const idx = tabs.indexOf(state.tab);
        state.tab = tabs[(idx + 1) % tabs.length]!;
        state.sel = 0;
        state.cronSel = 0;
        void refresh();
        return;
      }
      if (k === "1") { state.tab = "agents"; state.sel = 0; void refresh(); return; }
      if (k === "2") { state.tab = "channels"; state.sel = 0; void refresh(); return; }
      if (k === "3") { state.tab = "cron"; state.cronSel = 0; void refresh(); return; }
      if (k === "4") { state.tab = "providers"; state.sel = 0; void refresh(); return; }
      if (k === "5") { state.tab = "mcp"; state.sel = 0; void refresh(); return; }
      if (k === "6") { state.tab = "skills"; state.sel = 0; void refresh(); return; }
      if (k === "7") { state.tab = "memory"; state.sel = 0; void refresh(); return; }
      if (k === "8") { state.tab = "status"; state.sel = 0; void refresh(); return; }

      if (state.tab === "agents") {
        if (k === "n") { cleanup({ kind: "new" }); return; }
        if (k === "x") {
          const items = filteredSessions();
          const target = items[state.sel];
          if (target && target.type === "gateway") {
            void killGatewaySession(target.id).then(() => refresh());
          }
          return;
        }
        if (k === "\x1b[A") {
          state.sel = Math.max(0, state.sel - 1);
          render();
          return;
        }
        if (k === "\x1b[B") {
          const items = filteredSessions();
          state.sel = Math.min(items.length - 1, state.sel + 1);
          render();
          return;
        }
        if (k === "\r" || k === "\n") {
          const items = filteredSessions();
          const target = items[state.sel];
          if (!target) return;
          if (target.type === "new") { cleanup({ kind: "new" }); return; }
          cleanup({ kind: "session", id: target.id });
          return;
        }
        if (k === "\x1b") { state.filter = ""; state.sel = 0; render(); return; }
        if (k === "\x7f" || k === "\b") {
          state.filter = state.filter.slice(0, -1);
          state.sel = 0;
          render();
          return;
        }
        if (k.length === 1 && k >= " " && k <= "~") {
          state.filter += k;
          state.sel = 0;
          render();
          return;
        }
      } else if (state.tab === "channels") {
        const channels = state.info.channels ?? [];
        if (k === "\x1b[A") { state.sel = Math.max(0, state.sel - 1); render(); return; }
        if (k === "\x1b[B") { state.sel = Math.min(Math.max(0, channels.length - 1), state.sel + 1); render(); return; }
        if (k === " ") {
          const ch = channels[state.sel];
          if (ch) { void toggleChannel(ch.id, !ch.enabled).then(() => refresh()); }
          return;
        }
        if (k === "t") {
          const ch = channels[state.sel];
          if (ch) {
            void testChannel(ch.id).then((result) => {
              const msg = result.ok ? A.green("✓ test sent") : A.red(`✗ ${result.error ?? "failed"}`);
              process.stdout.write(`\n  ${msg}\n  ${A.dim2("Press any key...")}`);
            });
          }
          return;
        }
        if (k === "a") {
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          if (isTTY) process.stdin.setRawMode(false);
          process.stdout.write(A.altScreenOff + A.showCursor);
          const type = await inlinePrompt("Add Channel", "Channel type. One of:\ntelegram | discord | slack | whatsapp | signal | matrix | email | webhook", "telegram");
          if (type) {
            const token = await inlinePrompt("Channel Token", `Env var NAME holding the ${type} token (e.g. TELEGRAM_BOT_TOKEN).\nThe value must be set in your shell environment — not entered here.`);
            if (token) {
              process.stdout.write(`\n  ${A.muted("Set in shell:")} ${A.accent(token)}=xxx && mya serve\n`);
            }
          }
          if (isTTY) process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdout.write(A.altScreenOn + A.hideCursor);
          process.stdin.on("data", onData);
          void refresh();
          return;
        }
      } else if (state.tab === "cron") {
        const jobs = state.info.cronJobs ?? [];
        if (k === "\x1b[A") {
          state.cronSel = Math.max(0, state.cronSel - 1);
          render();
          return;
        }
        if (k === "\x1b[B") {
          state.cronSel = Math.min(Math.max(0, jobs.length - 1), state.cronSel + 1);
          render();
          return;
        }
        if (k === " ") {
          const job = jobs[state.cronSel];
          if (job) {
            void fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs/${job.id}/patch`, {
              method: "POST",
              headers: withAuth({ "content-type": "application/json" }),
              body: JSON.stringify({ enabled: !job.enabled }),
            }).then(() => refresh());
          }
          return;
        }
        if (k === "r" || k === "\r" || k === "\n") {
          const job = jobs[state.cronSel];
          if (job) {
            void fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs/${job.id}/run`, { method: "POST", headers: authHeaders() });
          }
          return;
        }
        if (k === "d") {
          const job = jobs[state.cronSel];
          if (job) {
            void fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs/${job.id}`, { method: "DELETE", headers: authHeaders() })
              .then(() => refresh());
          }
          return;
        }
        if (k === "a") {
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          if (isTTY) process.stdin.setRawMode(false);
          process.stdout.write(A.altScreenOff + A.showCursor);
          const name = await inlinePrompt("Cron Job Name", "Cron job name (kebab-case: e.g. daily-standup, weekly-review)");
          if (name) {
            const schedule = await inlinePrompt("Schedule", "When to run. Either:\ncron: '0 9 * * MON'  (min hour day month day-of-week)\ninterval-ms: '3600000'  (milliseconds; 3600000 = every hour)", "0 9 * * *");
            if (schedule) {
              const prompt = await inlinePrompt("Prompt", "What the agent should do when this job fires.\nOne line describing the task.");
              if (prompt) {
                const ok = await addCronJob(name, schedule, prompt);
                process.stdout.write(`\n  ${ok ? A.green("✓ Job added") : A.red("✗ Failed")}\n  ${A.dim2("Press any key...")}`);
              }
            }
          }
          if (isTTY) process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdout.write(A.altScreenOn + A.hideCursor);
          process.stdin.on("data", onData);
          void refresh();
          return;
        }
      } else if (state.tab === "providers") {
        const providers = state.info.providers ?? [];
        if (k === "\x1b[A") { state.sel = Math.max(0, state.sel - 1); render(); return; }
        if (k === "\x1b[B") { state.sel = Math.min(Math.max(0, providers.length - 1), state.sel + 1); render(); return; }
        if (k === "\r" || k === "\n" || k === "a") {
          const p = providers[state.sel];
          if (!p) return;
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          if (isTTY) process.stdin.setRawMode(false);
          process.stdout.write(A.altScreenOff + A.showCursor);
          if (p.configured && k === "\r") {
            // Show details + offer remove
            const action = await inlinePrompt(`Provider: ${p.id}`, `${p.envKey} is SET. Type 'remove' to delete, Enter to cancel`);
            if (action === "remove") {
              const result = await configureProvider(p.id, p.envKey, "", "remove");
              process.stdout.write(`\n  ${result.ok ? A.green("✓ Removed") : A.red("✗ Failed")}\n  ${A.dim2("Restart gateway: systemctl --user restart mya-gateway")}`);
            }
          } else {
            // Add API key
            const apiKey = await inlinePrompt(`Add ${p.id}`, `Secret API key value for ${p.envKey}.\nStored securely in ~/.mya/agent/auth.json.`);
            if (apiKey) {
              const result = await configureProvider(p.id, p.envKey, apiKey, "add");
              process.stdout.write(`\n  ${result.ok ? A.green("✓ Saved to ~/.mya/gateway.env") : A.red("✗ Failed")}\n  ${A.dim2("Restart gateway: systemctl --user restart mya-gateway")}`);
            }
          }
          if (isTTY) process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdout.write(A.altScreenOn + A.hideCursor);
          process.stdin.on("data", onData);
          void refresh();
          return;
        }
        if (k === "d") {
          // Quick delete (configured providers only)
          const p = providers[state.sel];
          if (p?.configured) {
            const result = await configureProvider(p.id, p.envKey, "", "remove");
            void refresh();
          }
          return;
        }
      } else if (state.tab === "mcp") {
        const servers = state.info.mcpServers ?? [];
        if (k === "\x1b[A") { state.sel = Math.max(0, state.sel - 1); render(); return; }
        if (k === "\x1b[B") { state.sel = Math.min(Math.max(0, servers.length - 1), state.sel + 1); render(); return; }
        if (k === "\r" || k === "\n" || k === "c") {
          const s = servers[state.sel];
          if (s) {
            void fetch(`http://127.0.0.1:${GW_PORT}/mcp/servers/${s.id}/connect`, { method: "POST", headers: authHeaders() })
              .then(() => fetch(`http://127.0.0.1:${GW_PORT}/mcp/servers/${s.id}/discover`, { method: "POST", headers: authHeaders() }))
              .then(() => refresh());
          }
          return;
        }
        if (k === "d") {
          const s = servers[state.sel];
          if (s) { void fetch(`http://127.0.0.1:${GW_PORT}/mcp/servers/${s.id}`, { method: "DELETE", headers: authHeaders() }).then(() => refresh()); }
          return;
        }
        if (k === "a") {
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          if (isTTY) process.stdin.setRawMode(false);
          process.stdout.write(A.altScreenOff + A.showCursor);
          const id = await inlinePrompt("MCP Server ID", "MCP server ID (kebab-case: e.g. filesystem, github, slack)");
          if (id) {
            const command = await inlinePrompt("Command", "Executable to run the server (e.g. npx, node, python3)", "npx");
            if (command) {
              const argsStr = await inlinePrompt("Args", "Command arguments, space-separated.\ne.g. @anthropic/mcp-server-filesystem /tmp");
              const args = argsStr ? argsStr.split(/\s+/).filter(Boolean) : [];
              try {
                await fetch(`http://127.0.0.1:${GW_PORT}/mcp/servers`, {
                  method: "POST",
                  headers: withAuth({ "content-type": "application/json" }),
                  body: JSON.stringify({ id, command, args }),
                  signal: AbortSignal.timeout(2000),
                });
                process.stdout.write(`\n  ${A.green("✓ Added")} ${A.dim2(id)}\n  ${A.dim2("Press Enter to connect")}`);
              } catch {
                process.stdout.write(`\n  ${A.red("✗ Failed")}`);
              }
            }
          }
          if (isTTY) process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdout.write(A.altScreenOn + A.hideCursor);
          process.stdin.on("data", onData);
          void refresh();
          return;
        }
      } else if (state.tab === "skills") {
        // Build skills list (same logic as render)
        const mainActive = state.skillSubTab === "main";
        const mainSkills = state.info.skills ?? [];
        const skills: Array<{ name: string; filePath: string }> = mainActive
          ? mainSkills.map((s) => ({ name: s.name, filePath: join(homedir(), ".mya", "agent", "skills", s.name, "SKILL.md") }))
          : scanSkillDirectory(join(homedir(), ".mya", "agent", "data")).map((s) => ({ name: s.name, filePath: s.filePath }));

        if (k === "\x1b[A") { state.sel = Math.max(0, state.sel - 1); render(); return; }
        if (k === "\x1b[B") { state.sel = Math.min(Math.max(0, skills.length - 1), state.sel + 1); render(); return; }
        if (k === "s") { state.skillSubTab = mainActive ? "corpus" : "main"; state.sel = 0; render(); return; }
        if (k === "a") { cleanup({ kind: "add-skill", subTab: state.skillSubTab }); return; }
        if (k === "v" || k === "\r" || k === "\n") {
          const skill = skills[state.sel];
          if (skill && /^[a-z0-9][a-z0-9-]*$/.test(skill.name)) {
            cleanup({ kind: "view-skill", path: skill.filePath, subTab: state.skillSubTab });
          }
          return;
        }
        if (k === "e") {
          const skill = skills[state.sel];
          if (skill && /^[a-z0-9][a-z0-9-]*$/.test(skill.name)) {
            cleanup({ kind: "edit-skill", path: skill.filePath, subTab: state.skillSubTab });
          }
          return;
        }
        if (k === "d") {
          const skill = skills[state.sel];
          if (skill && /^[a-z0-9][a-z0-9-]*$/.test(skill.name)) {
            cleanup({ kind: "delete-skill", path: skill.filePath, name: skill.name, subTab: state.skillSubTab });
          }
          return;
        }
      } else if (state.tab === "memory") {
        if (k === "\r" || k === "\n" || k === "d") {
          void fetch(`http://127.0.0.1:${GW_PORT}/memory/dream`, { method: "POST", headers: authHeaders() })
            .then((r) => r.json())
            .then((result: unknown) => {
              const consolidated = String((result as { memoriesConsolidated?: number })?.memoriesConsolidated ?? 0);
              process.stdout.write(`\n  ${A.green("✓ Dream complete")} ${A.dim2(consolidated + " consolidated")}`);
            });
          void refresh();
          return;
        }
      } else if (state.tab === "roles") {
        const roles = state.info.roles ?? [];
        if (k === "\x1b[A") { state.sel = Math.max(0, state.sel - 1); render(); return; }
        if (k === "\x1b[B") { state.sel = Math.min(Math.max(0, roles.length - 1), state.sel + 1); render(); return; }
        if (k === "a") {
          // Exit TUI cleanly, run add flow externally (pickDirectory pattern)
          const currentTab = state.tab;
          cleanup({ kind: "add-role" });
          // Store current tab so launcher can resume
          (cleanup as unknown as { _lastTab?: Tab })._lastTab = currentTab;
          return;
        }
        if (k === "d") {
          const role = roles[state.sel];
          if (role && role.name !== "default") {
            cleanup({ kind: "delete-role", name: role.name });
            return;
          }
        }
      } else if (state.tab === "status") {
        // ↑/↓ scrolls the status viewport
        if (k === "\x1b[A") { state.sel = Math.max(0, state.sel - 1); render(); return; }
        if (k === "\x1b[B") { state.sel = state.sel + 1; render(); return; }
      }
    };

    void refresh();
    refreshTimer = supervisedTask(() => void refresh(), "launcher-refresh", { intervalMs: REFRESH_MS });
    render();
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  let resumeTab: Tab | undefined;
  while (true) {
    const result = await runLauncherUI(resumeTab);
    if (!result) return;

    if (result.kind === "new") {
      const cwd = await pickDirectory(process.cwd());
      if (!cwd) { resumeTab = "agents"; continue; }
      const sessionId = await acquireGatewaySession(cwd);
      if (sessionId) await launchGatewaySession(sessionId);
      resumeTab = "agents";
    } else if (result.kind === "session") {
      await launchGatewaySession(result.id);
      resumeTab = "agents";
    } else if (result.kind === "add-role") {
      // External prompt flow (pickDirectory pattern — proven to work)
      const roleName = await promptForRoleName();
      if (roleName) {
        const description = await inlinePrompt("Description", "What does this role do? (one line — shown in the launcher)");
        if (description) {
          const promptAppend = await inlinePrompt("Prompt (optional)", "Appended to the system prompt when this role is active.\nDescribe the role's persona/constraints. Enter to skip.");
          const ok = await addRoleFile(roleName, description, promptAppend ?? "");
          process.stdout.write(`\n  ${ok ? A.green("✓ Role created") : A.red("✗ Failed")} ${A.dim2("(~/.mya/roles/" + roleName + ".json)")}\n`);
          process.stdout.write(`  ${A.dim2("Edit the file to add tools/model settings. Press any key...")}`);
          await waitForKey();
        }
      }
      resumeTab = "roles";
    } else if (result.kind === "delete-role") {
      const ok = await deleteRoleFile(result.name);
      process.stdout.write(`\n  ${ok ? A.green("✓ Deleted") : A.red("✗ Failed")} ${A.dim2(result.name)}\n`);
      process.stdout.write(`  ${A.dim2("Press any key...")}`);
      await waitForKey();
      resumeTab = "roles";
    } else if (result.kind === "view-skill") {
      const pager = process.env.PAGER ?? "less";
      const child = spawn(pager, [result.path], { stdio: "inherit" });
      await new Promise<void>((r) => { child.on("exit", () => r()); child.on("error", () => r()); });
      resumeTab = "skills";
    } else if (result.kind === "edit-skill") {
      const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
      const child = spawn(editor, [result.path], { stdio: "inherit" });
      await new Promise<void>((r) => { child.on("exit", () => r()); child.on("error", () => r()); });
      resumeTab = "skills";
    } else if (result.kind === "delete-skill") {
      const confirm = await inlinePrompt("Delete skill", `Type "${result.name}" to confirm deletion`);
      if (confirm === result.name) {
        // SECURITY: derive skillDir from result.path (the real SKILL.md filePath from
        // scanSkillDirectory) via dirname — NOT from result.name (frontmatter, untrusted,
        // could be "../.."). Then validate it stays within the expected base dir.
        const { dirname, resolve } = await import("node:path");
        const base = join(homedir(), ".mya", "agent", result.subTab === "main" ? "skills" : "data");
        const skillDir = dirname(result.path);
        if (!resolve(skillDir).startsWith(resolve(base) + "/") && resolve(skillDir) !== resolve(base)) {
          process.stdout.write(`\n  ${A.red("✗ Refused")} ${A.dim2("path outside skill dir")}\n`);
        } else {
          try {
            const { rmSync } = await import("node:fs");
            rmSync(skillDir, { recursive: true, force: true });
            process.stdout.write(`\n  ${A.green("✓ Deleted")} ${A.dim2(skillDir)}\n`);
          } catch {
            process.stdout.write(`\n  ${A.red("✗ Delete failed")}\n`);
          }
        }
      } else {
        process.stdout.write(`\n  ${A.yellow("⊘ Cancelled")}\n`);
      }
      process.stdout.write(`  ${A.dim2("Press any key...")}`);
      await waitForKey();
      resumeTab = "skills";
    } else if (result.kind === "add-skill") {
      const name = await inlinePrompt("New skill name", "Skill name — kebab-case (lowercase letters, digits, hyphens).\nExample: my-coding-skill\nNo spaces, uppercase, or special chars.\nSaved to the active sub-tab's directory (Main → ~/.mya/agent/skills/, Corpus → ~/.mya/agent/data/).");
      if (name && /^[a-z0-9][a-z0-9-]*$/.test(name)) {
        const description = await inlinePrompt("Description", "One-line description — used by skill-search to index + match skills.\nBe specific: domain + purpose.\nExample: 'REST API design patterns — resource naming, status codes, versioning'");
        if (description) {
          const path = await addSkillFile(name, description, result.subTab);
          if (path) {
            process.stdout.write(`\n  ${A.green("✓ Skill created")} ${A.dim2(path)}\n`);
            // Open editor so the user can fill the instruction body.
            const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
            const child = spawn(editor, [path], { stdio: "inherit" });
            await new Promise<void>((r) => { child.on("exit", () => r()); child.on("error", () => r()); });
          } else {
            process.stdout.write(`\n  ${A.red("✗ Failed")} ${A.dim2("(invalid name or already exists)")}\n`);
          }
          process.stdout.write(`  ${A.dim2("Press any key...")}`);
          await waitForKey();
        }
      } else if (name) {
        process.stdout.write(`\n  ${A.red("✗ Invalid name")} ${A.dim2("use kebab-case (lowercase, digits, hyphens)")}\n`);
        process.stdout.write(`  ${A.dim2("Press any key...")}`);
        await waitForKey();
      }
      resumeTab = "skills";
    } else {
      const _exhaustive: never = result;
      void _exhaustive;
      return;
    }
  }
}

/** Wait for any keypress (used after external action messages). */
function waitForKey(): Promise<void> {
  return new Promise<void>((resolve) => {
    const isTTY = !!process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    const h = () => { process.stdin.removeListener("data", h); resolve(); };
    process.stdin.on("data", h);
  });
}

/** Prompt for a valid role name (kebab-case). Re-prompts on invalid. */
async function promptForRoleName(): Promise<string | undefined> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const rolesDir = join(homedir(), ".mya", "roles");
  for (let retries = 3; retries > 0; retries--) {
    const n = await inlinePrompt("Role Name", "Role name — kebab-case (e.g. coder, reviewer, researcher).\nSaved to ~/.mya/roles/<name>.json");
    if (!n) return undefined; // Escape
    if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) {
      process.stdout.write(`\n  ${A.red("✗ Invalid name")} ${A.dim2("— use kebab-case (lowercase, digits, hyphens, must start with letter/digit)")}\n  ${A.dim2("Press any key to retry...")}`);
      await waitForKey();
      continue;
    }
    // BUG #6: reject duplicate names instead of silently overwriting.
    if (existsSync(join(rolesDir, `${n}.json`))) {
      process.stdout.write(`\n  ${A.red("✗ Already exists")} ${A.dim2(`— a role named "${n}" already exists. Choose a different name.`)}\n  ${A.dim2("Press any key to retry...")}`);
      await waitForKey();
      continue;
    }
    return n;
  }
  return undefined;
}
