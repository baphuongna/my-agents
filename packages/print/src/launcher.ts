/**
 * mya Session Launcher — multi-session TUI.
 *
 * Hybrid approach:
 * - If tmux available: full pi InteractiveMode + background detach (Ctrl+B D)
 * - If no tmux: foreground pi (full TUI, /exit to return)
 * - TCP bg sessions available for headless/channel use (mya --bg)
 */
import { createConnection, type Socket } from "node:net";
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";
import { listBgSessions, killBgSession, spawnBgSession, type BgManifest } from "./bg-runner.js";

/** Check if tmux is available. */
function hasTmux(): boolean {
  try { execSync("tmux -V", { stdio: "ignore" }); return true; } catch { return false; }
}

/** Launch pi in a tmux session (full InteractiveMode, survives detach). */
function tmuxNewAndAttach(sessionPath?: string): void {
  const name = `mya-${nowWallclock().toString(36)}`;
  const piArgs = ["--model", "MiniMax-M3"];
  if (sessionPath) piArgs.push("--session", sessionPath);
  const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
  const cmd = `${process.execPath} ${entry} ${piArgs.join(" ")}`;
  execSync(`tmux new-session -d -s ${name} "${cmd}"`, {
    env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
  });
  // Attach (blocks until user detaches with Ctrl+B D)
  spawn("tmux", ["attach-session", "-t", name], { stdio: "inherit" });
}

/** Launch pi in foreground (full InteractiveMode, /exit to return). */
function launchForegroundPi(sessionPath?: string): Promise<void> {
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

// ── ANSI ────────────────────────────────────────────────────────────────────
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
  type: "bg" | "saved" | "channel" | "new";
  port?: number;
  arg?: string;
}

