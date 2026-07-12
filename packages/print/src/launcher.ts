/**
 * mya Session Launcher — multi-session TUI using raw ANSI.
 *
 * Shows all sessions (saved JSONL + active channel sessions).
 * Selecting a session spawns pi as a child process with that session.
 * When pi exits, control returns to the launcher.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { nowWallclock } from "@my-agent/core";

// ── ANSI helpers ───────────────────────────────────────────────────────────
const A = {
  reset: "\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  selBg: (s: string) => `\x1b[48;2;58;58;74m${s}\x1b[49m`,
  clear: "\x1b[2J\x1b[H",
  home: "\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  // Clear from cursor to end of line (erases leftover chars)
  clrEol: "\x1b[K",
};

// ── Session types ──────────────────────────────────────────────────────────
interface LauncherSession {
  id: string;
  label: string;
  detail: string;
  icon: string;
  type: "saved" | "channel" | "new";
  sessionArg?: string;
}

function formatTime(ts: number): string {
  if (!ts) return "—";
  const diff = nowWallclock() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/** Load saved sessions from ~/.mya/sessions/ (synchronous — fast enough). */
function loadSavedSessions(): LauncherSession[] {
  const dir = join(homedir(), ".mya", "sessions");
  if (!existsSync(dir)) return [];
  const result: LauncherSession[] = [];
  try {
    for (const cwdDir of readdirSync(dir)) {
      const full = join(dir, cwdDir);
      if (!statSync(full).isDirectory()) continue;
      for (const file of readdirSync(full)) {
        if (!file.endsWith(".jsonl")) continue;
        const fp = join(full, file);
        try {
          const lines = readFileSync(fp, "utf8").split("\n").filter(Boolean);
          const header = JSON.parse(lines[0] ?? "{}") as { id?: string; name?: string };
          let msgCount = 0;
          let firstText = "";
          let lastTs = 0;
          for (const line of lines) {
            try {
              const e = JSON.parse(line) as { type?: string; message?: { role?: string; content?: Array<{ text?: string }> }; timestamp?: number };
              if (e.type === "message") {
                msgCount++;
                if (e.message?.role === "user" && !firstText) firstText = (e.message.content?.[0]?.text ?? "").slice(0, 40);
                if (e.timestamp) lastTs = e.timestamp;
              }
            } catch { /* */ }
          }
          result.push({
            id: header.id ?? file,
            label: header.name ?? firstText ?? file.slice(0, 30),
            detail: `${msgCount} msgs · ${formatTime(lastTs)}`,
            icon: "💬",
            type: "saved",
            sessionArg: fp,
          });
        } catch { /* */ }
      }
    }
  } catch { /* */ }
  return result.sort((a, b) => b.id.localeCompare(a.id));
}

async function loadChannelSessions(): Promise<LauncherSession[]> {
  try {
    const res = await fetch("http://127.0.0.1:3000/channel/sessions", { signal: AbortSignal.timeout(500) });
    if (!res.ok) return [];
    const arr = (await res.json()) as Array<{ channelId: string; userId: string; sessionId: string; lastActivity: number; history: unknown[] }>;
    return arr.map((s) => ({
      id: s.sessionId,
      label: `${s.channelId}:${s.userId}`,
      detail: `${s.history.length} msgs · ${formatTime(s.lastActivity)}`,
      icon: s.channelId === "telegram" ? "📱" : "🎮",
      type: "channel" as const,
      sessionArg: s.sessionId,
    }));
  } catch { return []; }
}

/** Build render lines (pure — no I/O). */
function buildLines(sessions: LauncherSession[], selected: number, filter: string): string[] {
  const out: string[] = [];
  out.push("");
  out.push(`  ${A.bold(A.accent("mya"))} ${A.muted("— Session Launcher")}`);
  out.push(`  ${A.dim2("──────────────────────────────────────────")}`);
  out.push("");
  out.push(`  ${A.dim2("filter:")} ${filter ? A.accent(filter + "█") : A.dim2("(type to search)")}`);
  out.push("");

  const filtered = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;

  if (filtered.length === 0) out.push(`  ${A.muted("No sessions found.")}`);

  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i]!;
    const sel = i === selected;
    const txt = `${s.icon} ${sel ? A.bold(A.accent(s.label)) : s.label}  ${A.dim2(s.detail)}`;
    out.push(sel ? `  ${A.selBg(txt)}` : `  ${txt}`);
  }

  out.push("");
  out.push(`  ${A.dim2("──────────────────────────────────────────")}`);
  out.push(`  ${A.dim2("↑↓ navigate · Enter open · n new · q/Ctrl+C quit")}`);
  return out;
}

