/**
 * mya Session Launcher — Phase 1+2+3.
 *
 * Features:
 *  - 4 tabs: Sessions, Channels, Cron, Status
 *  - Search/filter input
 *  - Real-time refresh (poll 2s)
 *  - Status bar (connection, session count)
 *  - Fullscreen TUI (alt screen + mouse via ANSI)
 *  - New session → gateway acquire (always)
 *  - x kill, n new, q quit, Tab switch, r refresh
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { nowWallclock } from "@my-agent/core";

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
  cronJobs?: Array<{ id: string; name: string; trigger: string; schedule: string | number; prompt: string; enabled: boolean; lastRunAt?: number; lastStatus?: string }>;
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
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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
  const [health, sessions, status, cronJobs] = await Promise.all([
    fetchJson<{ state: string; ok: boolean }>(`http://127.0.0.1:${GW_PORT}/health/live`),
    loadGatewaySessions(),
    fetchJson<{ model?: string; uptime?: number; channels?: GatewayInfo["channels"] }>(`http://127.0.0.1:${GW_PORT}/status`),
    fetchJson<Array<{ id: string; name: string; trigger: string; schedule: string | number; prompt: string; enabled: boolean; lastRunAt?: number; lastStatus?: string }>>(`http://127.0.0.1:${GW_PORT}/cron/jobs`),
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
  };
}

async function acquireGatewaySession(cwd: string): Promise<string | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/acquire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch { return false; }
}

type Tab = "sessions" | "channels" | "cron" | "status";

interface LauncherState {
  tab: Tab;
  sel: number;
  filter: string;
  sessions: Sess[];
  info: GatewayInfo;
  refreshing: boolean;
  lastRefresh: number;
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
    const args = ["--model", "MiniMax-M3", "--gateway-session", sessionId];
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
function runLauncherUI(): Promise<{ kind: "session"; id: string } | { kind: "new" } | undefined> {
  return new Promise((resolve) => {
    const state: LauncherState = {
      tab: "sessions",
      sel: 0,
      filter: "",
      sessions: [],
      info: { connected: false, port: GW_PORT, sessions: 0, running: 0 },
      refreshing: false,
      lastRefresh: 0,
    };
    let resolved = false;
    let refreshTimer: NodeJS.Timeout | undefined;
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
      const tabs: Tab[] = ["sessions", "channels", "cron", "status"];
      const tabLabels: Record<Tab, string> = {
        sessions: `Sessions (${state.info.sessions})`,
        channels: `Channels (${state.info.channels?.length ?? "?"})`,
        cron: `Cron (${state.info.cronJobs?.length ?? "?"})`,
        status: "Status",
      };
      const tabLine = tabs.map((t) => {
        const label = tabLabels[t];
        return t === state.tab ? A.selBg(" " + A.bold(A.accent(label)) + " ") : " " + A.muted(label) + " ";
      }).join(A.dim2("│"));
      lines.push(`  ${tabLine}`);
      lines.push("");

      // Tab content
      if (state.tab === "sessions") {
        lines.push(`  ${A.dim2("search:")} ${A.accent(state.filter || "_")}  ${A.dim2("(type to filter, Esc to clear)")}`);
        lines.push("");

        const items = filteredSessions();
        if (state.info.connected && items.length === 1) {
          lines.push(`  ${A.muted("No active gateway sessions.")}`);
          lines.push(`  ${A.muted("Press ")} ${A.accent("n")} ${A.muted("to start a new one.")}`);
        } else {
          const max = Math.max(0, h - 12);
          const visible = items.slice(0, max);
          for (let i = 0; i < visible.length; i++) {
            const s = visible[i]!;
            const is = i === state.sel;
            const icon = s.type === "new" ? A.blue("+") : s.busy ? A.yellow("●") : A.green("○");
            const id = s.id.length > 30 ? s.id.slice(0, 27) + "..." : s.id;
            const line1 = `${icon}  ${is ? A.bold(A.accent(s.label)) : s.label}`;
            const line2 = `   ${A.dim2(id)}  ${A.dim2(s.detail)}`;
            if (is) {
              lines.push(`  ${A.selBg(line1 + A.clrEol)}`);
              lines.push(`  ${A.selBg(line2 + A.clrEol)}`);
            } else {
              lines.push(`  ${line1}`);
              lines.push(`  ${line2}`);
            }
          }
        }
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
          for (const job of state.info.cronJobs) {
            const icon = job.enabled ? A.green("●") : A.dim2("○");
            const sched = job.trigger === "on-interval" ? `every ${(job.schedule as number) / 1000}s` : String(job.schedule);
            const lastStatus = job.lastStatus
              ? job.lastStatus === "succeeded" ? A.green("✓")
              : job.lastStatus === "failed" ? A.red("✗")
              : A.yellow("?")
              : A.dim2("-");
            lines.push(`  ${icon}  ${job.name.padEnd(20)}  ${A.dim2(sched)}  ${A.dim2(job.trigger)}  ${lastStatus} ${A.dim2(fmt(job.lastRunAt))}`);
            if (job.prompt) lines.push(`      ${A.dim2("\"" + job.prompt.slice(0, 60) + (job.prompt.length > 60 ? "..." : "") + "\"")}`);
          }
        }
      } else if (state.tab === "status") {
        lines.push(`  ${A.dim2("Gateway:")}     ${state.info.connected ? A.green("online") : A.red("offline")}`);
        lines.push(`  ${A.dim2("Port:")}        ${state.info.port}`);
        lines.push(`  ${A.dim2("Sessions:")}    ${state.info.sessions} ${A.dim2("(")}${state.info.running} running${A.dim2(")")}`);
        lines.push(`  ${A.dim2("Model:")}       ${state.info.model ?? A.dim2("unknown")}`);
        if (state.info.uptime !== undefined) {
          const up = state.info.uptime;
          const hh = Math.floor(up / 3600);
          const mm = Math.floor((up % 3600) / 60);
          lines.push(`  ${A.dim2("Uptime:")}      ${hh}h ${mm}m`);
        }
        lines.push(`  ${A.dim2("Last refresh:")} ${fmt(state.lastRefresh)}`);
        lines.push("");
        lines.push(`  ${A.dim2("Config:")}       ~/.mya/`);
        lines.push(`  ${A.dim2("Sessions:")}     ~/.mya/agent/sessions/`);
        lines.push(`  ${A.dim2("Web:")}          http://127.0.0.1:${state.info.port}/`);
      }

      // Footer / status bar
      const remaining = Math.max(0, h - lines.length - 4);
      for (let i = 0; i < remaining; i++) lines.push("");

      lines.push(`  ${A.dim2("─".repeat(Math.max(40, w - 4)))}`);
      const help = state.tab === "sessions"
        ? "↑/↓ | Enter open | type search | x kill | n new | Tab switch | r refresh | q quit"
        : "Tab switch | r refresh | q quit";
      lines.push(`  ${A.dim2(help)}`);

      process.stdout.write(A.clear + lines.join("\n") + "\n");
    };

    const cleanup = (result?: { kind: "session"; id: string } | { kind: "new" }) => {
      if (resolved) return;
      resolved = true;
      if (refreshTimer) clearInterval(refreshTimer);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.altScreenOff + A.mouseOff + A.clear + A.showCursor);
      resolve(result);
    };

    const onData = (data: Buffer) => {
      if (resolved) return;
      const k = data.toString();

      if (k === "\x03" || k === "\x04") { cleanup(); return; }
      if (k === "q") { cleanup(); return; }
      if (k === "r") { void refresh(); return; }

      // Tab switch
      if (k === "\t" || k === "\x1b[Z") {
        const tabs: Tab[] = ["sessions", "channels", "cron", "status"];
        const idx = tabs.indexOf(state.tab);
        state.tab = tabs[(idx + 1) % tabs.length]!;
        state.sel = 0;
        void refresh();
        return;
      }
      if (k === "1") { state.tab = "sessions"; state.sel = 0; void refresh(); return; }
      if (k === "2") { state.tab = "channels"; state.sel = 0; void refresh(); return; }
      if (k === "3") { state.tab = "cron"; state.sel = 0; void refresh(); return; }
      if (k === "4") { state.tab = "status"; state.sel = 0; void refresh(); return; }

      if (state.tab === "sessions") {
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
      }
    };

    void refresh();
    refreshTimer = setInterval(() => void refresh(), REFRESH_MS);
    render();
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const result = await runLauncherUI();
    if (!result) return;

    if (result.kind === "new") {
      const cwd = await pickDirectory(process.cwd());
      if (!cwd) continue;
      const sessionId = await acquireGatewaySession(cwd);
      if (sessionId) await launchGatewaySession(sessionId);
    } else if (result.kind === "session") {
      await launchGatewaySession(result.id);
    }
  }
}
