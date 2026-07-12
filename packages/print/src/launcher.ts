/**
 * mya Session Launcher — multi-session TUI using tmux for background sessions.
 *
 * Architecture:
 *   Launcher → tmux new-session -d → pi runs in tmux (real PTY, background)
 *   Launcher → tmux attach-session → user interacts (pi takes over terminal)
 *   Ctrl+B D → tmux detach → back to launcher (pi KEEPS RUNNING in background)
 *
 * Sessions survive launcher exit. Multiple sessions run in parallel.
 */
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";

// ── ANSI ───────────────────────────────────────────────────────────────────
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

// ── Session types ──────────────────────────────────────────────────────────
interface Sess {
  id: string;
  label: string;
  detail: string;
  icon: string;
  type: "tmux" | "saved" | "channel" | "new";
  /** tmux session name (for tmux type) or JSONL path (for saved). */
  arg?: string;
}

const TMUX_PREFIX = "mya-";

function tmux(args: string): string {
  try { return execSync(`tmux ${args}`, { encoding: "utf8", timeout: 2000 }).trim(); }
  catch { return ""; }
}

/** List running tmux sessions (mya-* prefix only). */
function loadTmuxSessions(): Sess[] {
  const raw = tmux('list-sessions -F "#{session_name}|#{session_created}|session_attached" 2>/dev/null');
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [name, created, attached] = line.split("|");
    if (!name?.startsWith(TMUX_PREFIX)) return null;
    const age = Math.floor((nowWallclock() / 1000 - Number(created)) / 60);
    const isAttached = attached === "1";
    return {
      id: name!,
      label: name!.slice(TMUX_PREFIX.length),
      detail: `${isAttached ? "🟢 attached" : "🔵 background"} · ${age}m`,
      icon: isAttached ? "📌" : "🟢",
      type: "tmux" as const,
      arg: name!,
    };
  }).filter(Boolean) as Sess[];
}

/** Format timestamp. */
function fmt(ts: number): string {
  if (!ts) return "—";
  const d = nowWallclock() - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

/** Load saved JSONL sessions. */
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

/** Build render lines. */
function buildLines(sessions: Sess[], sel: number, filter: string): string[] {
  const o: string[] = [];
  o.push("");
  o.push(`  ${A.bold(A.accent("mya"))} ${A.muted("— Session Launcher")}`);
  const tmuxCount = sessions.filter((s) => s.type === "tmux").length;
  o.push(`  ${A.dim2("─".repeat(50))}${tmuxCount > 0 ? A.green(`  ${tmuxCount} running`) : ""}`);
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
  o.push(`  ${A.dim2("↑↓ nav · Enter open · n new · x kill · q quit · detach: Ctrl+B D")}`);
  return o;
}

/** Create a new tmux session running pi, then attach. */
function tmuxNewAndAttach(sessionPath?: string): void {
  const name = `${TMUX_PREFIX}${Date.now().toString(36)}`;
  const piArgs = ["--model", "MiniMax-M3"];
  if (sessionPath) piArgs.push("--session", sessionPath);
  const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
  const cmd = `${process.execPath} ${entry} ${piArgs.join(" ")}`;
  // Create detached session, then attach
  execSync(`tmux new-session -d -s ${name} "${cmd}"`, { env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" } });
  // Attach (blocks until user detaches with Ctrl+B D)
  spawn("tmux", ["attach-session", "-t", name], { stdio: "inherit" });
}

/** Attach to existing tmux session. */
function tmuxAttach(name: string): void {
  spawn("tmux", ["attach-session", "-t", name], { stdio: "inherit" });
}

/** Kill a tmux session. */
function tmuxKill(name: string): void {
  tmux(`kill-session -t ${name}`);
}

/** Run launcher UI. Returns selected session or undefined. */
export function runSessionLauncher(): Promise<
  { action: "open"; session?: Sess } | { action: "new" } | { action: "kill"; session: Sess } | { action: "quit" }
> {
  return new Promise((resolve) => {
    const sessions: Sess[] = [
      { id: "new", label: "New session", detail: "Start fresh conversation", icon: "✨", type: "new" },
      ...loadTmuxSessions(),
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
      else if (k === "\r" || k === "\n") {
        cleanup();
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        resolve({ action: "open", session: f[sel] });
      }
      else if (k === "n" && !filter) { cleanup(); resolve({ action: "new" }); }
      else if (k === "x" && !filter) {
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        const s = f[sel];
        if (s?.type === "tmux" && s.arg) tmuxKill(s.arg);
        render(); // refresh list
      }
      else if (k === "\x1b") { filter = ""; sel = 0; render(); }
      else if (k === "\x7f" || k === "\b") { filter = filter.slice(0, -1); sel = 0; render(); }
      else if (k === "q" && !filter) { cleanup(); resolve({ action: "quit" }); }
      else if (k.length === 1 && k >= " " && k !== "q" && k !== "n" && k !== "x") { filter += k; sel = 0; render(); }
    };

    process.stdin.on("data", onData);
  });
}

/** Main loop. */
export async function runLauncherLoop(): Promise<void> {
  // Check tmux availability
  const hasTmux = (() => { try { execSync("tmux -V", { stdio: "ignore" }); return true; } catch { return false; } })();
  if (!hasTmux) {
    process.stderr.write("[mya] tmux not found. Install tmux for background sessions.\n");
    process.stderr.write("[mya] Falling back to foreground mode.\n");
    // Fallback: simple foreground pi
    const entry = process.argv[1] ?? join(process.cwd(), "dist", "mya.js");
    const child = spawn(process.execPath, [entry, "--model", "MiniMax-M3"], {
      stdio: "inherit",
      env: { ...process.env, MYA_FROM_LAUNCHER: "1", PI_SKIP_VERSION_CHECK: "1" },
    });
    return new Promise((r) => child.on("exit", () => r()));
  }

  while (true) {
    const result = await runSessionLauncher();
    if (result.action === "quit") return;

    if (result.action === "new") {
      tmuxNewAndAttach();
    } else if (result.action === "open" && result.session) {
      const s = result.session;
      if (s.type === "tmux" && s.arg) {
        tmuxAttach(s.arg);
      } else if (s.type === "saved" && s.arg) {
        tmuxNewAndAttach(s.arg);
      } else if (s.type === "new") {
        tmuxNewAndAttach();
      }
    }
    // After tmux detach, loop back to launcher
  }
}
