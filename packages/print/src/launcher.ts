/**
 * mya Session Launcher.
 *
 * Shows ONLY active sessions:
 *   🟢 Gateway pool sessions (pi AgentSession running in background)
 *   ✨ New session (choose working directory)
 *
 * Closed/stale sessions NOT shown (they're done, history on disk).
 *
 * mya launcher → session picker
 * mya → pi InteractiveMode directly
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";
import { nowWallclock } from "@my-agent/core";

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[38;2;210;153;34m${s}\x1b[39m`,
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
  type: "gateway" | "new";
  arg?: string;
}

const GW_PORT = parseInt(process.env["MYA_PORT"] ?? "3000", 10);

async function checkGateway(): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${GW_PORT}/health/live`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}

async function loadGatewaySessions(): Promise<Sess[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/pool/sessions`, { signal: AbortSignal.timeout(500) });
    if (!r.ok) return [];
    const arr = (await r.json()) as Array<{ sessionId: string; messages: number; lastActivity: number; busy: boolean; sessionFile?: string }>;
    return arr.map((s) => ({
      id: s.sessionId,
      label: s.sessionId.replace(/^ch-/, "").replace(/-/g, " "),
      detail: `${s.messages} msgs | ${s.busy ? "running" : "idle"} | ${fmt(s.lastActivity)}`,
      type: "gateway" as const,
      arg: s.sessionFile,
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

function buildLines(sessions: Sess[], sel: number, gw: boolean): string[] {
  const o: string[] = [];
  o.push("");
  const status = gw ? A.green("[gateway connected]") : A.muted("[no gateway]");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("- Session Launcher")}  ${status}`);
  o.push(`  ${A.dim2("-".repeat(50))}`);
  o.push("");
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]!;
    const is = i === sel;
    const icon = s.type === "new" ? "+" : s.detail.includes("running") ? "*" : "o";
    const txt = `${icon} ${is ? A.bold(A.accent(s.label)) : s.label}  ${A.dim2(s.detail)}`;
    o.push(is ? `  ${A.selBg(txt)}` : `  ${txt}`);
  }
  o.push("");
  o.push(`  ${A.dim2("-".repeat(50))}`);
  o.push(`  ${A.dim2("up/down | Enter open | n new | q quit")}`);
  o.push(`  ${A.dim2("in pi: /quit or Ctrl+D or Ctrl+Q to return")}`);
  return o;
}

/** Directory picker — user types path or picks current dir. */
function pickDirectory(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let dir = process.cwd();
    let inputMode = false;
    let inputBuf = "";
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);

    const render = () => {
      let out = A.clear;
      out += `\n  ${A.bold(A.accent("mya"))} ${A.muted("- Working Directory")}\n`;
      out += `  ${A.dim2("-".repeat(50))}\n\n`;
      if (inputMode) {
        out += `  ${A.dim2("path:")} ${A.accent(inputBuf + "_")}\n`;
        out += `  ${A.dim2("Enter to confirm | Esc to cancel")}\n`;
      } else {
        out += `  ${A.dim2("Current:")} ${A.green(dir)}\n\n`;
        out += `  ${A.dim2("Enter = use this directory")}\n`;
        out += `  ${A.dim2("Type path = change directory")}\n`;
        out += `  ${A.dim2("~/ = home | ../ = parent | /abs/path")}\n`;
      }
      out += `  ${A.dim2("-".repeat(50))}\n`;
      out += `  ${A.dim2("Enter confirm | Esc back | q cancel")}\n`;
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
      if (k === "\x03" || k === "\x04" || (k === "q" && !inputMode)) { cleanup(); resolve(undefined); return; }
      if (k === "\x1b") { // Esc
        if (inputMode) { inputMode = false; inputBuf = ""; render(); }
        else { cleanup(); resolve(undefined); }
        return;
      }
      if (k === "\r" || k === "\n") { // Enter
        cleanup();
        if (inputMode && inputBuf.trim()) {
          // Resolve path (handle ~, relative)
          let p = inputBuf.trim();
          if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
          else if (p === "~") p = homedir();
          else p = resolve(dir, p);
          resolve(p);
        } else {
          resolve(dir); // use current dir
        }
        return;
      }
      if (!inputMode) {
        // Any printable char → enter input mode
        if (k.length === 1 && k >= " ") { inputMode = true; inputBuf = k; render(); return; }
      } else {
        if (k === "\x7f" || k === "\b") { inputBuf = inputBuf.slice(0, -1); render(); return; }
        if (k.length === 1 && k >= " ") { inputBuf += k; render(); return; }
      }
    };
    process.stdin.on("data", onData);
  });
}

/** Launch pi InteractiveMode (FULL TUI) in a specific working directory. */
function launchPi(sessionPath?: string, cwd?: string): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(`\n  ${A.bold(A.accent("mya"))}\n  ${A.muted("Loading pi InteractiveMode...")}\n`);
  if (cwd) process.stdout.write(`  ${A.dim2("Directory: " + cwd)}\n\n`);

  return new Promise((resolve) => {
    const args = ["--model", "MiniMax-M3"];
    if (sessionPath) args.push("--session", sessionPath);
    const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

interface Choice { type: "new" | "gateway"; arg?: string; }

function showLauncher(sessions: Sess[], gw: boolean): Promise<Choice | undefined> {
  return new Promise((resolve) => {
    let sel = 0;
    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);
    const render = () => {
      const lines = buildLines(sessions, sel, gw);
      let out = A.clear;
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
      else if (k === "\x1b[B") { sel = Math.min(sessions.length - 1, sel + 1); render(); }
      else if (k === "\r" || k === "\n") { cleanup(); resolve(sessions[sel] as Choice); }
      else if (k === "n") { cleanup(); resolve({ type: "new" }); }
      else if (k === "q") { cleanup(); resolve(undefined); }
    };
    process.stdin.on("data", onData);
  });
}

export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const gw = await checkGateway();
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: "Choose directory + open pi TUI", type: "new" },
      ...(gw ? await loadGatewaySessions() : []),
    ];

    const result = await showLauncher(sessions, gw);
    if (result === undefined) return;

    if (result.type === "new") {
      // Pick working directory, then launch pi TUI
      const cwd = await pickDirectory();
      if (cwd) await launchPi(undefined, cwd);
    } else if (result.type === "gateway" && result.arg) {
      // Gateway session → pi TUI with its JSONL
      await launchPi(result.arg);
    }
  }
}