/**
 * Run the launcher. Returns user's choice or undefined (quit).
 */
export function runSessionLauncher(): Promise<{ sessionPath?: string; isNew?: boolean } | undefined> {
  return new Promise(async (resolve) => {
    const sessions: LauncherSession[] = [
      { id: "new", label: "New session", detail: "Start a fresh conversation", icon: "✨", type: "new" },
      ...(await loadChannelSessions()),
      ...loadSavedSessions(),
    ];

    let selected = 0;
    let filter = "";
    let firstRender = true;

    const isTTY = process.stdin.isTTY;
    if (isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(A.hideCursor);

    const doRender = () => {
      const lines = buildLines(sessions, selected, filter);
      if (firstRender) {
        process.stdout.write(A.clear);
        firstRender = false;
      }
      // Move cursor home + rewrite each line with clrEol (no full clear — avoids flicker)
      let out = A.home;
      for (const line of lines) {
        out += line + A.clrEol + "\n";
      }
      out += A.clrEol; // clear last line
      process.stdout.write(out);
    };

    doRender();

    const cleanup = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      if (isTTY) process.stdin.setRawMode(false);
      process.stdout.write(A.clear + A.showCursor);
    };

    const onData = (data: Buffer) => {
      const key = data.toString();

      // Ctrl+C or Ctrl+D → quit immediately
      if (key === "\x03" || key === "\x04") {
        cleanup();
        resolve(undefined);
        return;
      }
      if (key === "\x1b[A") { // ↑
        selected = Math.max(0, selected - 1);
        doRender();
      } else if (key === "\x1b[B") { // ↓
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        selected = Math.min(f.length - 1, selected + 1);
        doRender();
      } else if (key === "\r" || key === "\n") { // Enter
        cleanup();
        const f = filter ? sessions.filter((s) => s.label.toLowerCase().includes(filter.toLowerCase())) : sessions;
        const chosen = f[selected];
        if (chosen?.type === "new") resolve({ isNew: true });
        else resolve({ sessionPath: chosen?.sessionArg });
      } else if ((key === "q" && !filter) || key === "\x1b") { // q or Esc
        if (filter && key === "\x1b") { filter = ""; selected = 0; doRender(); }
        else if (key === "q") { cleanup(); resolve(undefined); }
      } else if (key === "n" && !filter) { // n = new
        cleanup();
        resolve({ isNew: true });
      } else if (key === "\x7f" || key === "\b") { // Backspace
        filter = filter.slice(0, -1);
        selected = 0;
        doRender();
      } else if (key.length === 1 && key >= " " && key !== "q" && key !== "n") {
        filter += key;
        selected = 0;
        doRender();
      }
    };

    process.stdin.on("data", onData);
  });
}

/** Launch pi as a child process. Returns when child exits. */
export function launchSession(sessionPath?: string): Promise<void> {
  return new Promise((resolve) => {
    const args = ["--model", "MiniMax-M3"];
    if (sessionPath) args.push("--session", sessionPath);

    const child = spawn(process.execPath, [
      process.argv[1] ?? process.cwd() + "/dist/mya.js",
      ...args,
    ], {
      stdio: "inherit",
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", MYA_FROM_LAUNCHER: "1" },
    });

    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

/** Main loop: launcher → select → pi → launcher → ... */
export async function runLauncherLoop(): Promise<void> {
  while (true) {
    const result = await runSessionLauncher();
    if (result === undefined) return;
    if (result.isNew) await launchSession();
    else await launchSession(result.sessionPath);
  }
}
