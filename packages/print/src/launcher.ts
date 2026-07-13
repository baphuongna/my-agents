/**
 * mya Session Launcher — gateway live sessions + saved sessions.
 *
 * Gateway pool sessions (pi AgentSession) can be viewed LIVE:
 *   - Select gateway session → WS connect → see all events real-time
 *   - Channel messages (Telegram/Discord) arrive → visible in viewer
 *   - User can also type prompts directly
 *   - Ctrl+Q to disconnect → back to launcher
 *
 * Saved JSONL sessions → pi InteractiveMode (full TUI).
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[38;2;210;153;34m${s}\x1b[39m`,
  blue: (s: string) => `\x1b[38;2;95;153;207m${s}\x1b[39m`,
  selBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clear: "\x1b[2J\x1b[H",
  clrEol: "\x1b[K",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

interface Sess {
  id: string;
  label: string;
  detail: string;
  type: "gateway" | "saved" | "new";
  arg?: string;
}

const GW_PORT = parseInt(process.env["MYA_PORT"] ?? "3000", 10);

async function checkGateway(): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${GW_PORT}/health/live`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}

async function getWsToken(): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/ws-info`, { signal: AbortSignal.timeout(500) });
    if (!r.ok) return null;
    return ((await r.json()) as { token: string }).token;
  } catch { return null; }
}

async function loadGatewaySessions(): Promise<Sess[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/sessions`, { signal: AbortSignal.timeout(500) });
    if (!r.ok) return [];
    const arr = (await r.json()) as Array<{ sessionId: string; messages: number; lastActivity: number; busy: boolean }>;
    return arr.map((s) => ({
      id: s.sessionId,
      label: s.sessionId.replace(/^ch-/, "").replace(/-/g, " "),
      detail: `${s.messages} msgs | ${s.busy ? "running" : "idle"} | ${fmt(s.lastActivity)}`,
      type: "gateway" as const,
      arg: (s as { sessionFile?: string }).sessionFile ?? s.sessionId,
    }));
  } catch { return []; }
}

function fmt(ts: number): string {
  if (!ts || isNaN(ts)) return "-";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = nowWallclock() - ms;
  if (d < 0 || d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h`;
}

function loadSaved(): Sess[] {
  const dir = join(homedir(), ".mya", "agent", "sessions");
  if (!existsSync(dir)) return [];
  const out: Sess[] = [];
  try {
    for (const cwd of readdirSync(dir)) {
      const full = join(dir, cwd);
      if (!statSync(full).isDirectory()) continue;
      for (const f of readdirSync(full)) {
        if (!f.endsWith(".jsonl")) continue;
        const fp = join(full, f);
        try {
          const lines = readFileSync(fp, "utf8").split("\n").filter(Boolean);
          const hdr = JSON.parse(lines[0] ?? "{}") as { id?: string; name?: string };
          let n = 0; let first = ""; let ts = 0;
          for (const l of lines) {
            try {
              const e = JSON.parse(l) as { type?: string; message?: { role?: string; content?: Array<{ text?: string }> }; timestamp?: number };
              if (e.type === "message") { n++; if (e.message?.role === "user" && !first) first = (e.message.content?.[0]?.text ?? "").slice(0, 50); if (e.timestamp) ts = e.timestamp; }
            } catch { /* */ }
          }
          out.push({ id: hdr.id ?? f, label: hdr.name ?? first ?? f.slice(11, 30), detail: `${n} msgs | ${fmt(ts)}`, type: "saved", arg: fp });
        } catch { /* */ }
      }
    }
  } catch { /* */ }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

