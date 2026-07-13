/**
 * mya Session Launcher — gateway-based multi-session TUI.
 *
 * If gateway is running (mya serve): connect via WS, sessions persist in gateway.
 * If no gateway: fallback to foreground pi (simple single session).
 *
 * Gateway mode:
 *   - GET /pool/sessions → list active sessions
 *   - WS ?session=<id> → connect to session's agent (pool-managed)
 *   - Close launcher → sessions persist in gateway ✓
 *   - Reopen launcher → sessions still there ✓
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";
import { createConnection as wsConnect, type Socket } from "node:net";

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  selBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clear: "\x1b[2J\x1b[H",
  home: "\x1b[H",
  clrEol: "\x1b[K",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

interface Sess {
  id: string;
  label: string;
  detail: string;
  icon: string;
  type: "gateway" | "saved" | "new";
  arg?: string;
}

/** Default gateway port (matches main.ts runWebServer default). */
const GATEWAY_PORT = 3000;

/** Check if gateway is running. */
async function checkGateway(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health/live`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch { return false; }
}

/** Load sessions from gateway pool. */
async function loadGatewaySessions(): Promise<Sess[]> {
  try {
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/pool/sessions`, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return [];
    const sessions = (await res.json()) as Array<{ sessionId: string; messages: number; lastActivity: number; busy: boolean }>;
    return sessions.map((s) => ({
      id: s.sessionId,
      label: s.sessionId === "default" ? "Main chat" : s.sessionId,
      detail: `${s.messages} msgs · ${s.busy ? "⚡ busy" : "idle"} · ${fmt(s.lastActivity)}`,
      icon: s.busy ? "⚡" : "🟢",
      type: "gateway" as const,
      arg: s.sessionId,
    }));
  } catch { return []; }
}

function fmt(ts: number): string {
  if (!ts) return "—";
  const d = nowWallclock() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h`;
}

/** Load saved JSONL sessions from disk. */
function loadSaved(): Sess[] {
  const dir = join(homedir(), ".mya", "sessions");
  if (!existsSync(dir)) return [];
  const out: Sess[] = [];
  try {
    for (const cwd of readdirSync(dir)) {
      const full = join(dir, cwd);
      if (!statSync(full).isDirectory() || cwd === "bg") continue;
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
              if (e.type === "message") { n++; if (e.message?.role === "user" && !first) first = (e.message.content?.[0]?.text ?? "").slice(0, 40); if (e.timestamp) ts = e.timestamp; }
            } catch { /* */ }
          }
          out.push({ id: hdr.id ?? f, label: hdr.name ?? first ?? f.slice(0, 30), detail: `${n} msgs · ${fmt(ts)}`, icon: "💬", type: "saved", arg: fp });
        } catch { /* */ }
      }
    }
  } catch { /* */ }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

function buildLines(sessions: Sess[], sel: number, filter: string, gateway: boolean): string[] {
  const o: string[] = [];
  o.push("");
  const status = gateway ? A.green("● gateway connected") : A.muted("○ no gateway (foreground mode)");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("— Session Launcher")}  ${status}`);
  o.push(`  ${A.dim2("─".repeat(50))}`);
  o.push("");
  o.push(`  ${A.dim2("filter:")} ${filter ? A.accent(filter + "█") : A.dim2("(type to search)")}`);
  o.push("");
  const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
  if (f.length === 0) o.push(`  ${A.muted("No sessions found.")}`);
  for (let i = 0; i < f.length; i++) {
    const s = f[i]!;
    const is = i === sel;
    const txt = `${s.icon} ${is ? A.bold(A.accent(s.label)) : s.label}  ${A.dim2(s.detail)}`;
    o.push(is ? `  ${A.selBg(txt)}` : `  ${txt}`);
  }
  o.push("");
  o.push(`  ${A.dim2("─".repeat(50))}`);
  o.push(`  ${A.dim2("↑↓ nav · Enter open · n new · q quit")}`);
  return o;
}

/** WS chat: connect to gateway session, render streaming events. */
async function wsChat(sessionId: string): Promise<void> {
  // Get WS token from gateway
  let wsToken = "";
  try {
    // The dashboard HTML contains the token; we'll use a simpler approach:
    // connect without token (gateway allows loopback without token if not configured)
  } catch { /* */ }

  return new Promise((resolve) => {
    process.stdout.write(A.clear + A.showCursor);
    process.stdout.write(`  ${A.bold(A.accent("mya"))} ${A.muted(`— session: ${sessionId} (Ctrl+Q to leave)`)}}\n\n`);

    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    // Connect via raw TCP WS (simple JSON line protocol)
    // Actually use fetch to send prompts, and WS for streaming
    // For simplicity: use polling — send prompt via HTTP POST, get events via WS
    const wsUrl = `ws://127.0.0.1:${GATEWAY_PORT}/events?session=${sessionId}`;
    let inputBuf = "";

    // Use WebSocket (from ws package, bundled)
    import("ws").then(({ default: WebSocket }) => {
      const ws = new WebSocket(wsUrl);
      let connected = false;

      ws.on("open", () => {
        connected = true;
        process.stdout.write(A.green("  ✓ connected\n\n  > "));
      });

      ws.on("message", (data: Buffer) => {
        try {
          const env = JSON.parse(data.toString()) as { event?: { kind?: string; text?: string; stage?: string } };
          const ev = env.event;
          if (ev?.text) process.stdout.write(ev.text);
          if (ev?.kind === "Completed" || ev?.stage === "completed") {
            process.stdout.write("\n\n  > ");
          }
        } catch { /* */ }
      });

      ws.on("error", () => {
        process.stdout.write(A.muted("\n  ✗ connection lost\n"));
        cleanup();
      });

      ws.on("close", () => cleanup());

      const onData = (data: Buffer) => {
        const k = data.toString();
        if (k === "\x11" || k === "\x03") { cleanup(); return; } // Ctrl+Q or Ctrl+C
        if (k === "\r" || k === "\n") {
          if (inputBuf.trim() && connected) {
            ws.send(JSON.stringify({ text: inputBuf }));
            process.stdout.write("\n  ... \n");
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

/** Launch pi in foreground (fallback when no gateway). */
function launchPi(sessionPath?: string): Promise<void> {
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

export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const gateway = await checkGateway();

    // Build session list
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: gateway ? "Gateway-managed" : "Foreground pi", icon: "✨", type: "new" },
      ...(gateway ? await loadGatewaySessions() : []),
      ...loadSaved(),
    ];

    const result = await showLauncher(sessions, gateway);
    if (result === undefined) return; // quit

    if (gateway) {
      // Gateway mode: WS chat
      if (result.type === "new") {
        // Generate a session ID for the new session
        const sid = `s_${nowWallclock().toString(36)}`;
        await wsChat(sid);
      } else if (result.arg) {
        await wsChat(result.arg);
      }
    } else {
      // Fallback: foreground pi
      if (result.type === "saved" && result.arg) {
        await launchPi(result.arg);
      } else {
        await launchPi();
      }
    }
  }
}

interface LauncherChoice {
  type: "new" | "gateway" | "saved";
  arg?: string;
}

function showLauncher(sessions: Sess[], gateway: boolean): Promise<LauncherChoice | undefined> {
  return new Promise((resolve) => {
    let sel = 0;
    let filter = "";
    let first = true;
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);

    const render = () => {
      const lines = buildLines(sessions, sel, filter, gateway);
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
        resolve(f[sel] as LauncherChoice);
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