function fmt(ts: number): string {
  if (!ts) return "—";
  const d = nowWallclock() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

function loadBg(): Sess[] {
  return listBgSessions()
    .filter((m) => m.status === "running" && m.port > 0)
    .map((m: BgManifest) => ({
      id: m.id,
      label: m.id.replace(/^bg_/, ""),
      detail: `:${m.port} · ${fmt(m.startedAt)}`,
      icon: "🟢",
      type: "bg" as const,
      port: m.port,
    }));
}

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

function buildLines(sessions: Sess[], sel: number, filter: string): string[] {
  const o: string[] = [];
  const bgCount = sessions.filter((s) => s.type === "bg").length;
  o.push("");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("— Session Launcher")}${bgCount > 0 ? A.green(`  ${bgCount} running`) : ""}`);
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
  o.push(`  ${A.dim2("↑↓ nav · Enter open · n new(bg) · x kill · Ctrl+Q detach · q quit")}`);
  return o;
}

/** Connect to a background session via TCP and render a simple chat. */
function attachTcp(port: number): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(A.clear + A.showCursor);
    process.stdout.write(`  ${A.bold(A.accent("mya"))} ${A.muted(`— attached to :${port} (Ctrl+Q to detach)`)}\n\n`);

    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    let socket: Socket;
    let inputBuf = "";
    let rpcId = 1;
    let responseBuf = "";

    try {
      socket = createConnection({ host: "127.0.0.1", port }, () => {
        process.stdout.write(A.green("  ✓ connected\n\n  > "));
      });
    } catch {
      process.stdout.write(A.muted("  ✗ connection failed\n"));
      if (isTTY) process.stdin.setRawMode(false);
      setTimeout(() => resolve(), 1000);
      return;
    }

    // Read TCP responses
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => {
      responseBuf += data;
      let nl: number;
      while ((nl = responseBuf.indexOf("\n")) >= 0) {
        const line = responseBuf.slice(0, nl).trim();
        responseBuf = responseBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { method?: string; params?: unknown; result?: unknown };
          if (msg.method === "event") {
            // Render streaming event (simplified — just show text)
            const ev = msg.params as { kind?: string; text?: string; stage?: string };
            if (ev?.text) process.stdout.write(ev.text);
            else if (ev?.kind === "Completed" || ev?.stage === "completed") process.stdout.write("\n\n  > ");
          } else if (msg.result) {
            // Response to prompt/cancel/status
            process.stdout.write("\n\n  > ");
          }
        } catch { /* malformed */ }
      }
    });

    socket.on("error", () => {
      process.stdout.write(A.muted("\n  ✗ connection lost\n"));
      cleanup();
    });
    socket.on("close", () => {
      cleanup();
    });

    const cleanup = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      try { socket.destroy(); } catch { /* */ }
    };

    const onData = (data: Buffer) => {
      const k = data.toString();
      // Ctrl+Q = detach
      if (k === "\x11") { cleanup(); process.stdout.write(A.clear); resolve(); return; }
      // Ctrl+C = detach (not kill)
      if (k === "\x03") { cleanup(); process.stdout.write(A.clear); resolve(); return; }
      // Enter = send prompt
      if (k === "\r" || k === "\n") {
        if (inputBuf.trim()) {
          const req = JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "prompt", params: { text: inputBuf } }) + "\n";
          socket.write(req);
          process.stdout.write("\n  ... \n");
        }
        inputBuf = "";
        return;
      }
      // Backspace
      if (k === "\x7f" || k === "\b") {
        if (inputBuf.length > 0) { inputBuf = inputBuf.slice(0, -1); process.stdout.write("\b \b"); }
        return;
      }
      // Regular char
      if (k.length === 1 && k >= " ") { inputBuf += k; process.stdout.write(k); }
    };

    process.stdin.on("data", onData);
  });
}

export function runSessionLauncher(): Promise<{ action: "open"; session?: Sess } | { action: "new" } | { action: "kill"; session: Sess } | { action: "quit" }> {
  return new Promise((resolve) => {
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: "Start fresh (background)", icon: "✨", type: "new" },
      ...loadBg(),
      ...loadSaved(),
    ];
    let sel = 0;
    let filter = "";
    let first = true;
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);

    const render = () => {
      const lines = buildLines(sessions, sel, filter);
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
      if (k === "\x03" || k === "\x04") { cleanup(); resolve({ action: "quit" }); return; }
      if (k === "\x1b[A") { sel = Math.max(0, sel - 1); render(); }
      else if (k === "\x1b[B") { const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions; sel = Math.min(f.length - 1, sel + 1); render(); }
      else if (k === "\r" || k === "\n") { cleanup(); const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions; resolve({ action: "open", session: f[sel] }); }
      else if (k === "n" && !filter) { cleanup(); resolve({ action: "new" }); }
      else if (k === "x" && !filter) {
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        const s = f[sel];
        if (s?.type === "bg" && s.id) killBgSession(s.id);
        sessions.splice(sessions.indexOf(s!), 1);
        sel = Math.min(sel, sessions.length - 1);
        render();
      }
      else if (k === "\x1b") { filter = ""; sel = 0; render(); }
      else if (k === "\x7f" || k === "\b") { filter = filter.slice(0, -1); sel = 0; render(); }
      else if (k === "q" && !filter) { cleanup(); resolve({ action: "quit" }); }
      else if (k.length === 1 && k >= " " && k !== "q" && k !== "n" && k !== "x") { filter += k; sel = 0; render(); }
    };
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  const useTmux = hasTmux();

  while (true) {
    const result = await runSessionLauncher();
    if (result.action === "quit") return;

    if (result.action === "new" || (result.action === "open" && result.session?.type === "new")) {
      // New session → full pi InteractiveMode (tmux background or foreground)
      if (useTmux) {
        tmuxNewAndAttach();
      } else {
        await launchForegroundPi();
      }
    } else if (result.action === "open" && result.session) {
      const s = result.session;
      if (s.type === "bg" && s.port) {
        // TCP background session → simple chat attach
        await attachTcp(s.port);
      } else if (s.type === "saved" && s.arg) {
        // Saved JSONL → full pi InteractiveMode
        if (useTmux) {
          tmuxNewAndAttach(s.arg);
        } else {
          await launchForegroundPi(s.arg);
        }
      }
    }
    // After pi exits / tmux detach, loop back to launcher
  }
}