function buildLines(sessions: Sess[], sel: number, filter: string, gw: boolean): string[] {
  const o: string[] = [];
  o.push("");
  const status = gw ? A.green("[gateway connected]") : A.muted("[standalone]");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("- Session Launcher")}  ${status}`);
  o.push(`  ${A.dim2("-".repeat(50))}`);
  o.push("");
  o.push(`  ${A.dim2("filter:")} ${filter ? A.accent(filter + "_") : A.dim2("(type to search)")}`);
  o.push("");
  const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
  if (f.length === 0) o.push(`  ${A.muted("No sessions found.")}`);
  for (let i = 0; i < f.length; i++) {
    const s = f[i]!;
    const is = i === sel;
    const icon = s.type === "gateway" ? (s.detail.includes("running") ? "*" : "o") : "+";
    const txt = `${icon} ${is ? A.bold(A.accent(s.label)) : s.label}  ${A.dim2(s.detail)}`;
    o.push(is ? `  ${A.selBg(txt)}` : `  ${txt}`);
  }
  o.push("");
  o.push(`  ${A.dim2("-".repeat(50))}`);
  o.push(`  ${A.dim2("up/down | Enter open | n new | q quit")}`);
  o.push(`  ${A.dim2("gateway session = live view | saved = pi TUI")}`);
  return o;
}

/**
 * Live session viewer: WS connect to gateway pool session.
 * Shows real-time events (channel messages, agent responses, tool calls).
 * User can also type prompts.
 */
async function liveSession(sessionId: string): Promise<void> {
  const token = await getWsToken();
  if (!token) { process.stderr.write("Cannot get WS token\n"); return; }

  return new Promise((resolve) => {
    process.stdout.write(A.clear + A.showCursor);
    process.stdout.write(`  ${A.bold(A.accent("mya"))} ${A.muted("- live: " + sessionId)}\n`);
    process.stdout.write(`  ${A.dim2("Live session viewer (Ctrl+Q to leave)")}\n`);
    process.stdout.write(`  ${A.dim2("Channel messages + agent responses shown real-time")}\n`);
    process.stdout.write(`  ${A.dim2("Type to send a prompt to this session")}\n\n`);

    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    let inputBuf = "";
    const wsUrl = `ws://127.0.0.1:${GW_PORT}/events?session=${sessionId}&token=${token}`;

    import("ws").then(({ default: WebSocket }) => {
      const ws = new WebSocket(wsUrl);
      let connected = false;
      let lineCount = 0;

      const print = (text: string, color?: (s: string) => string) => {
        const line = color ? color(text) : text;
        process.stdout.write(line + "\n");
        lineCount++;
      };

      ws.on("open", () => {
        connected = true;
        print("  [connected]", A.green);
        print("  > ", A.accent);
      });

      ws.on("message", (data: Buffer) => {
        try {
          const env = JSON.parse(data.toString()) as {
            event?: {
              type?: string;
              kind?: string;
              stage?: string;
              message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
              text?: string;
              toolName?: string;
              args?: unknown;
              result?: unknown;
              isError?: boolean;
            };
          };
          const ev = env.event;
          if (!ev) return;

          // Render based on event type
          if (ev.type === "message_start" || ev.kind === "message_start") {
            const role = ev.message?.role;
            if (role === "user") print("\n  [user] ", A.blue);
            else if (role === "assistant") print("\n  [agent] ", A.green);
          } else if (ev.type === "message_update" || ev.kind === "message_update" || ev.kind === "Streaming") {
            // Streaming text
            const content = ev.message?.content;
            if (Array.isArray(content)) {
              for (const c of content) {
                if (c?.type === "text" && c.text) process.stdout.write(c.text);
              }
            }
            if (ev.text) process.stdout.write(ev.text);
          } else if (ev.type === "message_end" || ev.kind === "message_end" || ev.stage === "completed") {
            print("");
            print("  > ", A.accent);
          } else if (ev.type === "tool_start" || ev.kind === "ToolCalls") {
            print(`  [tool] ${ev.toolName || "unknown"} ${ev.args ? JSON.stringify(ev.args).slice(0, 80) : ""}`, A.yellow);
          } else if (ev.type === "tool_end" || ev.kind === "ToolExec") {
            const status = ev.isError ? "error" : "done";
            print(`  [tool ${status}]`, ev.isError ? A.yellow : A.green);
          } else if (ev.type === "turn_start" || ev.kind === "turn" && ev.stage === "start") {
            print(`  --- turn start ---`, A.dim2);
          } else if (ev.type === "turn_end" || ev.kind === "turn" && ev.stage === "end") {
            print(`  --- turn end ---`, A.dim2);
            print("  > ", A.accent);
          }
        } catch { /* malformed */ }
      });

      ws.on("error", () => { print("\n  [connection lost]", A.muted); cleanup(); });
      ws.on("close", () => cleanup());

      const onData = (data: Buffer) => {
        const k = data.toString();
        if (k === "\x11" || k === "\x03") { cleanup(); return; } // Ctrl+Q / Ctrl+C
        if (k === "\r" || k === "\n") {
          if (inputBuf.trim() && connected) {
            print(`  [you] ${inputBuf}`, A.blue);
            ws.send(JSON.stringify({ text: inputBuf }));
            print("  [waiting...]", A.dim2);
          }
          inputBuf = "";
          return;
        }
        if (k === "\x7f" || k === "\b") {
          if (inputBuf.length > 0) { inputBuf = inputBuf.slice(0, -1); process.stdout.write("\b \b"); }
          return;
        }
        if (k.length === 1 && k >= " ") { inputBuf += k; process.stdout.write(k); }
      };

      function cleanup() {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        if (isTTY) process.stdin.setRawMode(false);
        try { ws.close(); } catch { /* */ }
        process.stdout.write(A.clear);
        resolve();
      }

      process.stdin.on("data", onData);
    });
  });
}

function launchPi(sessionPath?: string): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(`\n  ${A.bold(A.accent("mya"))}\n  ${A.muted("Loading pi InteractiveMode...")}\n\n`);
  return new Promise((resolve) => {
    const args = ["--model", "MiniMax-M3"];
    if (sessionPath) args.push("--session", sessionPath);
    const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

interface Choice { type: "new" | "gateway" | "saved"; arg?: string; }

function showLauncher(sessions: Sess[], gw: boolean): Promise<Choice | undefined> {
  return new Promise((resolve) => {
    let sel = 0; let filter = ""; let first = true;
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);
    const render = () => {
      const lines = buildLines(sessions, sel, filter, gw);
      let out = first ? A.clear : A.home;
      first = false;
      for (const l of lines) out += l + A.clrEol + "\n";
      out += A.clrEol;
      process.stdout.write(out);
    };
    render();
    const cleanup = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.clear + A.showCursor);
    };
    const onData = (data: Buffer) => {
      const k = data.toString();
      if (k === "\x03" || k === "\x04") { cleanup(); resolve(undefined); return; }
      if (k === "\x1b[A") { sel = Math.max(0, sel - 1); render(); }
      else if (k === "\x1b[B") {
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        sel = Math.min(f.length - 1, sel + 1); render();
      }
      else if (k === "\r" || k === "\n") {
        cleanup();
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        resolve(f[sel] as Choice);
      }
      else if (k === "n" && !filter) { cleanup(); resolve({ type: "new" }); }
      else if (k === "\x1b") { filter = ""; sel = 0; render(); }
      else if (k === "\x7f" || k === "\b") { filter = filter.slice(0, -1); sel = 0; render(); }
      else if (k === "q" && !filter) { cleanup(); resolve(undefined); }
      else if (k.length === 1 && k >= " " && k !== "q" && k !== "n") { filter += k; sel = 0; render(); }
    };
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const gw = await checkGateway();
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: "Open pi InteractiveMode", type: "new" },
      ...(gw ? await loadGatewaySessions() : []),
      ...loadSaved(),
    ];
    const result = await showLauncher(sessions, gw);
    if (result === undefined) return;

    if (result.type === "gateway" && result.arg) {
      // Gateway session → open pi InteractiveMode with session's JSONL (FULL TUI)
      // Loads conversation history. User can type normally.
      // Channel messages processed by gateway separately.
      await launchPi(result.arg);
    } else if (result.type === "saved" && result.arg) {
      // Saved JSONL → pi InteractiveMode (full TUI)
      await launchPi(result.arg);
    } else {
      // New → pi InteractiveMode
      await launchPi();
    }
  }
}
